import { describe, expect, it } from 'bun:test';
import { normalizeAqicnRecords } from './aqicnSync';

describe('normalizeAqicnRecords', () => {
  it('maps valid AQI stations to database records', () => {
    const [record] = normalizeAqicnRecords([
      { uid: 42, aqi: '55', lat: 3, lon: 100, station: { name: 'Medan' } }
    ]);

    expect(record).toMatchObject({
      uid: 42,
      city_name: 'Medan',
      lat: 3,
      lon: 100,
      aqi: 55
    });
    expect(Number.isNaN(Date.parse(record!.updated_at))).toBe(false);
  });

  it('drops missing, non-numeric, and out-of-range station data', () => {
    expect(
      normalizeAqicnRecords([
        { uid: 1, aqi: '-', lat: 0, lon: 0 },
        { uid: 2, aqi: 'bad', lat: 0, lon: 0 },
        { uid: 3, aqi: '20', lat: 91, lon: 0 }
      ])
    ).toEqual([]);
  });
});
