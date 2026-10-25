import { createApp } from './app';
import { getJwtSecret } from './auth/security';
import { startAqicnWorker } from './workers/aqicnSync';
import { startNasaWorker } from './workers/nasaSync';

getJwtSecret(); // gagal cepat bila JWT_SECRET belum diset di production

const port = Number(process.env.PORT) || 8787;
createApp().listen(port, () => {
  console.log(`SigapAsap API berjalan di port ${port}`);
});

startAqicnWorker();
startNasaWorker();
