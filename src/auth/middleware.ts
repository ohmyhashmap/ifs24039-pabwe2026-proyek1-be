import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyToken } from './security';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** Wajib login: 401 jika token tidak ada/tidak valid/kedaluwarsa. */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    res.status(401).json({ success: false, error: 'Sesi tidak valid atau sudah berakhir' });
    return;
  }
  req.userId = payload.sub;
  next();
};

/** Login opsional: bila token valid, `req.userId` diisi; selain itu lanjut sebagai tamu. */
export const optionalAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  const payload = token ? verifyToken(token) : null;
  if (payload) req.userId = payload.sub;
  next();
};
