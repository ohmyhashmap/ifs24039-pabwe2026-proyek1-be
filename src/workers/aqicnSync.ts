import cron from 'node-cron';
import { z } from 'zod';
import type { Database } from 'bun:sqlite';
import { getDb } from '../db/database';
import { runWorkerTask } from './runWorkerTask';

type AqicnStation = {
  uid?: number;
  aqi?: string | number | null;
  lat?: number;
  lon?: number;
  station?: { name?: string };
};

export type AirQualityRecord = {
  uid: number;
  city_name: string;
  lat: number;
  lon: number;
  aqi: number;
  updated_at: string;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const AqicnResponseSchema = z.object({
  status: z.string(),
  data: z
    .array(
      z.object({
        uid: z.number().optional(),
        aqi: z.union([z.string(), z.number(), z.null()]).optional(),
        lat: z.number().optional(),
        lon: z.number().optional(),
        station: z.object({ name: z.string().optional() }).optional()
      })
    )
    .optional()
});

export function normalizeAqicnRecords(stations: readonly AqicnStation[]): AirQualityRecord[] {
  return stations.flatMap((station) => {
    const aqi = Number(station.aqi);
    if (
      typeof station.uid !== 'number' ||
      !Number.isInteger(station.uid) ||
      station.aqi === '-' ||
      station.aqi === null ||
      station.aqi === undefined ||
      !Number.isFinite(aqi) ||
      typeof station.lat !== 'number' ||
      !Number.isFinite(station.lat) ||
      typeof station.lon !== 'number' ||
      !Number.isFinite(station.lon) ||
      station.lat < -90 ||
      station.lat > 90 ||
      station.lon < -180 ||
      station.lon > 180
    ) {
      return [];
    }

    return [
      {
        uid: station.uid,
        city_name: station.station?.name || 'Tidak Diketahui',
        lat: station.lat,
        lon: station.lon,
        aqi,
        updated_at: new Date().toISOString()
      }
    ];
  });
}

export function upsertAirQuality(db: Database, records: readonly AirQualityRecord[]): void {
  const statement = db.query(
    `INSERT INTO air_quality_logs (uid, city_name, lat, lon, aqi, updated_at)
     VALUES ($uid, $city_name, $lat, $lon, $aqi, $updated_at)
     ON CONFLICT(uid) DO UPDATE SET
       city_name = excluded.city_name, lat = excluded.lat, lon = excluded.lon,
       aqi = excluded.aqi, updated_at = excluded.updated_at`
  );
  db.transaction(() => {
    for (const r of records) {
      statement.run({
        $uid: r.uid,
        $city_name: r.city_name,
        $lat: r.lat,
        $lon: r.lon,
        $aqi: r.aqi,
        $updated_at: r.updated_at
      });
    }
  })();
}

export async function syncAqicnData(fetcher: Fetcher = fetch, db: Database = getDb()) {
  console.log(`\n[CRON AQICN] Memulai sinkronisasi seluruh stasiun Indonesia...`);
  const token = Bun.env.AQICN_TOKEN;
  if (!token) return console.log('Token AQICN tidak ditemukan');

  try {
    // AQICN Bounds API: lat1,lon1,lat2,lon2 (South, West, North, East)
    // Wilayah Indonesia: -11,95 (Bawah Kiri) s/d 6,141 (Atas Kanan)
    const url = `https://api.waqi.info/map/bounds/?token=${token}&latlng=-11,95,6,141`;

    const res = await fetcher(url, { signal: AbortSignal.timeout(20000) });
    const json = AqicnResponseSchema.parse(await res.json());

    if (json.status !== 'ok' || !Array.isArray(json.data)) {
      console.error('[CRON AQICN] Format respons tidak valid.');
      return;
    }

    const records = normalizeAqicnRecords(json.data);
    console.log('[CRON AQICN] Respons stasiun diproses.');

    if (records.length === 0) {
      console.log('[CRON AQICN] Tidak ada data AQI yang valid.');
      return;
    }

    // Simpan ke SQLite (upsert berdasarkan UID)
    upsertAirQuality(db, records);

    console.log(`[CRON AQICN] ✅ Sukses update ${records.length} stasiun udara di Indonesia.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ') : 'Unknown error';
    console.error('[CRON AQICN] ❌ Gagal sinkronisasi:', message);
  }
}

export function startAqicnWorker(
  runSync: () => Promise<void> = syncAqicnData,
  schedule: (expression: string, task: () => void) => unknown = cron.schedule
) {
  console.log('✅ Worker AQICN berjalan.');
  void runWorkerTask('AQICN', runSync());
  schedule('0 * * * *', () => {
    void runWorkerTask('AQICN', runSync());
  }); // Setiap 1 jam
}
