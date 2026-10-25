import { describe, expect, it } from 'bun:test';
import { safeWindowRoute } from './safeWindow';

function mockReqRes(options: { query?: Record<string, string> }) {
  const state = {
    status: 200,
    body: undefined as any
  };
  const req: any = {
    query: options.query ?? {}
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

describe('safeWindow route', () => {
  const originalFetch = globalThis.fetch;

  it('rejects invalid coordinate query params with 400', async () => {
    const { req, res, state } = mockReqRes({ query: { lat: '95', lon: '0' } });
    const layer = (safeWindowRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(400);
    expect(state.body.success).toBe(false);
  });

  it('calculates safe window successfully from Open-Meteo', async () => {
    const times = [
      '2026-10-25T00:00',
      '2026-10-25T01:00',
      '2026-10-25T02:00',
      '2026-10-25T03:00'
    ];
    const pm25 = [25.0, 15.0, 10.0, 12.0];

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          hourly: { time: times, pm2_5: pm25 }
        })
      )) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '-6.2', lon: '106.8' } });
    const layer = (safeWindowRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.source).toBe('api');
    expect(state.body.data.avg_pm25).toBeDefined();

    // Cache hit test for same coordinates
    const cachedCall = mockReqRes({ query: { lat: '-6.2', lon: '106.8' } });
    await layer.route.stack[0].handle(cachedCall.req, cachedCall.res);
    expect(cachedCall.state.status).toBe(200);
    expect(cachedCall.state.body.source).toBe('cache');

    globalThis.fetch = originalFetch;
  });

  it('returns 500 when Open-Meteo request fails', async () => {
    globalThis.fetch = (async () =>
      new Response('Service Unavailable', { status: 503 })) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '1.23', lon: '104.56' } });
    const layer = (safeWindowRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
    expect(state.body.error).toContain('Open-Meteo gagal');

    globalThis.fetch = originalFetch;
  });

  it('returns 500 when network throws an unexpected error', async () => {
    globalThis.fetch = (async () => {
      throw 'string error';
    }) as any;

    const { req, res, state } = mockReqRes({ query: { lat: '5.12', lon: '96.34' } });
    const layer = (safeWindowRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe('Gagal menghitung jendela aman');

    globalThis.fetch = originalFetch;
  });
});
