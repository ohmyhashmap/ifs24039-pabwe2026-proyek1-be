import { Router, type Response } from 'express';
import { queryParam } from '../utils/http';
import { z } from 'zod';
import { parseCoordinates } from '../utils/coordinates';

const send = (res: Response, body: unknown, status = 200) => {
  res.status(status).json(body);
};

export const environmentRoute = Router();

const WaqiValueSchema = z.object({ v: z.number() });
const WaqiResponseSchema = z.object({
  status: z.string(),
  data: z
    .object({
      aqi: z.number(),
      dominentpol: z.string().optional(),
      iaqi: z
        .object({
          pm25: WaqiValueSchema.optional(),
          t: WaqiValueSchema.optional(),
          w: WaqiValueSchema.optional(),
          wd: z.object({ v: z.number().nullable() }).optional(),
          h: WaqiValueSchema.optional(),
          p: WaqiValueSchema.optional()
        })
        .optional(),
      city: z.object({ name: z.string(), url: z.string().optional() }),
      time: z.object({ iso: z.string() }).optional()
    })
    .optional()
});

const WindDirectionResponseSchema = z.object({
  current: z.object({
    wind_direction_10m: z.number().nullable().optional()
  })
});

const FallbackWeatherResponseSchema = z.object({
  current: z.object({
    wind_speed_10m: z.number(),
    wind_direction_10m: z.number(),
    temperature_2m: z.number()
  })
});

type EnvironmentData = {
  weather: {
    wind_speed: number | null;
    wind_direction: number | null;
    temperature: number | null;
    humidity: number | null;
    pressure: number | null;
  };
  aqi: {
    aqi: number;
    pm25: number | null;
    station: string;
    dominant_pollutant?: string;
  } | null;
  observation_time?: string;
  station_url?: string;
};

type CacheEntry = { data: EnvironmentData; createdAt: number };

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 15 * 60 * 1000;
const STALE_TTL = 60 * 60 * 1000;
const DEFAULT_COORDINATES = { lat: 3.5952, lon: 98.6722 };

function emptyEnvironmentData(): EnvironmentData {
  return {
    weather: {
      wind_speed: null,
      wind_direction: null,
      temperature: null,
      humidity: null,
      pressure: null
    },
    aqi: null
  };
}

function getCacheKey(lat: number, lon: number): string {
  return `env-${lat.toFixed(3)}-${lon.toFixed(3)}`;
}

environmentRoute.get('/', async (req, res) => {
  let coordinates: { lat: number; lon: number };
  try {
    coordinates = parseCoordinates(queryParam(req, 'lat'), queryParam(req, 'lon'), DEFAULT_COORDINATES);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Koordinat tidak valid';
    return send(res, { success: false, error: message }, 400);
  }

  const { lat, lon } = coordinates;
  const cacheKey = getCacheKey(lat, lon);
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (cached && now - cached.createdAt < CACHE_TTL) {
    return send(res, { success: true, source: 'cache', data: cached.data });
  }

  const staleResponse = () => {
    const entry = cache.get(cacheKey);
    if (!entry || Date.now() - entry.createdAt >= STALE_TTL) return false;

    res.setHeader('X-Data-Source', 'stale-cache');
    send(res, { success: true, source: 'stale-cache' as const, data: entry.data });
    return true;
  };

  const upstreamError = (status: 429 | 502, message: string): void => {
    if (status === 429) res.setHeader('Retry-After', '60');
    if (staleResponse()) return;

    return send(res,
      {
        success: false,
        source: 'api' as const,
        error: message,
        data: emptyEnvironmentData()
      },
      status
    );
  };

  const token = Bun.env.AQICN_TOKEN;
  if (!token) {
    try {
      const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
      weatherUrl.searchParams.set('latitude', String(lat));
      weatherUrl.searchParams.set('longitude', String(lon));
      weatherUrl.searchParams.set('current', 'wind_speed_10m,wind_direction_10m,temperature_2m');
      const weatherResponse = await fetch(weatherUrl);
      if (!weatherResponse.ok) {
        if (staleResponse()) return;
        return send(res,
          {
            success: false,
            source: 'api' as const,
            error: `Open-Meteo gagal: HTTP ${weatherResponse.status}`,
            data: emptyEnvironmentData()
          },
          500
        );
      }

      const weatherResult = FallbackWeatherResponseSchema.safeParse(await weatherResponse.json());
      if (!weatherResult.success) {
        if (staleResponse()) return;
        return send(res,
          {
            success: false,
            source: 'api' as const,
            error: 'Respons Open-Meteo tidak valid',
            data: emptyEnvironmentData()
          },
          500
        );
      }

      const currentWeather = weatherResult.data.current;
      const responseData: EnvironmentData = {
        weather: {
          wind_speed: currentWeather.wind_speed_10m,
          wind_direction: currentWeather.wind_direction_10m,
          temperature: currentWeather.temperature_2m,
          humidity: null,
          pressure: null
        },
        aqi: null
      };
      cache.set(cacheKey, { data: responseData, createdAt: Date.now() });
      return send(res, { success: true, source: 'api', data: responseData });
    } catch (error) {
      if (staleResponse()) return;
      const message = error instanceof Error ? error.message : 'Gagal mengambil data cuaca';
      return send(res,
        { success: false, source: 'api' as const, error: message, data: emptyEnvironmentData() },
        500
      );
    }
  }

  let waqiResponse: Response;
  try {
    const waqiUrl = new URL(`https://api.waqi.info/feed/geo:${lat};${lon}/`);
    waqiUrl.searchParams.set('token', token);
    waqiResponse = await fetch(waqiUrl, { signal: AbortSignal.timeout(8000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal mengambil data WAQI';
    return upstreamError(502, message);
  }

  if (waqiResponse.status === 429) {
    return upstreamError(429, 'WAQI membatasi permintaan; coba lagi nanti');
  }
  if (!waqiResponse.ok) {
    return upstreamError(502, `WAQI gagal: HTTP ${waqiResponse.status}`);
  }

  let waqiJson: unknown;
  try {
    waqiJson = await waqiResponse.json();
  } catch {
    return upstreamError(502, 'Respons WAQI bukan JSON yang valid');
  }

  const waqiResult = WaqiResponseSchema.safeParse(waqiJson);
  if (!waqiResult.success || waqiResult.data.status !== 'ok' || !waqiResult.data.data) {
    return upstreamError(502, 'Respons WAQI tidak valid atau tidak tersedia');
  }

  const station = waqiResult.data.data;
  let windDirection: number | null = null;

  // WAQI is primary; Open-Meteo supplements only the often-missing wind direction.
  try {
    const weatherUrl = new URL('https://api.open-meteo.com/v1/forecast');
    weatherUrl.searchParams.set('latitude', String(lat));
    weatherUrl.searchParams.set('longitude', String(lon));
    weatherUrl.searchParams.set('current', 'wind_direction_10m');
    const weatherResponse = await fetch(weatherUrl, { signal: AbortSignal.timeout(5000) });

    if (weatherResponse.ok) {
      const weatherJson: unknown = await weatherResponse.json();
      const weatherResult = WindDirectionResponseSchema.safeParse(weatherJson);
      if (weatherResult.success) {
        windDirection = weatherResult.data.current.wind_direction_10m ?? null;
      }
    }
  } catch {
    // Direction remains null when the optional weather service is unavailable.
  }

  const windSpeedMs = station.iaqi?.w?.v;
  const responseData: EnvironmentData = {
    weather: {
      // WAQI reports m/s; keep the frontend's existing km/h unit.
      wind_speed: windSpeedMs === undefined ? null : Math.round(windSpeedMs * 3.6 * 10) / 10,
      // May be null when the optional Open-Meteo lookup is unavailable; hide its direction arrow.
      wind_direction: windDirection,
      temperature: station.iaqi?.t?.v ?? null,
      humidity: station.iaqi?.h?.v ?? null,
      pressure: station.iaqi?.p?.v ?? null
    },
    aqi: {
      aqi: station.aqi,
      pm25: station.iaqi?.pm25?.v ?? null,
      station: station.city.name,
      ...(station.dominentpol ? { dominant_pollutant: station.dominentpol } : {})
    },
    ...(station.time?.iso ? { observation_time: station.time.iso } : {}),
    ...(station.city.url ? { station_url: station.city.url } : {})
  };

  cache.set(cacheKey, { data: responseData, createdAt: Date.now() });
  return send(res, { success: true, source: 'api', data: responseData });
});
