import { describe, expect, it, mock } from 'bun:test';
import { fetchWithRetry, syncNasaData, startNasaWorker } from './nasaSync';
import { Database } from 'bun:sqlite';

describe('fetchWithRetry', () => {
  it('rejects a non-positive retry count', async () => {
    await expect(fetchWithRetry(async () => 'unused', 0, 0)).rejects.toThrow(
      'retries harus berupa bilangan bulat positif'
    );
  });

  it('retries failed requests and returns the first successful result', async () => {
    let attempts = 0;
    const onRetry = mock(() => {});
    const result = await fetchWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('temporary failure');
        return 'ok';
      },
      3,
      0,
      async () => {},
      onRetry
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('propagates the last failure when all retries are exhausted', async () => {
    await expect(
      fetchWithRetry(
        async () => {
          throw new Error('offline');
        },
        2,
        0,
        async () => {}
      )
    ).rejects.toThrow('offline');
  });

  it('uses the default wait between retries', async () => {
    let attempts = 0;
    const result = await fetchWithRetry(
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('temporary failure');
        return 'ok';
      },
      2,
      0
    );

    expect(result).toBe('ok');
    expect(attempts).toBe(2);
  });
});

describe('syncNasaData', () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Bun.env.NASA_MAP_KEY;

  it('handles empty hotspot list from NASA', async () => {
    Bun.env.NASA_MAP_KEY = 'test-key';
    globalThis.fetch = (async () => {
      return new Response('latitude,longitude,confidence,acq_date,acq_time\n');
    }) as any;

    const db = new Database(':memory:');
    await syncNasaData(1, async () => {}, db);
    db.close();

    if (originalKey !== undefined) Bun.env.NASA_MAP_KEY = originalKey;
    else delete Bun.env.NASA_MAP_KEY;
    globalThis.fetch = originalFetch;
  });

  it('fetches, normalizes various confidence values, and inserts chunks into db', async () => {
    Bun.env.NASA_MAP_KEY = 'test-key';
    const csvContent = [
      'latitude,longitude,confidence,acq_date,acq_time',
      '3.5,98.6,h,2026-10-25,1200',
      '3.6,98.7,n,2026-10-25,1200',
      '3.7,98.8,l,2026-10-25,1200',
      '3.8,98.9,90,2026-10-25,1200'
    ].join('\n');

    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      if (attempts === 1) throw new Error('First attempt failure');
      return new Response(csvContent);
    }) as any;

    const db = new Database(':memory:');
    db.run(`
      CREATE TABLE hotspots (
        id TEXT PRIMARY KEY,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        confidence INTEGER NOT NULL,
        detected_at TEXT NOT NULL,
        source TEXT NOT NULL
      )
    `);

    let waitCalls = 0;
    await syncNasaData(
      2,
      async () => {
        waitCalls++;
      },
      db
    );

    const rows = db.query('SELECT * FROM hotspots ORDER BY lat ASC').all() as any[];
    expect(rows).toHaveLength(4);
    expect(rows[0].confidence).toBe(80); // 'h'
    expect(rows[1].confidence).toBe(50); // 'n'
    expect(rows[2].confidence).toBe(20); // 'l'
    expect(rows[3].confidence).toBe(90); // 90
    expect(waitCalls).toBeGreaterThan(0);
    db.close();

    if (originalKey !== undefined) Bun.env.NASA_MAP_KEY = originalKey;
    else delete Bun.env.NASA_MAP_KEY;
    globalThis.fetch = originalFetch;
  });

  it('catches and logs fetch/database errors', async () => {
    Bun.env.NASA_MAP_KEY = 'test-key';
    globalThis.fetch = (async () => {
      throw new Error('Connection reset\r\n');
    }) as any;

    const db = new Database(':memory:');
    await syncNasaData(1, async () => {}, db);

    globalThis.fetch = (async () => {
      throw 'string error';
    }) as any;
    await syncNasaData(1, async () => {}, db);

    db.close();

    if (originalKey !== undefined) Bun.env.NASA_MAP_KEY = originalKey;
    else delete Bun.env.NASA_MAP_KEY;
    globalThis.fetch = originalFetch;
  });
});

describe('startNasaWorker', () => {
  it('schedules task and runs immediately', async () => {
    let scheduledExpression = '';
    let scheduledTask: (() => void) | undefined;
    let syncCount = 0;

    const mockSync = async () => {
      syncCount++;
    };
    const mockSchedule = (expression: string, task: () => void) => {
      scheduledExpression = expression;
      scheduledTask = task;
    };

    startNasaWorker(mockSync, mockSchedule as any);

    expect(scheduledExpression).toBe('*/15 * * * *');
    expect(syncCount).toBe(1);

    if (scheduledTask) {
      scheduledTask();
      expect(syncCount).toBe(2);
    }
  });
});
