import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from './app';
import { closeDb } from './db/database';

// Menguji alur lengkap lewat HTTP sungguhan; butuh `bun install` (express) di folder backend.
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let base: string;
const originalPath = Bun.env.SQLITE_PATH;

beforeEach(() => {
  Bun.env.SQLITE_PATH = ':memory:';
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(() => {
  server.close();
  closeDb();
  if (originalPath === undefined) delete Bun.env.SQLITE_PATH;
  else Bun.env.SQLITE_PATH = originalPath;
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

describe('app basics', () => {
  it('serves the root, health and 404 responses', async () => {
    expect(await (await fetch(base + '/')).text()).toContain('running');
    expect((await call('GET', '/api/v1/health')).body.status).toBe('ok');
    expect((await call('GET', '/api/v1/tidak-ada')).status).toBe(404);
  });

  it('rejects invalid JSON bodies', async () => {
    const res = await call('POST', '/api/v1/auth/login', '{bukan json');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Body bukan JSON valid');
  });

  it('validates coordinate query strings', async () => {
    expect((await call('GET', '/api/v1/environment?lat=91&lon=0')).status).toBe(400);
    expect((await call('GET', '/api/v1/safe-window?lat=-6')).status).toBe(400);
    expect((await call('GET', '/api/v1/trajectory?lat=1&lon=2%0Aexample')).status).toBe(400);
  });

  it('serves news and recommendations', async () => {
    expect((await call('GET', '/api/v1/news')).body.data).toHaveLength(3);
    expect((await call('GET', '/api/v1/news/kolaborasi-nasa-bmkg')).status).toBe(200);
    expect((await call('GET', '/api/v1/news/x')).status).toBe(404);
    expect((await call('GET', '/api/v1/recommendations?aqi=120&profile=anak')).body.data.message).toContain('upacara');
  });
});

describe('authentication flow', () => {
  const user = { name: 'Budi', username: 'budi', password: 'rahasia123' };

  it('registers, logs in and reads the profile', async () => {
    const registered = await call('POST', '/api/v1/auth/register', user);
    expect(registered.status).toBe(201);
    expect((await call('POST', '/api/v1/auth/register', user)).status).toBe(409);

    const login = await call('POST', '/api/v1/auth/login', { username: 'budi', password: 'rahasia123' });
    expect(login.status).toBe(200);
    const token = login.body.data.token;
    expect((await call('GET', '/api/v1/auth/me', undefined, token)).body.data.username).toBe('budi');
    expect((await call('POST', '/api/v1/auth/login', { username: 'budi', password: 'x' })).status).toBe(401);
    expect((await call('POST', '/api/v1/auth/register', {})).status).toBe(400);
  });

  it('protects private endpoints', async () => {
    for (const [method, path] of [
      ['GET', '/api/v1/auth/me'],
      ['PUT', '/api/v1/auth/profile'],
      ['PUT', '/api/v1/auth/password'],
      ['GET', '/api/v1/reports/mine']
    ] as const) {
      expect((await call(method, path)).status).toBe(401);
    }
    expect((await call('GET', '/api/v1/auth/me', undefined, 'abc.def.ghi')).status).toBe(401);
  });

  it('updates profile and password', async () => {
    const { body } = await call('POST', '/api/v1/auth/register', user);
    const token = body.data.token;
    expect((await call('PUT', '/api/v1/auth/profile', { name: 'Budi Baru' }, token)).body.data.name).toBe('Budi Baru');
    const change = await call('PUT', '/api/v1/auth/password', { currentPassword: 'rahasia123', newPassword: 'barubaru' }, token);
    expect(change.status).toBe(200);
    expect((await call('POST', '/api/v1/auth/login', { username: 'budi', password: 'barubaru' })).status).toBe(200);
  });
});

describe('reports', () => {
  it('links reports to the signed-in user and lists them under /mine', async () => {
    const { body } = await call('POST', '/api/v1/auth/register', { name: 'A', username: 'akun-a', password: 'rahasia123' });
    const token = body.data.token;
    const report = { lat: 3.5, lon: 98.6, description: 'Asap tebal di jalan', severity: 'tinggi' };

    expect((await call('POST', '/api/v1/reports', report, token)).status).toBe(201);
    expect((await call('POST', '/api/v1/reports', report)).status).toBe(201); // tamu

    expect((await call('GET', '/api/v1/reports')).body.data).toHaveLength(2);
    const mine = await call('GET', '/api/v1/reports/mine', undefined, token);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].description).toBe('Asap tebal di jalan');
  });

  it('validates input and limits', async () => {
    const bad = await call('POST', '/api/v1/reports', { lat: 200, lon: 0, description: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.details.lat).toBeDefined();
    expect((await call('GET', '/api/v1/reports?limit=abc')).status).toBe(200);
    expect((await call('GET', '/api/v1/reports?limit=0')).status).toBe(200);
  });
});
