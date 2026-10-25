import { Router, type Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database';
import { queryParam } from '../utils/http';
import { parseCoordinates } from '../utils/coordinates';
import { buildTrajectory } from './trajectoryAnalysis';

export const trajectoryRoute = Router();

const WeatherResponseSchema = z.object({
  hourly: z
    .object({
      wind_speed_10m: z.array(z.number().nullable()).optional(),
      wind_direction_10m: z.array(z.number().nullable()).optional()
    })
    .optional()
});
const cache = new Map<string, { data: object; expiry: number }>();
const CACHE_TTL = 15 * 60 * 1000;

type Coordinates = { lat: number; lon: number };
type Hotspot = Coordinates & { confidence: number };

type ParsedRequest =
  | { success: true; coordinates?: Coordinates; days: number; cacheKey: string }
  | { success: false; error: string };

function parseTrajectoryRequest(
  reqLat: string | undefined,
  reqLon: string | undefined,
  daysQuery: string | undefined
): ParsedRequest {
  const hasCoordinates = reqLat !== undefined || reqLon !== undefined;
  let coordinates: Coordinates | undefined;

  if (hasCoordinates) {
    try {
      coordinates = parseCoordinates(reqLat, reqLon);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Koordinat tidak valid'
      };
    }
  }

  const days = daysQuery === undefined ? 5 : Number(daysQuery);
  if (!hasCoordinates && (!Number.isInteger(days) || days < 1 || days > 10)) {
    return { success: false, error: 'days harus berupa bilangan bulat antara 1 dan 10' };
  }

  const cacheKey = coordinates
    ? `trajectory-coord-${coordinates.lat}-${coordinates.lon}`
    : `trajectory-db-${days}`;

  return { success: true, coordinates, days, cacheKey };
}

function findMainHotspot(coordinates: Coordinates | undefined, days: number): Hotspot | null {
  if (coordinates) return { ...coordinates, confidence: 100 };

  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  return (
    getDb()
      .query<Hotspot, [string]>(
        `SELECT lat, lon, confidence FROM hotspots
         WHERE detected_at >= ? ORDER BY confidence DESC LIMIT 1`
      )
      .get(dateLimit.toISOString()) ?? null
  );
}

async function createTrajectoryPayload(mainHotspot: Hotspot) {
  const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
  weatherUrl.searchParams.set('latitude', String(mainHotspot.lat));
  weatherUrl.searchParams.set('longitude', String(mainHotspot.lon));
  weatherUrl.searchParams.set('hourly', 'wind_speed_10m,wind_direction_10m');
  weatherUrl.searchParams.set('forecast_days', '2');
  const weatherRes = await fetch(weatherUrl);
  if (!weatherRes.ok) throw new Error(`Open-Meteo gagal: HTTP ${weatherRes.status}`);
  const weatherData = WeatherResponseSchema.parse(await weatherRes.json());
  const trajectoryPoints = buildTrajectory(
    mainHotspot,
    weatherData.hourly?.wind_speed_10m ?? [],
    weatherData.hourly?.wind_direction_10m ?? []
  );

  return {
    success: true,
    data: {
      origin: {
        lat: mainHotspot.lat,
        lon: mainHotspot.lon,
        confidence: mainHotspot.confidence
      },
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: trajectoryPoints },
        properties: { info: `Prediksi lintasan asap` }
      }
    }
  };
}

const send = (res: Response, body: unknown, status = 200) => {
  res.status(status).json(body);
};

trajectoryRoute.get('/', async (req, res) => {
  const request = parseTrajectoryRequest(
    queryParam(req, 'lat'),
    queryParam(req, 'lon'),
    queryParam(req, 'days')
  );
  if (!request.success) return send(res, { success: false, error: request.error }, 400);

  const { cacheKey } = request;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return send(res, cached.data);
  }

  try {
    const mainHotspot = findMainHotspot(request.coordinates, request.days);
    if (!mainHotspot) return send(res, { success: false, error: 'Tidak ada hotspot' }, 404);

    const responsePayload = await createTrajectoryPayload(mainHotspot);

    cache.set(cacheKey, {
      data: responsePayload,
      expiry: Date.now() + CACHE_TTL
    });
    return send(res, responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menghitung lintasan';
    return send(res, { success: false, error: message }, 500);
  }
});
