import { describe, expect, it, mock } from 'bun:test';
import { fetchWithRetry } from './nasaSync';

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
