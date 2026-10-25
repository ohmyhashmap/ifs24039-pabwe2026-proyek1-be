import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { createAuthService } from './auth/authService';
import { createUserRepository } from './auth/userRepository';
import { getDb } from './db/database';
import { createAuthRoute } from './routes/auth';
import { environmentRoute } from './routes/environment';
import { hotspotsRoute } from './routes/hotspots';
import { newsRoute } from './routes/news';
import { recommendationsRoute } from './routes/recommendations';
import { createReportsRoute } from './routes/reports';
import { safeWindowRoute } from './routes/safeWindow';
import { statsRoute } from './routes/stats';
import { trajectoryRoute } from './routes/trajectory';

// Di-export supaya bisa diuji langsung tanpa menyentuh internal Express
// (`app._router` tidak stabil / bisa undefined di Express 5).
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  // express.json() melempar SyntaxError (status 400) untuk body yang bukan JSON valid
  if (error?.status === 400 || error instanceof SyntaxError) {
    res.status(400).json({ success: false, error: 'Body bukan JSON valid' });
    return;
  }
  console.error('[ERROR]', error);
  res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
};

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors()); // Frontend di domain lain (Vercel) memanggil API ini
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.type('text/plain').send('SigapAsap API is running!');
  });
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date() });
  });

  app.use('/api/v1/auth', createAuthRoute(createAuthService(createUserRepository(getDb()))));
  app.use('/api/v1/hotspots', hotspotsRoute);
  app.use('/api/v1/environment', environmentRoute);
  app.use('/api/v1/recommendations', recommendationsRoute);
  app.use('/api/v1/trajectory', trajectoryRoute);
  app.use('/api/v1/safe-window', safeWindowRoute);
  app.use('/api/v1/reports', createReportsRoute());
  app.use('/api/v1/news', newsRoute);
  app.use('/api/v1/stats', statsRoute);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint tidak ditemukan' });
  });

  app.use(errorHandler);

  return app;
}