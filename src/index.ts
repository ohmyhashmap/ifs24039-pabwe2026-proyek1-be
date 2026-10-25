import { createApp } from './app';
import { getJwtSecret } from './auth/security';
import { startAqicnWorker } from './workers/aqicnSync';
import { startNasaWorker } from './workers/nasaSync';

// ── Startup diagnostics ────────────────────────────────────────────────────────
// Semua info yang dibutuhkan untuk diagnosa bila deploy gagal.
// TIDAK mencetak nilai secret — hanya status "set" / "MISSING".
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';

console.log(`[BOOT] PID=${process.pid} at ${new Date().toISOString()}`);
console.log(`[BOOT] PORT=${PORT} HOST=${HOST}`);
console.log(`[BOOT] NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
console.log(`[BOOT] CWD=${process.cwd()}`);
console.log(`[BOOT] SQLITE_PATH=${process.env.SQLITE_PATH ?? '(default ./data/sigapasap.db)'}`);
console.log(`[BOOT] JWT_SECRET=${process.env.JWT_SECRET ? 'set' : 'MISSING'}`);
console.log(`[BOOT] AQICN_TOKEN=${process.env.AQICN_TOKEN ? 'set' : 'MISSING'}`);
console.log(
  `[BOOT] NASA_MAP_KEY=${
    process.env.NASA_MAP_KEY || process.env.NASA_FIRMS_MAP_KEY ? 'set' : 'MISSING'
  }`
);

// ── Fail-fast JWT ──────────────────────────────────────────────────────────────
// getJwtSecret() akan throw di production bila JWT_SECRET tidak diset.
// Tangkap supaya log jelas, lalu exit — bukan crash cryptic.
try {
  getJwtSecret();
  console.log('[BOOT] JWT secret validated');
} catch (err) {
  console.error('[BOOT] FATAL: JWT secret tidak valid:', err);
  process.exit(1);
}

// ── Buat app (bisa throw kalau getDb() gagal) ──────────────────────────────────
// createApp() memanggil getDb() untuk auth route. Kalau SQLITE_PATH salah
// atau folder data/ tidak ada, ini akan throw SEBELUM listen.
let app: ReturnType<typeof createApp>;
try {
  app = createApp();
  console.log('[BOOT] App created');
} catch (err) {
  console.error('[BOOT] FATAL: createApp() gagal:', err);
  process.exit(1);
}

// ── Listen SEBELUM worker ──────────────────────────────────────────────────────
// Urutan penting: listen dulu, baru worker. Kalau worker memblok (mis. fetch
// API eksternal lambat), app tetap melayani /health dan Verify tidak false-negative.
const server = app.listen(PORT, HOST, () => {
  console.log(`[BOOT] ✅ SigapAsap API listening on http://${HOST}:${PORT}`);
});

// EADDRINUSE dll → log jelas, lalu exit
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(`[BOOT] FATAL: listen error code=${err.code} message=${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[BOOT] Port ${PORT} masih dipegang proses lain. ` +
      `Jalankan: fuser -k ${PORT}/tcp atau pkill -9 -f 'src/index[.]ts'`
    );
  }
  process.exit(1);
});

// ── Worker setelah listen ──────────────────────────────────────────────────────
startAqicnWorker();
startNasaWorker();
console.log('[BOOT] Workers scheduled');

// ── Graceful shutdown ──────────────────────────────────────────────────────────
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[BOOT] ${sig} received — shutting down`);
    server.close(() => {
      console.log('[BOOT] Server closed');
      process.exit(0);
    });
    // Force exit kalau >10 detik tidak tutup
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}