import { describe, expect, it } from 'bun:test';
import { processSequentially } from './processSequentially';

describe('processSequentially', () => {
  it('preserves item order and waits for each item', async () => {
    const processed: number[] = [];
    await processSequentially([1, 2, 3], async (item) => {
      await Promise.resolve();
      processed.push(item);
    });

    expect(processed).toEqual([1, 2, 3]);
  });

  it('stops when an item fails', async () => {
    const processed: number[] = [];
    await expect(
      processSequentially([1, 2, 3], async (item) => {
        processed.push(item);
        if (item === 2) throw new Error('write failed');
      })
    ).rejects.toThrow('write failed');
    expect(processed).toEqual([1, 2]);
  });
});
