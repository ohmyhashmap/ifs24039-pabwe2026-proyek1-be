import { beforeEach, describe, expect, it } from 'bun:test';
import { hotspotsRoute } from './hotspots';
import { closeDb, getDb } from '../db/database';
import { upsertHotspots } from '../workers/nasaSync';

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

describe('hotspots route', () => {
  beforeEach(() => {
    Bun.env.SQLITE_PATH = ':memory:';
    closeDb();
  });

  const getHandler = () => {
    const layer = (hotspotsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    return layer.route.stack[0].handle;
  };

  it('rejects days outside 1..30 with 400', () => {
    const { req, res, state } = mockReqRes({ query: { days: '-1' } });
    getHandler()(req, res);

    expect(state.status).toBe(400);
    expect(state.body.error).toBe('days harus berupa bilangan bulat antara 1 dan 30');

    const high = mockReqRes({ query: { days: '35' } });
    getHandler()(high.req, high.res);
    expect(high.state.status).toBe(400);

    const nonInt = mockReqRes({ query: { days: '3.5' } });
    getHandler()(nonInt.req, nonInt.res);
    expect(nonInt.state.status).toBe(400);
  });

  it('queries hotspots successfully', () => {
    const db = getDb();
    upsertHotspots(db, [
      {
        id: 'h1',
        lat: 3.5,
        lon: 98.6,
        confidence: 80,
        detected_at: new Date().toISOString(),
        source: 'NASA_FIRMS'
      }
    ]);

    const { req, res, state } = mockReqRes({ query: { days: '7' } });
    getHandler()(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.length).toBe(1);
    expect(state.body.meta.days).toBe(7);
  });

  it('returns 500 when database query fails with Error and non-Error', () => {
    const db = getDb();
    // Corrupt db state by closing connection so query throws
    db.close();

    const { req, res, state } = mockReqRes({ query: { days: '5' } });
    getHandler()(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
  });
});
