import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../db/database';
import { upsertAirQuality } from './aqicnSync';
import { deleteHotspotsBefore, upsertHotspots } from './nasaSync';

const hotspot = (id: string, detected_at: string, confidence = 50) => ({
  id,
  lat: 3,
  lon: 98,
  confidence,
  detected_at,
  source: 'NASA_FIRMS'
});

describe('SQLite worker storage', () => {
  it('upserts hotspots by id and prunes old rows', () => {
    const db = openDatabase(':memory:');
    upsertHotspots(db, [hotspot('a', '2026-10-20T00:00:00Z'), hotspot('b', '2026-10-24T00:00:00Z')]);
    upsertHotspots(db, [hotspot('a', '2026-10-20T00:00:00Z', 90)]);

    const rows = db.query<{ id: string; confidence: number }, []>('SELECT id, confidence FROM hotspots ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'a', confidence: 90 },
      { id: 'b', confidence: 50 }
    ]);

    deleteHotspotsBefore(db, '2026-10-22T00:00:00Z');
    expect(db.query('SELECT id FROM hotspots').all()).toEqual([{ id: 'b' }]);
  });

  it('upserts air-quality stations by uid', () => {
    const db = openDatabase(':memory:');
    const station = { uid: 7, city_name: 'Medan', lat: 3, lon: 98, aqi: 42, updated_at: 'x' };
    upsertAirQuality(db, [station]);
    upsertAirQuality(db, [{ ...station, aqi: 120 }]);
    expect(db.query('SELECT uid, aqi FROM air_quality_logs').all()).toEqual([{ uid: 7, aqi: 120 }]);
  });
});
