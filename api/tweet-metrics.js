// api/tweet-metrics.js
//
// Vercel Serverless Function.
// Recibe un tweet ID y devuelve sus métricas (impresiones, likes, etc.)
// usando el Bearer Token guardado en las variables de entorno de Vercel.
// El token NUNCA se expone al navegador: esta función corre en el servidor.

export default async function handler(req, res) {
  // Solo permitimos GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { tweetId } = req.query;

  if (!tweetId) {
    return res.status(400).json({ error: 'Falta el parámetro tweetId' });
  }

  const bearerToken = process.env.X_BEARER_TOKEN;

  if (!bearerToken) {
    return res.status(500).json({ error: 'Bearer token no configurado en el servidor' });
  }

  try {
    const url = `https://api.x.com/2/tweets/${tweetId}?tweet.fields=public_metrics,created_at`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`
      }
    });

    const data = await response.json();

    if (!response.ok) {
      // X devuelve detalles del error en data.errors o data.detail
      return res.status(response.status).json({
        error: 'Error al consultar la API de X',
        details: data
      });
    }

    const tweet = data.data;
    const publicMetrics = tweet?.public_metrics || {};

    // Respuesta simplificada que el dashboard puede consumir directamente
    return res.status(200).json({
      tweetId: tweet?.id,
      createdAt: tweet?.created_at,
      impressions: publicMetrics.impression_count ?? null,
      likes: publicMetrics.like_count ?? null,
      retweets: publicMetrics.retweet_count ?? null,
      replies: publicMetrics.reply_count ?? null,
      fetchedAt: new Date().toISOString()
    });

  } catch (err) {
    return res.status(500).json({ error: 'Error inesperado', details: String(err) });
  }
}
