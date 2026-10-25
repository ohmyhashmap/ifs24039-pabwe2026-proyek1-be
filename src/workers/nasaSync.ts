import cron from 'node-cron';
import { fetchNasaHotspots } from '../providers/nasaFirms';
import type { Database } from 'bun:sqlite';
import { getDb } from '../db/database';
import { processSequentially } from '../utils/processSequentially';
import { runWorkerTask } from './runWorkerTask';

// Fungsi bantuan untuk jeda
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry<T>(
  operation: () => Promise<T>,
  retries: number,
  delayMs: number,
  wait: (ms: number) => Promise<unknown> = sleep,
  onRetry: (error: unknown, attempt: number) => void = () => {}
): Promise<T> {
  if (!Number.isInteger(retries) || retries < 1) {
    throw new Error('retries harus berupa bilangan bulat positif');
  }

  const run = async (attempt: number): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) throw error;
      onRetry(error, attempt);
      await wait(delayMs);
      return run(attempt + 1);
    }
  };

  return run(1);
}

export type HotspotRecord = {
  id: string;
  lat: number;
  lon: number;
  confidence: number;
  detected_at: string;
  source: string;
};

export function upsertHotspots(db: Database, records: readonly HotspotRecord[]): void {
  const statement = db.query(
    `INSERT INTO hotspots (id, lat, lon, confidence, detected_at, source)
     VALUES ($id, $lat, $lon, $confidence, $detected_at, $source)
     ON CONFLICT(id) DO UPDATE SET
       lat = excluded.lat, lon = excluded.lon, confidence = excluded.confidence,
       detected_at = excluded.detected_at, source = excluded.source`
  );
  db.transaction(() => {
    for (const r of records) {
      statement.run({
        $id: r.id,
        $lat: r.lat,
        $lon: r.lon,
        $confidence: r.confidence,
        $detected_at: r.detected_at,
        $source: r.source
      });
    }
  })();
}

export function deleteHotspotsBefore(db: Database, isoDate: string): void {
  db.query('DELETE FROM hotspots WHERE detected_at < ?').run(isoDate);
}

export async function syncNasaData(
  retries = 3,
  wait: (ms: number) => Promise<unknown> = sleep,
  db: Database = getDb()
) {
  console.log(`\n[CRON NASA] Memulai sinkronisasi data NASA...`);

  try {
    console.log(`[CRON NASA] -> 1. Menarik data dari NASA...`);

    const data = await fetchWithRetry(
      () => fetchNasaHotspots('92,-11,141,29', 5),
      retries,
      5000,
      wait,
      (error, attempt) => {
        const message = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ') : 'Unknown error';
        console.warn(`[CRON NASA] Gagal fetch (Percobaan ${attempt}/${retries}): ${message}`);
      }
    );

    if (!data || data.length === 0) {
      console.log(`[CRON NASA] Selesai. Tidak ada titik api ditemukan.`);
      return;
    }

    console.log(`[CRON NASA] -> 2. Berhasil mendapatkan ${data.length} titik. Memproses...`);

    const records = data.map((h) => {
      let confNum = 0;
      if (typeof h.confidence === 'string') {
        if (h.confidence === 'h') confNum = 80;
        else if (h.confidence === 'n') confNum = 50;
        else if (h.confidence === 'l') confNum = 20;
      } else {
        confNum = h.confidence;
      }
      return {
        id: h.id,
        lat: h.lat,
        lon: h.lon,
        confidence: confNum,
        detected_at: h.detected_at,
        source: h.source
      };
    });

    // PERBAIKAN: Kecilkan chunk size dan beri jeda
    const CHUNK_SIZE = 500; // Dikurangi dari 1000 agar lebih aman
    let successCount = 0;
    const chunks = Array.from({ length: Math.ceil(records.length / CHUNK_SIZE) }, (_, index) =>
      records.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)
    );

    await processSequentially(chunks, async (chunk) => {
      upsertHotspots(db, chunk);

      successCount += chunk.length;
      console.log(`[CRON NASA]    -> Menyimpan... (${successCount} / ${records.length})`);

      // Jeda 500ms setiap selesai 1 chunk agar koneksi tidak putus
      await wait(500);
    });

    console.log(`[CRON NASA] -> 3. ✅ Sukses menyimpan SEMUA data ke Database!`);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    deleteHotspotsBefore(db, sevenDaysAgo.toISOString());
    console.log(`[CRON NASA] -> 4. Pembersihan data lama selesai.\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/[\r\n]/g, ' ') : 'Unknown error';
    console.error('[CRON NASA] ❌ Gagal sinkronisasi:', message);
  }
}

export function startNasaWorker(
  runSync: () => Promise<void> = syncNasaData,
  schedule: (expression: string, task: () => void) => unknown = cron.schedule
) {
  console.log('✅ Worker NASA berjalan. Menunggu jadwal 15 menit...');
  void runWorkerTask('NASA', runSync());

  schedule('*/15 * * * *', () => {
    void runWorkerTask('NASA', runSync());
  });
}
