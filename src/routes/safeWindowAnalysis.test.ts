import { describe, expect, it } from 'bun:test';
import { findSafeWindow } from './safeWindowAnalysis';

describe('findSafeWindow', () => {
  it('selects the lowest three-hour average, including the last possible window', () => {
    expect(findSafeWindow(['0', '1', '2', '3'], [40, 30, 20, 1])).toEqual({
      startIndex: 1,
      endIndex: 3,
      averagePm25: 17
    });
  });

  it('skips windows with missing values', () => {
    expect(
      findSafeWindow(['0', '1', '2', '3', '4'], [1, null, 2, 3, 4])
    ).toEqual({
      startIndex: 2,
      endIndex: 4,
      averagePm25: 3
    });
  });

  it('rejects data without a complete three-hour window', () => {
    expect(() => findSafeWindow(['0', '1'], [1, 2])).toThrow('tiga jam');
    expect(() => findSafeWindow(['0', '1', '2'], [1, null, 2])).toThrow(
      'tiga jam'
    );
    expect(() => findSafeWindow(['invalid', '1', '2'], [1, 2, 3])).toThrow(
      'waktu'
    );
  });
});
