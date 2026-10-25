import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { fetchNasaHotspots } from './nasaFirms';

const originalApiKey = Bun.env.NASA_MAP_KEY;
const csv = 'latitude,longitude,confidence,acq_date,acq_time\n3.2,101.4,h,2026-10-24,930';

afterEach(() => {
  if (originalApiKey === undefined) delete Bun.env.NASA_MAP_KEY;
  else Bun.env.NASA_MAP_KEY = originalApiKey;
});

describe('fetchNasaHotspots', () => {
  it('parses a successful NASA CSV response and encodes the API key', async () => {
    Bun.env.NASA_MAP_KEY = 'key/with space';
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      mock(async () => new Response(`\uFEFF${csv}`, { status: 200 }))
    );
    try {
      const hotspots = await fetchNasaHotspots('92,-11,141,29', 5);
      expect(hotspots).toEqual([
        {
          id: 'nasa-3.2-101.4-2026-10-24-0930',
          source: 'NASA_FIRMS',
          lat: 3.2,
          lon: 101.4,
          confidence: 'h',
          detected_at: '2026-10-24T09:30:00Z'
        }
      ]);
      expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('key%2Fwith%20space');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('parses numeric confidence and normalizes single-digit acquisition time', async () => {
    Bun.env.NASA_MAP_KEY = 'key';
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      mock(async () => new Response(csv.replace(',h,', ',82,').replace(',930', ',9'), { status: 200 }))
    );
    try {
      const [hotspot] = await fetchNasaHotspots('92,-11,141,29');
      expect(hotspot?.confidence).toBe(82);
      expect(hotspot?.detected_at).toBe('2026-10-24T00:09:00Z');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns an empty list for an empty CSV response', async () => {
    Bun.env.NASA_MAP_KEY = 'key';
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      mock(async () => new Response('', { status: 200 }))
    );
    try {
      expect(await fetchNasaHotspots('92,-11,141,29')).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects missing credentials, invalid bounds, and unsuccessful HTTP responses', async () => {
    delete Bun.env.NASA_MAP_KEY;
    await expect(fetchNasaHotspots('92,-11,141,29')).rejects.toThrow('NASA_MAP_KEY');

    Bun.env.NASA_MAP_KEY = 'key';
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      mock(async () => new Response('unavailable', { status: 503, statusText: 'Offline' }))
    );
    try {
      await expect(fetchNasaHotspots('bad', 1)).rejects.toThrow('bbox');
      await expect(fetchNasaHotspots('92,-11,141,29')).rejects.toThrow('503 Offline');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects missing CSV columns and invalid acquisition dates, times, and coordinates', async () => {
    Bun.env.NASA_MAP_KEY = 'key';
    const fetchSpy = spyOn(globalThis, 'fetch');
    try {
      fetchSpy.mockImplementationOnce(mock(async () => new Response('latitude,longitude', { status: 200 })));
      await expect(fetchNasaHotspots('92,-11,141,29')).rejects.toThrow('tidak memiliki kolom');

      for (const row of [
        '3,100,h,bad-date,930',
        '3,100,h,2026-02-30,930',
        '3,100,h,2026-10-24,2400',
        '91,100,h,2026-10-24,930',
        '3,181,h,2026-10-24,930',
        '3,100,,2026-10-24,930'
      ]) {
        fetchSpy.mockImplementationOnce(
          mock(async () => new Response(`${csv.split('\n')[0]}\n${row}`, { status: 200 }))
        );
        await expect(fetchNasaHotspots('92,-11,141,29')).rejects.toThrow();
      }
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
