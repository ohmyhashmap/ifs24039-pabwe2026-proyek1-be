import { describe, expect, it } from 'bun:test';
import { createReportsRoute, type ReportsRepository } from './reports';

function mockReqRes(options: {
  userId?: number;
  query?: Record<string, string>;
  body?: unknown;
}) {
  const state = {
    status: 200,
    body: undefined as any
  };
  const req: any = {
    userId: options.userId,
    query: options.query ?? {},
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

describe('reports route error handling', () => {
  const failingRepo: ReportsRepository = {
    list() {
      throw new Error('Database disk error');
    },
    listByUser() {
      throw new Error('Database disk error');
    },
    create() {
      throw new Error('Database write error');
    }
  };

  it('returns 500 when repository list throws on GET /', async () => {
    const route = createReportsRoute(failingRepo);
    const layer = (route as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );

    const { req, res, state } = mockReqRes({});
    layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Gagal mengambil laporan');
  });

  it('returns 500 when repository listByUser throws on GET /mine', async () => {
    const route = createReportsRoute(failingRepo);
    const layer = (route as any).stack.find(
      (l: any) => l.route && l.route.path === '/mine' && l.route.methods.get
    );

    const { req, res, state } = mockReqRes({ userId: 1 });
    // Execute the final handler (index 1 after requireAuth middleware)
    layer.route.stack[layer.route.stack.length - 1].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Gagal mengambil laporan');
  });

  it('returns 500 when repository create throws on POST /', async () => {
    const route = createReportsRoute(failingRepo);
    const layer = (route as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.post
    );

    const validReport = {
      title: 'Titik Asap Terlihat',
      description: 'Asap tebal di perbukitan',
      lat: 3.5,
      lon: 98.6
    };

    const { req, res, state } = mockReqRes({ body: validReport, userId: 1 });
    layer.route.stack[layer.route.stack.length - 1].handle(req, res);

    expect(state.status).toBe(500);
    expect(state.body.error).toBe('Gagal menyimpan laporan');
  });
});
