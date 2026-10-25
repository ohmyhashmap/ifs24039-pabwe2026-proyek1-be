import { describe, expect, it } from 'bun:test';
import { parseCsv, validateNasaRequest } from './nasaFirms';

describe('NASA FIRMS CSV parsing', () => {
  it('parses quoted commas, escaped quotes, and CRLF line endings', () => {
    expect(
      parseCsv('lat,note\r\n1,"smoke, plume"\r\n2,"said ""hotspot"""')
    ).toEqual([
      ['lat', 'note'],
      ['1', 'smoke, plume'],
      ['2', 'said "hotspot"']
    ]);
  });

  it('keeps newlines inside quoted fields', () => {
    expect(parseCsv('description\n"first line\nsecond line"')).toEqual([
      ['description'],
      ['first line\nsecond line']
    ]);
  });

  it('rejects an unclosed quoted field', () => {
    expect(() => parseCsv('latitude,"unclosed')).toThrow('tanda kutip');
  });
});

describe('NASA FIRMS request validation', () => {
  it('accepts a valid bounding box and day range', () => {
    expect(() => validateNasaRequest('92,-11,141,29', 5)).not.toThrow();
  });

  it.each([
    ['92,-91,141,29', 5],
    ['92,-11,181,29', 5],
    ['92,-11,141', 5],
    ['92,-11,141,29', 0],
    ['92,-11,141,29', 11]
  ])('rejects an invalid bounding box or day range', (bbox, days) => {
    expect(() => validateNasaRequest(bbox, days)).toThrow();
  });
});
