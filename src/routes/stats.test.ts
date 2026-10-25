import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { closeDb, getDb } from '../db/database';
import { upsertAirQuality } from '../workers/aqicnSync';
import { upsertHotspots } from '../workers/nasaSync';
import { createApp } from '../app';

// Menguji lewat HTTP sungguhan; butuh `bun install` (express) di folder backend.
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
const originalPath = Bun.env.SQLITE_PATH;

beforeEach(() => {
  Bun.env.SQLITE_PATH = ':memory:';
  const db = getDb();
  const recent = new Date().toISOString();
  upsertHotspots(db, [
    { id: 'm1', lat: 3.5, lon: 98.6, confidence: 80, detected_at: recent, source: 'NASA_FIRMS' },
    { id: 'r1', lat: 0.0, lon: 101.4, confidence: 99, detected_at: recent, source: 'NASA_FIRMS' }
  ]);
  upsertAirQuality(db, [
    { uid: 1, city_name: 'Medan', lat: 3.5, lon: 98.6, aqi: 30, updated_at: recent },
    { uid: 2, city_name: 'Medan 2', lat: 3.6, lon: 98.7, aqi: 250, updated_at: recent }
  ]);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(() => {
  server.close();
  closeDb();
  if (originalPath === undefined) delete Bun.env.SQLITE_PATH;
  else Bun.env.SQLITE_PATH = originalPath;
});

const get = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as any };
};

describe('stats and hotspots', () => {
  it('summarises national data', async () => {
    const { body } = await get('/api/v1/stats');
    expect(body.data.isLocal).toBe(false);
    expect(body.data.totalHotspots).toBe(2);
    expect(body.data.aqiDistribution).toEqual([1, 0, 0, 1]);
    expect(body.data.topProvinces).toHaveLength(10);
  });

  it('summarises local data around the user and validates coordinates', async () => {
    const { body } = await get('/api/v1/stats?lat=3.5&lon=98.6');
    expect(body.data.isLocal).toBe(true);
    expect(body.data.totalHotspots).toBe(1);
    expect(body.data.topProvinces[0].name).toBe('Sumatera Utara');
    expect((await get('/api/v1/stats?lat=95&lon=0')).status).toBe(400);
  });

  it('lists recent hotspots and validates days', async () => {
    const { body } = await get('/api/v1/hotspots?days=3');
    expect(body.meta.count).toBe(2);
    expect((await get('/api/v1/hotspots?days=99')).status).toBe(400);
  });
});
