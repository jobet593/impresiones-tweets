// api/clear-readings.js
//
// Endpoint TEMPORAL para borrar el historial de un tweet en Redis.
// Uso: /api/clear-readings?id=nubes&secret=TU_CRON_SECRET_KEY
//
// IMPORTANTE: borrar este archivo después de usarlo, ya que permite
// eliminar datos si alguien adivina la URL exacta junto con el secreto.

import { createClient } from 'redis';

async function getRedisClient() {
  const url = process.env.STORAGE_URL || process.env.REDIS_URL;
  if (!url) throw new Error('No se encontró STORAGE_URL');
  const client = createClient({ url });
  await client.connect();
  return client;
}

export default async function handler(req, res) {
  const providedSecret = req.query.secret;
  const expectedSecret = process.env.CRON_SECRET_KEY;

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: 'Falta el parámetro id' });
  }

  let redis;
  try {
    redis = await getRedisClient();
    const key = `readings:${id}`;
    const deletedCount = await redis.del(key);
    return res.status(200).json({ success: true, key, deletedCount });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  } finally {
    if (redis) await redis.disconnect();
  }
}
