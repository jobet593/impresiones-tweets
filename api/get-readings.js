// api/get-readings.js
//
// Endpoint de solo lectura. Devuelve el historial de lecturas guardadas
// en Redis por el cron job (cron-fetch-metrics.js) para un tweet dado.
//
// Uso: /api/get-readings?id=nubes
//      /api/get-readings?id=encendedor_v2

import { createClient } from 'redis';

async function getRedisClient() {
  const url = process.env.STORAGE_URL || process.env.REDIS_URL;
  if (!url) {
    throw new Error('No se encontró la variable de entorno de conexión a Redis (STORAGE_URL)');
  }
  const client = createClient({ url });
  await client.connect();
  return client;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Falta el parámetro id (ej. ?id=nubes)' });
  }

  let redis;
  try {
    redis = await getRedisClient();
    const key = `readings:${id}`;
    const rawReadings = await redis.lRange(key, 0, -1);
    const readings = rawReadings.map((r) => JSON.parse(r));

    return res.status(200).json({
      id,
      count: readings.length,
      readings
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error al leer de Redis', details: String(err) });
  } finally {
    if (redis) await redis.disconnect();
  }
}
