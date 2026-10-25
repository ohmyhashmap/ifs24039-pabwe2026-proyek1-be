import { describe, expect, it } from 'bun:test';
import { createAuthRoute } from './auth';
import { AuthError, type AuthService } from '../auth/authService';

function mockReqRes(options: {
  userId?: number;
  body?: unknown;
}) {
  const state = {
    status: 200,
    body: undefined as any
  };
  const req: any = {
    userId: options.userId,
    body: options.body
  };
  const res: any = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(data: any) {
      state.body = data;
      return res;
    }
  };
  return { req, res, state };
}

describe('auth route unexpected error handling', () => {
  const failingService: AuthService = {
    register() {
      throw new Error('Unexpected DB error in register');
    },
    login() {
      throw new AuthError('Username atau password salah', 401);
    },
    me() {
      throw new Error('Unexpected DB error in me');
    },
    updateProfile() {
      throw new Error('Unexpected DB error in profile');
    },
    changePassword() {
      throw new Error('Unexpected DB error in password');
    }
  };

  const route = createAuthRoute(failingService);

  const getHandler = (path: string, method: 'get' | 'post' | 'put') => {
    const layer = (route as any).stack.find(
      (l: any) => l.route && l.route.path === path && l.route.methods[method]
    );
    return layer.route.stack[layer.route.stack.length - 1].handle;
  };

  it('handles unexpected errors on POST /register', () => {
    const { req, res, state } = mockReqRes({ body: {} });
    getHandler('/register', 'post')(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Terjadi kesalahan pada server');
  });

  it('handles AuthError on POST /login', () => {
    const { req, res, state } = mockReqRes({ body: {} });
    getHandler('/login', 'post')(req, res);

    expect(state.status).toBe(401);
    expect(state.body.error).toBe('Username atau password salah');
  });

  it('handles unexpected errors on GET /me', () => {
    const { req, res, state } = mockReqRes({ userId: 1 });
    getHandler('/me', 'get')(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Terjadi kesalahan pada server');
  });

  it('handles unexpected errors on PUT /profile', () => {
    const { req, res, state } = mockReqRes({ userId: 1, body: { name: 'Test' } });
    getHandler('/profile', 'put')(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Terjadi kesalahan pada server');
  });

  it('handles unexpected errors on PUT /password', () => {
    const { req, res, state } = mockReqRes({ userId: 1, body: {} });
    getHandler('/password', 'put')(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Terjadi kesalahan pada server');
  });
});
