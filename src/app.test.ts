import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createApp, errorHandler } from './app';
import { closeDb } from './db/database';

const originalPath = Bun.env.SQLITE_PATH;

// ── Helpers ────────────────────────────────────────────────────────────────────
// Alih-alih menjalankan server HTTP (yang diblokir sandbox), kita panggil
// Express app langsung via `app.handle()` dengan req/res minimal.

function createMockRes() {
  const state = {
    status: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    text: undefined as string | undefined,
    headersSent: false
  };
  const res: any = {
    _header: '',            // Express memeriksa ini untuk "headers already sent"
    headersSent: false,
    statusCode: 200,
    getHeader(k: string) {
      return state.headers[k.toLowerCase()];
    },
    setHeader(k: string, v: string) {
      state.headers[k.toLowerCase()] = v;
      return res;
    },
    removeHeader() { return res; },
    status(code: number) {
      state.status = code;
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      state.body = data;
      state.headersSent = true;
      return res;
    },
    send(data: any) {
      if (typeof data === 'string') state.text = data;
      else state.body = data;
      state.headersSent = true;
      return res;
    },
    end() {
      state.headersSent = true;
      return res;
    },
    type(t: string) {
      state.headers['content-type'] = t;
      return res;
    },
    on() { return res; },
    once() { return res; },
    emit() { return res; },
    write() { return res; }
  };
  return { res, state };
}

function createMockReq(method: string, url: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  return {
    method,
    url,
    headers,
    body,
    on(_event: string, _cb: () => void) {
      return this;
    },
    connection: { encrypted: false },
    socket: { remoteAddress: '127.0.0.1' }
  } as any;
}

function invoke(app: any, method: string, url: string, body?: unknown, token?: string) {
  return new Promise<{ status: number; body: any; text?: string }>((resolve) => {
    const req = createMockReq(method, url, body, token);
    const { res, state } = createMockRes();

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);

    res.json = (data: any) => { originalJson(data); resolve(state); return res; };
    res.send = (data: any) => { originalSend(data); resolve(state); return res; };
    res.end = () => { originalEnd(); resolve(state); return res; };

    app.handle(req, res);
  });
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────────
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  Bun.env.SQLITE_PATH = ':memory:';
  closeDb();
  app = createApp();
});

afterEach(() => {
  closeDb();
  if (originalPath === undefined) delete Bun.env.SQLITE_PATH;
  else Bun.env.SQLITE_PATH = originalPath;
});

// ── Tests ──────────────────────────────────────────────────────────────────────
describe('app basics', () => {
  it('serves the root, health and 404 responses', async () => {
    const root = await invoke(app, 'GET', '/');
    expect(root.text).toContain('running');

    const health = await invoke(app, 'GET', '/api/v1/health');
    expect(health.body.status).toBe('ok');

    const notFound = await invoke(app, 'GET', '/api/v1/tidak-ada');
    expect(notFound.status).toBe(404);
    expect(notFound.body).toEqual({ success: false, error: 'Endpoint tidak ditemukan' });
  });

  it('validates coordinate query strings', async () => {
    expect((await invoke(app, 'GET', '/api/v1/environment?lat=91&lon=0')).status).toBe(400);
    expect((await invoke(app, 'GET', '/api/v1/trajectory?lat=1&lon=2%0Aexample')).status).toBe(400);
  });

  it('serves news and recommendations', async () => {
    const news = await invoke(app, 'GET', '/api/v1/news');
    expect(news.body.data).toHaveLength(3);

    const article = await invoke(app, 'GET', '/api/v1/news/kolaborasi-nasa-bmkg');
    expect(article.status).toBe(200);

    const missing = await invoke(app, 'GET', '/api/v1/news/x');
    expect(missing.status).toBe(404);

    const rec = await invoke(app, 'GET', '/api/v1/recommendations?aqi=120&profile=anak');
    expect(rec.body.data.message).toContain('upacara');
  });
});

// ── Error handler (uji cabang langsung, tanpa menyentuh internal Express) ──────
describe('errorHandler', () => {
  it('returns 500 for unexpected errors and logs them', () => {
    const { res, state } = createMockRes();
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      errorHandler(new Error('Unexpected crash'), {} as any, res, (() => {}) as any);
    } finally {
      spy.mockRestore();
    }
    expect(state.status).toBe(500);
    expect(state.body).toEqual({ success: false, error: 'Terjadi kesalahan pada server' });
  });

  it('returns 400 for a SyntaxError instance', () => {
    const { res, state } = createMockRes();
    const err: any = new SyntaxError('Unexpected token');
    err.status = 400;
    errorHandler(err, {} as any, res, (() => {}) as any);
    expect(state.status).toBe(400);
    expect(state.body).toEqual({ success: false, error: 'Body bukan JSON valid' });
  });

  it('returns 400 for any error carrying status 400', () => {
    const { res, state } = createMockRes();
    errorHandler({ status: 400, message: 'bad json' } as any, {} as any, res, (() => {}) as any);
    expect(state.status).toBe(400);
    expect(state.body).toEqual({ success: false, error: 'Body bukan JSON valid' });
  });
});

describe('authentication flow', () => {
  const user = { name: 'Budi', username: 'budi', password: 'rahasia123' };

  it('registers, logs in and reads the profile', async () => {
    const registered = await invoke(app, 'POST', '/api/v1/auth/register', user);
    expect(registered.status).toBe(201);
    expect((await invoke(app, 'POST', '/api/v1/auth/register', user)).status).toBe(409);

    const login = await invoke(app, 'POST', '/api/v1/auth/login', { username: 'budi', password: 'rahasia123' });
    expect(login.status).toBe(200);
    const token = login.body.data.token;

    const me = await invoke(app, 'GET', '/api/v1/auth/me', undefined, token);
    expect(me.body.data.username).toBe('budi');

    expect((await invoke(app, 'POST', '/api/v1/auth/login', { username: 'budi', password: 'x' })).status).toBe(401);
    expect((await invoke(app, 'POST', '/api/v1/auth/register', {})).status).toBe(400);
  });

  it('protects private endpoints', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/auth/me'],
      ['PUT', '/api/v1/auth/profile'],
      ['PUT', '/api/v1/auth/password'],
      ['GET', '/api/v1/reports/mine']
    ] as const) {
      expect((await invoke(app, method, path)).status).toBe(401);
    }
    expect((await invoke(app, 'GET', '/api/v1/auth/me', undefined, 'abc.def.ghi')).status).toBe(401);
  });

  it('updates profile and password', async () => {
    const { body } = await invoke(app, 'POST', '/api/v1/auth/register', user);
    const token = body.data.token;

    const profile = await invoke(app, 'PUT', '/api/v1/auth/profile', { name: 'Budi Baru' }, token);
    expect(profile.body.data.name).toBe('Budi Baru');

    const change = await invoke(app, 'PUT', '/api/v1/auth/password', { currentPassword: 'rahasia123', newPassword: 'barubaru' }, token);
    expect(change.status).toBe(200);

    expect((await invoke(app, 'POST', '/api/v1/auth/login', { username: 'budi', password: 'barubaru' })).status).toBe(200);
  });
});

describe('reports', () => {
  it('links reports to the signed-in user and lists them under /mine', async () => {
    const { body } = await invoke(app, 'POST', '/api/v1/auth/register', { name: 'A', username: 'akun-a', password: 'rahasia123' });
    const token = body.data.token;
    const report = { lat: 3.5, lon: 98.6, description: 'Asap tebal di jalan', severity: 'tinggi' };

    expect((await invoke(app, 'POST', '/api/v1/reports', report, token)).status).toBe(201);
    expect((await invoke(app, 'POST', '/api/v1/reports', report)).status).toBe(201); // tamu

    const all = await invoke(app, 'GET', '/api/v1/reports');
    expect(all.body.data).toHaveLength(2);

    const mine = await invoke(app, 'GET', '/api/v1/reports/mine', undefined, token);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].description).toBe('Asap tebal di jalan');
  });

  it('validates input and limits', async () => {
    const bad = await invoke(app, 'POST', '/api/v1/reports', { lat: 200, lon: 0, description: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.lat).toBeDefined();

    expect((await invoke(app, 'GET', '/api/v1/reports?limit=abc')).status).toBe(200);
    expect((await invoke(app, 'GET', '/api/v1/reports?limit=0')).status).toBe(200);
  });
});