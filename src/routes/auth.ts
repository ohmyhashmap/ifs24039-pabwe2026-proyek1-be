import { Router, type Response } from 'express';
import { AuthError, type AuthService } from '../auth/authService';
import { requireAuth } from '../auth/middleware';

function fail(res: Response, error: unknown) {
  if (error instanceof AuthError) {
    res.status(error.status).json({ success: false, error: error.message });
    return;
  }
  console.error('[AUTH]', error);
  res.status(500).json({ success: false, error: 'Terjadi kesalahan pada server' });
}

export function createAuthRoute(service: AuthService) {
  const route = Router();

  route.post('/register', (req, res) => {
    try {
      res.status(201).json({ success: true, data: service.register(req.body) });
    } catch (error) {
      fail(res, error);
    }
  });

  route.post('/login', (req, res) => {
    try {
      res.json({ success: true, data: service.login(req.body) });
    } catch (error) {
      fail(res, error);
    }
  });

  route.get('/me', requireAuth, (req, res) => {
    try {
      res.json({ success: true, data: service.me(req.userId!) });
    } catch (error) {
      fail(res, error);
    }
  });

  route.put('/profile', requireAuth, (req, res) => {
    try {
      res.json({ success: true, data: service.updateProfile(req.userId!, req.body) });
    } catch (error) {
      fail(res, error);
    }
  });

  route.put('/password', requireAuth, (req, res) => {
    try {
      service.changePassword(req.userId!, req.body);
      res.json({ success: true, data: {} });
    } catch (error) {
      fail(res, error);
    }
  });

  return route;
}
