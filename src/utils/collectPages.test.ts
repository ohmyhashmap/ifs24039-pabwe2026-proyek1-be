import { describe, expect, it } from 'bun:test';
import { collectPages } from './collectPages';

describe('collectPages', () => {
  it('loads sequential pages until the last partial page', async () => {
    const offsets: number[] = [];
    const items = await collectPages(async (offset) => {
      offsets.push(offset);
      return offset < 4 ? [offset, offset + 1] : [];
    }, 2);

    expect(offsets).toEqual([0, 2, 4]);
    expect(items).toEqual([0, 1, 2, 3]);
  });

  it('rejects a non-positive page size', async () => {
    await expect(collectPages(async () => [], 0)).rejects.toThrow('pageSize');
  });
});
