import { Router, type Response } from 'express';
import { queryParam } from '../utils/http';
import { z } from 'zod';
import { parseCoordinates } from '../utils/coordinates';
import { findSafeWindow } from './safeWindowAnalysis';

const send = (res: Response, body: unknown, status = 200) => {
  res.status(status).json(body);
};

export const safeWindowRoute = Router();

const AirQualityResponseSchema = z.object({
  hourly: z.object({
    time: z.array(z.string()),
    pm2_5: z.array(z.number().nullable())
  })
});
const cache = new Map<string, { data: object; expiry: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 menit

safeWindowRoute.get('/', async (req, res) => {
  let coordinates: { lat: number; lon: number };
  try {
    coordinates = parseCoordinates(queryParam(req, 'lat'), queryParam(req, 'lon'), {
      lat: -6.2088,
      lon: 106.8456
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koordinat tidak valid';
    return send(res, { success: false, error: message }, 400);
  }

  const { lat, lon } = coordinates;
  const cacheKey = `safe-window-${lat}-${lon}`;

  // 1. Cek Cache
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return send(res, { success: true, source: 'cache', data: cached.data });
  }

  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('hourly', 'pm2_5');
    url.searchParams.set('forecast_days', '2');
    const apiRes = await fetch(url);
    if (!apiRes.ok) throw new Error(`Open-Meteo gagal: HTTP ${apiRes.status}`);
    const data = AirQualityResponseSchema.parse(await apiRes.json());

    const { startIndex, endIndex, averagePm25 } = findSafeWindow(data.hourly.time, data.hourly.pm2_5);
    const startValue = data.hourly.time[startIndex]!;
    const endValue = data.hourly.time[endIndex]!;
    const startTime = new Date(startValue);
    const endTime = new Date(endValue);

    const responseData = {
      start: startTime.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      end: endTime.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      avg_pm25: averagePm25.toFixed(1)
    };

    // 2. Simpan ke Cache
    cache.set(cacheKey, { data: responseData, expiry: Date.now() + CACHE_TTL });

    return send(res, { success: true, source: 'api', data: responseData });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menghitung jendela aman';
    return send(res, { success: false, error: message }, 500);
  }
});
