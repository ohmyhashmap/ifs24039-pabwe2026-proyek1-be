import { describe, expect, it } from 'bun:test';
import { recommendationsRoute } from './recommendations';

function testRoute(query: Record<string, string> = {}) {
  const state = { status: 200, body: undefined as any };
  const req: any = { query };
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

  // Find the GET handler in recommendationsRoute
  const layer = (recommendationsRoute as any).stack.find(
    (l: any) => l.route && l.route.methods.get
  );
  layer.route.stack[0].handle(req, res);

  return state;
}

describe('recommendations route', () => {
  it('handles missing or zero AQI', () => {
    const res = testRoute({});
    expect(res.body.data.message).toBe('Data kualitas udara belum tersedia.');
  });

  it('returns recommendations for AQI <= 50', () => {
    expect(testRoute({ aqi: '30', profile: 'umum' }).body.data.message).toContain('Udara bersih');
    expect(testRoute({ aqi: '30', profile: 'anak' }).body.data.message).toContain('Aman untuk bermain');
    expect(testRoute({ aqi: '30', profile: 'asma' }).body.data.message).toContain('bawa inhaler');
    expect(testRoute({ aqi: '30', profile: 'lansia' }).body.data.message).toBe('Udara aman.');
  });

  it('returns recommendations for 50 < AQI <= 100', () => {
    expect(testRoute({ aqi: '80', profile: 'umum' }).body.data.message).toContain('Kualitas udara sedang');
    expect(testRoute({ aqi: '80', profile: 'anak' }).body.data.message).toContain('Batasi waktu bermain');
    expect(testRoute({ aqi: '80', profile: 'asma' }).body.data.message).toContain('Hindari paparan debu');
    expect(testRoute({ aqi: '80', profile: 'lansia' }).body.data.message).toBe('Kualitas udara sedang.');
  });

  it('returns recommendations for 100 < AQI <= 200', () => {
    expect(testRoute({ aqi: '150', profile: 'umum' }).body.data.message).toContain('Gunakan masker N95');
    expect(testRoute({ aqi: '150', profile: 'anak' }).body.data.message).toContain('Tidak disarankan upacara');
    expect(testRoute({ aqi: '150', profile: 'asma' }).body.data.message).toContain('Bahaya! Hindari keluar');
    expect(testRoute({ aqi: '150', profile: 'lansia' }).body.data.message).toBe('Tidak sehat. Gunakan masker.');
  });

  it('returns recommendations for AQI > 200 and serves from cache', () => {
    expect(testRoute({ aqi: '250', profile: 'umum' }).body.data.message).toContain('Sangat tidak sehat');
    expect(testRoute({ aqi: '250', profile: 'anak' }).body.data.message).toContain('Liburkan kegiatan');
    expect(testRoute({ aqi: '250', profile: 'asma' }).body.data.message).toContain('Darurat!');
    expect(testRoute({ aqi: '250', profile: 'lansia' }).body.data.message).toBe('Sangat tidak sehat. Tetap di rumah.');

    // Hit cache for existing key
    const cached = testRoute({ aqi: '250', profile: 'umum' });
    expect(cached.body.data.message).toContain('Sangat tidak sehat');
  });
});
