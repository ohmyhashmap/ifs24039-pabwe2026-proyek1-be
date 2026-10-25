import { describe, expect, it } from 'bun:test';
import { environmentRoute } from './environment';

function mockReqRes(options: { query?: Record<string, string> }) {
  const state = {
    status: 200,
    headers: {} as Record<string, string>,
    body: undefined as any
  };
  const req: any = {
    query: options.query ?? {}
  };
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return res;
    },
    json(data: any) {
      state.body = data;
      return res;
    }
  };
  return { req, res, state };
}

describe('environment route', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = Bun.env.AQICN_TOKEN;

  const getHandler = () => {
    const layer = (environmentRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    return layer.route.stack[0].handle;
  };

  it('rejects invalid coordinates with 400', async () => {
    const { req, res, state } = mockReqRes({ query: { lat: '100', lon: '0' } });
    await getHandler()(req, res);

    expect(state.status).toBe(400);
    expect(state.body.success).toBe(false);
  });

  describe('fallback weather when AQICN_TOKEN is missing', () => {
    it('returns Open-Meteo weather and caches result', async () => {
      delete Bun.env.AQICN_TOKEN;

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            current: {
              wind_speed_10m: 14.5,
              wind_direction_10m: 120,
              temperature_2m: 29.8
            }
          })
        )) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '10.111', lon: '20.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(200);
      expect(state.body.success).toBe(true);
      expect(state.body.source).toBe('api');
      expect(state.body.data.weather.wind_speed).toBe(14.5);
      expect(state.body.data.aqi).toBeNull();

      // Second call should hit in-memory cache
      const cached = mockReqRes({ query: { lat: '10.111', lon: '20.222' } });
      await getHandler()(cached.req, cached.res);
      expect(cached.state.status).toBe(200);
      expect(cached.state.body.source).toBe('cache');

      globalThis.fetch = originalFetch;
    });

    it('returns 500 when Open-Meteo returns non-ok status', async () => {
      delete Bun.env.AQICN_TOKEN;
      globalThis.fetch = (async () => new Response('Error', { status: 503 })) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '11.111', lon: '21.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(500);
      expect(state.body.error).toContain('Open-Meteo gagal');

      globalThis.fetch = originalFetch;
    });

    it('returns 500 when Open-Meteo response schema is invalid', async () => {
      delete Bun.env.AQICN_TOKEN;
      globalThis.fetch = (async () => new Response(JSON.stringify({ current: {} }))) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '12.111', lon: '22.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(500);
      expect(state.body.error).toBe('Respons Open-Meteo tidak valid');

      globalThis.fetch = originalFetch;
    });

    it('returns 500 when Open-Meteo fetch throws an error', async () => {
      delete Bun.env.AQICN_TOKEN;
      globalThis.fetch = (async () => {
        throw new Error('Connection timeout');
      }) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '13.111', lon: '23.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(500);
      expect(state.body.error).toBe('Connection timeout');

      // Non-Error rejection
      globalThis.fetch = (async () => {
        throw 'non-error';
      }) as any;

      const nonErr = mockReqRes({ query: { lat: '14.111', lon: '24.222' } });
      await getHandler()(nonErr.req, nonErr.res);
      expect(nonErr.state.status).toBe(500);
      expect(nonErr.state.body.error).toBe('Gagal mengambil data cuaca');

      globalThis.fetch = originalFetch;
    });
  });

  describe('WAQI flow when AQICN_TOKEN is set', () => {
    it('handles WAQI fetch failure (throws error)', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';
      globalThis.fetch = (async () => {
        throw new Error('DNS failure');
      }) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '15.111', lon: '25.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(502);
      expect(state.body.error).toBe('DNS failure');

      globalThis.fetch = originalFetch;
    });

    it('handles WAQI rate limit (HTTP 429)', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';
      globalThis.fetch = (async () => new Response('Too Many Requests', { status: 429 })) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '16.111', lon: '26.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(429);
      expect(state.headers['retry-after']).toBe('60');

      globalThis.fetch = originalFetch;
    });

    it('handles WAQI upstream HTTP error', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';
      globalThis.fetch = (async () => new Response('Bad Gateway', { status: 502 })) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '17.111', lon: '27.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(502);
      expect(state.body.error).toContain('WAQI gagal');

      globalThis.fetch = originalFetch;
    });

    it('handles WAQI response that is not valid JSON', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';
      globalThis.fetch = (async () =>
        new Response('Internal Server Error', {
          headers: { 'Content-Type': 'text/html' }
        })) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '18.111', lon: '28.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(502);
      expect(state.body.error).toBe('Respons WAQI bukan JSON yang valid');

      globalThis.fetch = originalFetch;
    });

    it('handles WAQI response with invalid status or data schema', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ status: 'noid' }))) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '19.111', lon: '29.222' } });
      await getHandler()(req, res);

      expect(state.status).toBe(502);
      expect(state.body.error).toBe('Respons WAQI tidak valid atau tidak tersedia');

      globalThis.fetch = originalFetch;
    });

    it('successfully processes complete WAQI station data with Open-Meteo wind direction', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';

      globalThis.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('api.waqi.info')) {
          return new Response(
            JSON.stringify({
              status: 'ok',
              data: {
                aqi: 65,
                dominentpol: 'pm25',
                iaqi: {
                  pm25: { v: 22.4 },
                  t: { v: 31.0 },
                  w: { v: 2.5 }, // 2.5 m/s * 3.6 = 9 km/h
                  h: { v: 75.0 },
                  p: { v: 1010.0 }
                },
                city: { name: 'Stasiun Medan', url: 'https://aqicn.org/city/medan' },
                time: { iso: '2026-10-25T12:00:00+07:00' }
              }
            })
          );
        }
        if (urlStr.includes('open-meteo.com')) {
          return new Response(
            JSON.stringify({
              current: { wind_direction_10m: 220 }
            })
          );
        }
        throw new Error('Unexpected URL');
      }) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '3.595', lon: '98.672' } });
      await getHandler()(req, res);

      expect(state.status).toBe(200);
      expect(state.body.success).toBe(true);
      expect(state.body.source).toBe('api');
      expect(state.body.data.aqi.aqi).toBe(65);
      expect(state.body.data.aqi.dominant_pollutant).toBe('pm25');
      expect(state.body.data.weather.wind_speed).toBe(9);
      expect(state.body.data.weather.wind_direction).toBe(220);
      expect(state.body.data.station_url).toBe('https://aqicn.org/city/medan');
      expect(state.body.data.observation_time).toBe('2026-10-25T12:00:00+07:00');

      // Age the cache entry past CACHE_TTL (15 min) but within STALE_TTL (60 min)
      // by temporarily mocking Date.now
      const originalNow = Date.now;
      Date.now = () => originalNow() + 20 * 60 * 1000;

      globalThis.fetch = (async () => new Response('Error', { status: 500 })) as any;
      const staleCall = mockReqRes({ query: { lat: '3.595', lon: '98.672' } });
      await getHandler()(staleCall.req, staleCall.res);

      expect(staleCall.state.status).toBe(200);
      expect(staleCall.state.body.source).toBe('stale-cache');
      expect(staleCall.state.headers['x-data-source']).toBe('stale-cache');

      Date.now = originalNow;
      globalThis.fetch = originalFetch;
    });

    it('handles WAQI success when Open-Meteo wind direction throws or fails', async () => {
      Bun.env.AQICN_TOKEN = 'test-token';

      globalThis.fetch = (async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('api.waqi.info')) {
          return new Response(
            JSON.stringify({
              status: 'ok',
              data: {
                aqi: 40,
                city: { name: 'Stasiun Tanpa Detail' }
              }
            })
          );
        }
        if (urlStr.includes('open-meteo.com')) {
          throw new Error('Open-Meteo down');
        }
        throw new Error('Unexpected URL');
      }) as any;

      const { req, res, state } = mockReqRes({ query: { lat: '2.500', lon: '99.500' } });
      await getHandler()(req, res);

      expect(state.status).toBe(200);
      expect(state.body.success).toBe(true);
      expect(state.body.data.weather.wind_direction).toBeNull();
      expect(state.body.data.weather.wind_speed).toBeNull();

      if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
      else delete Bun.env.AQICN_TOKEN;
      globalThis.fetch = originalFetch;
    });
  });
});
