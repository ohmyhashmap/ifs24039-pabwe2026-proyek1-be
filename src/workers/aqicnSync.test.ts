import { describe, expect, it, mock } from 'bun:test';
import { normalizeAqicnRecords, syncAqicnData, startAqicnWorker } from './aqicnSync';
import { Database } from 'bun:sqlite';

describe('normalizeAqicnRecords', () => {
  it('maps valid AQI stations to database records', () => {
    const [record] = normalizeAqicnRecords([
      { uid: 42, aqi: '55', lat: 3, lon: 100, station: { name: 'Medan' } }
    ]);

    expect(record).toMatchObject({
      uid: 42,
      city_name: 'Medan',
      lat: 3,
      lon: 100,
      aqi: 55
    });
    expect(Number.isNaN(Date.parse(record!.updated_at))).toBe(false);
  });

  it('drops missing, non-numeric, and out-of-range station data', () => {
    expect(
      normalizeAqicnRecords([
        { uid: 1, aqi: '-', lat: 0, lon: 0 },
        { uid: 2, aqi: 'bad', lat: 0, lon: 0 },
        { uid: 3, aqi: '20', lat: 91, lon: 0 }
      ])
    ).toEqual([]);
  });
});

describe('syncAqicnData', () => {
  it('exits early when AQICN_TOKEN is missing', async () => {
    const originalToken = Bun.env.AQICN_TOKEN;
    delete Bun.env.AQICN_TOKEN;
    const fetcher = mock(async () => new Response());

    await syncAqicnData(fetcher as any);
    expect(fetcher).not.toHaveBeenCalled();

    if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
  });

  it('handles invalid response status or data shape', async () => {
    const originalToken = Bun.env.AQICN_TOKEN;
    Bun.env.AQICN_TOKEN = 'test-token';

    const fetcher = mock(async () => new Response(JSON.stringify({ status: 'error' })));
    await syncAqicnData(fetcher as any);
    expect(fetcher).toHaveBeenCalled();

    if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
    else delete Bun.env.AQICN_TOKEN;
  });

  it('handles response with no valid records', async () => {
    const originalToken = Bun.env.AQICN_TOKEN;
    Bun.env.AQICN_TOKEN = 'test-token';

    const fetcher = mock(
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            data: [{ uid: 1, aqi: '-' }]
          })
        )
    );
    await syncAqicnData(fetcher as any);
    expect(fetcher).toHaveBeenCalled();

    if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
    else delete Bun.env.AQICN_TOKEN;
  });

  it('successfully syncs and upserts records to the database', async () => {
    const originalToken = Bun.env.AQICN_TOKEN;
    Bun.env.AQICN_TOKEN = 'test-token';

    const db = new Database(':memory:');
    db.run(`
      CREATE TABLE air_quality_logs (
        uid INTEGER PRIMARY KEY,
        city_name TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        aqi INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const fetcher = mock(
      async () =>
        new Response(
          JSON.stringify({
            status: 'ok',
            data: [
              {
                uid: 101,
                aqi: 45,
                lat: 3.59,
                lon: 98.67,
                station: { name: 'Medan Sunggal' }
              }
            ]
          })
        )
    );

    await syncAqicnData(fetcher as any, db);
    const row = db.query('SELECT * FROM air_quality_logs WHERE uid = 101').get() as any;
    expect(row).toBeDefined();
    expect(row.city_name).toBe('Medan Sunggal');
    expect(row.aqi).toBe(45);
    db.close();

    if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
    else delete Bun.env.AQICN_TOKEN;
  });

  it('catches and logs errors gracefully', async () => {
    const originalToken = Bun.env.AQICN_TOKEN;
    Bun.env.AQICN_TOKEN = 'test-token';

    const fetcher = mock(async () => {
      throw new Error('Network error\r\nwith newlines');
    });
    await syncAqicnData(fetcher as any);

    const nonErrorFetcher = mock(async () => {
      throw 'string error';
    });
    await syncAqicnData(nonErrorFetcher as any);

    if (originalToken !== undefined) Bun.env.AQICN_TOKEN = originalToken;
    else delete Bun.env.AQICN_TOKEN;
  });
});

describe('startAqicnWorker', () => {
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

    startAqicnWorker(mockSync, mockSchedule as any);

    expect(scheduledExpression).toBe('0 * * * *');
    expect(syncCount).toBe(1);

    if (scheduledTask) {
      scheduledTask();
      expect(syncCount).toBe(2);
    }
  });
});
