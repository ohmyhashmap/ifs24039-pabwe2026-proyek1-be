import { describe, expect, it } from 'bun:test';
import { newsRoute } from './news';

function mockReqRes(options: {
  path?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const state = {
    status: 200,
    body: undefined as any
  };
  const req: any = {
    url: options.path ?? '/',
    params: options.params ?? {},
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

describe('news route', () => {
  it('serves static news list on /', async () => {
    const { req, res, state } = mockReqRes({});
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/' && l.route.methods.get
    );
    layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.length).toBeGreaterThan(0);
  });

  it('serves a single article by slug on /:slug', async () => {
    const { req, res, state } = mockReqRes({
      params: { slug: 'peringatan-dini-asap-sumut' }
    });
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/:slug' && l.route.methods.get
    );
    layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.slug).toBe('peringatan-dini-asap-sumut');
  });

  it('returns 404 for unknown article slug', async () => {
    const { req, res, state } = mockReqRes({
      params: { slug: 'tidak-ada' }
    });
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/:slug' && l.route.methods.get
    );
    layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(404);
    expect(state.body.success).toBe(false);
    expect(state.body.error).toBe('Berita tidak ditemukan');
  });

  it('fetches and filters external RSS feed on /external', async () => {
    const originalFetch = globalThis.fetch;
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>CNBC News</title>
    <item>
      <title>Kebakaran Hutan &amp; Lahan Meluas & Terdeteksi</title>
      <link>https://example.com/karhutla</link>
      <pubDate>Sun, 25 Oct 2026 06:00:00 GMT</pubDate>
      <description>Titik panas karhutla dan asap bertambah.</description>
      <enclosure url="https://example.com/image1.jpg" type="image/jpeg" />
    </item>
    <item>
      <title>Kabar Pasar Saham</title>
      <link>https://example.com/saham</link>
      <pubDate>Sun, 25 Oct 2026 07:00:00 GMT</pubDate>
      <description>IHSG hari ini stabil.</description>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async () => new Response(rssXml)) as any;

    const { req, res, state } = mockReqRes({});
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/external' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.length).toBe(1);
    expect(state.body.data[0].title).toContain('Kebakaran Hutan');

    globalThis.fetch = originalFetch;
  });

  it('takes first 5 items if no items match environment keywords', async () => {
    const originalFetch = globalThis.fetch;
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>General News</title>
    <item>
      <title>Berita Finansial Satu</title>
      <link>https://example.com/1</link>
      <pubDate>Sun, 25 Oct 2026 01:00:00 GMT</pubDate>
      <description>Deskripsi umum.</description>
    </item>
  </channel>
</rss>`;

    globalThis.fetch = (async () => new Response(rssXml)) as any;

    const { req, res, state } = mockReqRes({});
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/external' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.length).toBe(1);
    expect(state.body.data[0].title).toBe('Berita Finansial Satu');

    globalThis.fetch = originalFetch;
  });

  it('falls back to internal news when external RSS fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('RSS server unreachable');
    }) as any;

    const { req, res, state } = mockReqRes({});
    const layer = (newsRoute as any).stack.find(
      (l: any) => l.route && l.route.path === '/external' && l.route.methods.get
    );
    await layer.route.stack[0].handle(req, res);

    expect(state.status).toBe(200);
    expect(state.body.success).toBe(true);
    expect(state.body.data.length).toBeGreaterThan(0);
    expect(state.body.data[0].category).toBe('Info Internal');
    expect(state.body.data[0].isExternal).toBe(false);

    globalThis.fetch = originalFetch;
  });
});
