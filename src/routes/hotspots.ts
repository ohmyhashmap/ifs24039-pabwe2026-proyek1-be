import { Router } from 'express';
import { getDb } from '../db/database';
import { queryParam } from '../utils/http';

export const hotspotsRoute = Router();

hotspotsRoute.get('/', (req, res) => {
  try {
    const days = Number(queryParam(req, 'days')) || 5;
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      res.status(400).json({
        success: false,
        error: 'days harus berupa bilangan bulat antara 1 dan 30'
      });
      return;
    }

    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - days);

    const data = getDb()
      .query(
        `SELECT id, lat, lon, confidence, detected_at, source
         FROM hotspots WHERE detected_at >= ? ORDER BY detected_at ASC`
      )
      .all(dateLimit.toISOString());

    res.json({ success: true, meta: { count: data.length, days, source: 'DATABASE' }, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil data hotspot';
    console.error('[ERROR] Hotspots:', message.replace(/[\r\n]/g, ' '));
    res.status(500).json({ success: false, error: message });
  }
});
