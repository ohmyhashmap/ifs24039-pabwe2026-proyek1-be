import { beforeEach, describe, expect, it } from 'bun:test';
import { trajectoryRoute } from './trajectory';
import { closeDb, getDb } from '../db/database';
import { upsertHotspots } from '../workers/nasaSync';

function mockReqRes(options: { query?: Record<string, string> }) {
  const state = {
    status: 200,
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
    json(data: any) {
      state.body = data;
      return res;
    }
  };
  return { req, res, state };
}

describe('trajectory route', () => {
  const originalFetch = globalThis.fetch;
  const originalSqlite = Bun.env.SQLITE_PATH;

  beforeEach(() => {
    Bun.env.SQLITE_PATH = ':memory:';
    closeDb();
  });

  const getLayer = () => {
    return (trajectoryRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
  };

  it('rejects invalid coordinates with 400', async () => {
    const { req, res, state } = mockReqRes({ query: { lat: '99', lon: '0' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(400);
    expect(state.body.success).toBe(false);
  });

  it('rejects invalid days parameter with 400 when coordinates are omitted', async () => {
    const { req, res, state } = mockReqRes({ query: { days: '15' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(400);
    expect(state.body.error).toContain('days harus berupa bilangan bulat antara 1 dan 10');
  });

  it('returns 404 when no hotspots exist in database', async () => {
    const { req, res, state } = mockReqRes({ query: { days: '3' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(404);
    expect(state.body.error).toBe('Tidak ada hotspot');
  });

  it('computes trajectory from coordinates successfully and caches the result', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          hourly: {
            wind_speed_10m: [10, 15],
            wind_direction_10m: [180, 200]
          }
        })
      )) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '3.5', lon: '98.6' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.origin.lat).toBe(3.5);
    expect(state.body.data.geojson.type).toBe('Feature');

    // Test cache hit
    const cachedCall = mockReqRes({ query: { lat: '3.5', lon: '98.6' } });
    await getLayer().route.stack[0].handle(cachedCall.req, cachedCall.res);
    expect(cachedCall.state.status).toBe(200);
    expect(cachedCall.state.body.data.origin.lat).toBe(3.5);

    globalThis.fetch = originalFetch;
  });

  it('computes trajectory from database hotspot when coordinates are omitted', async () => {
    const db = getDb();
    upsertHotspots(db, [
      {
        id: 'hotspot-1',
        lat: 1.5,
        lon: 102.5,
        confidence: 95,
        detected_at: new Date().toISOString(),
        source: 'NASA_FIRMS'
      }
    ]);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          hourly: {
            wind_speed_10m: [12],
            wind_direction_10m: [90]
          }
        })
      )) as any;

    const { req, res, state } = mockReqRes({});
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.origin.lat).toBe(1.5);
    expect(state.body.data.origin.confidence).toBe(95);

    globalThis.fetch = originalFetch;
  });

  it('returns 500 when Open-Meteo returns non-ok status', async () => {
    globalThis.fetch = (async () =>
      new Response('Error', { status: 502 })) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '4.1', lon: '97.2' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
    expect(state.body.error).toContain('Open-Meteo gagal');

    globalThis.fetch = originalFetch;
  });

  it('returns 500 when calculation or fetch throws a non-Error', async () => {
    globalThis.fetch = (async () => {
      throw 'string rejection';
    }) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '4.2', lon: '97.3' } });
    await getLayer().route.stack[0].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe('Gagal menghitung lintasan');

    globalThis.fetch = originalFetch;
  });
});
