// api/cron-fetch-metrics.js
//
// Esta función la ejecuta Vercel automáticamente cada 30 minutos (ver vercel.json).
// Por cada tweet configurado:
//   1. Llama a la API de X para obtener impressions, likes, etc.
//   2. Guarda la lectura en Redis con su timestamp.
// El dashboard (index.html) luego lee este historial desde otro endpoint.

import { createClient } from 'redis';

// Tweets a monitorear. Si agregas o cambias tweets en el futuro, edita esta lista.
const TWEETS = [
  { id: 'nubes', tweetId: '1644757424711127041', label: 'Dr. Manhattan (nubes)' },
  { id: 'encendedor_v2', tweetId: '2053848253418848414', label: 'Un encendedor blanco' }
];

async function sendIncrementEmail({ label, previous, current, increment }) {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.NOTIFICATION_EMAIL;
  if (!apiKey || !toEmail) return; // si falta config de correo, simplemente no se envía

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Seguimiento de impresiones <onboarding@resend.dev>',
        to: [toEmail],
        subject: `+${increment} impresiones en "${label}"`,
        html: `<p><strong>${label}</strong> subió de <strong>${previous}</strong> a <strong>${current}</strong> impresiones (+${increment}).</p>`
      })
    });
  } catch (err) {
    console.error('Error enviando correo de notificación:', err);
  }
}

async function getRedisClient() {
  const url = process.env.STORAGE_URL || process.env.REDIS_URL;
  if (!url) {
    throw new Error('No se encontró la variable de entorno de conexión a Redis (STORAGE_URL)');
  }
  const client = createClient({ url });
  await client.connect();
  return client;
}

async function fetchTweetMetrics(tweetId, bearerToken) {
  const url = `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics,created_at`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error de X para tweet ${tweetId}: ${JSON.stringify(data)}`);
  }
  const metrics = data.data?.public_metrics || {};
  return {
    impressions: metrics.impression_count ?? null,
    likes: metrics.like_count ?? null,
    retweets: metrics.retweet_count ?? null,
    replies: metrics.reply_count ?? null
  };
}

export default async function handler(req, res) {
  // Como usamos un programador externo (cron-job.org) en vez del cron nativo de Vercel,
  // protegemos este endpoint con una clave secreta propia.
  // Configúrala en Vercel como variable de entorno: CRON_SECRET_KEY
  const providedSecret = req.query.secret;
  const expectedSecret = process.env.CRON_SECRET_KEY;

  if (!expectedSecret) {
    return res.status(500).json({ error: 'CRON_SECRET_KEY no configurado en el servidor' });
  }

  if (providedSecret !== expectedSecret) {
    return res.status(403).json({ error: 'No autorizado. Falta o es incorrecta la clave secreta.' });
  }

  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) {
    return res.status(500).json({ error: 'Bearer token no configurado' });
  }

  let redis;
  const results = [];
  const errors = [];

  try {
    redis = await getRedisClient();
    const now = new Date().toISOString();

    for (const tweet of TWEETS) {
      try {
        const metrics = await fetchTweetMetrics(tweet.tweetId, bearerToken);

        if (metrics.impressions === null) {
          errors.push({ tweet: tweet.id, error: 'impressions vino null, no se guarda' });
          continue;
        }

        const key = `readings:${tweet.id}`;

        // Revisamos la última lectura guardada para evitar duplicados
        // y para saber si hubo un incremento real que notificar.
        const existing = await redis.lRange(key, -1, -1);
        const lastReading = existing.length ? JSON.parse(existing[0]) : null;

        if (lastReading && metrics.impressions <= lastReading.impressions) {
          // No hay incremento (o el dato vino igual/menor) -> no se guarda ni se notifica
          results.push({ tweet: tweet.id, impressions: metrics.impressions, skipped: true, reason: 'sin incremento' });
          continue;
        }

        const reading = { ts: now, impressions: metrics.impressions, source: 'auto' };
        await redis.rPush(key, JSON.stringify(reading));
        results.push({ tweet: tweet.id, ...reading });

        if (lastReading) {
          const increment = metrics.impressions - lastReading.impressions;
          await sendIncrementEmail({
            label: tweet.label,
            previous: lastReading.impressions,
            current: metrics.impressions,
            increment
          });
        }
      } catch (err) {
        errors.push({ tweet: tweet.id, error: String(err) });
      }
    }

    return res.status(200).json({ success: true, results, errors, fetchedAt: now });

  } catch (err) {
    return res.status(500).json({ error: 'Error general en el cron', details: String(err) });
  } finally {
    if (redis) await redis.disconnect();
  }
}
