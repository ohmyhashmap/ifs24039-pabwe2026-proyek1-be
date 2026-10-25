import { describe, expect, it } from 'bun:test';
import { parseCoordinates } from './coordinates';

describe('parseCoordinates', () => {
  it('uses defaults only when both coordinates are omitted', () => {
    expect(
      parseCoordinates(undefined, undefined, { lat: -6.2, lon: 106.8 })
    ).toEqual({
      lat: -6.2,
      lon: 106.8
    });
  });

  it('parses valid decimal coordinates', () => {
    expect(parseCoordinates('-6.2', '106.8')).toEqual({
      lat: -6.2,
      lon: 106.8
    });
  });

  it.each([
    ['91', '0'],
    ['0', '181'],
    ['', '0'],
    ['0\r\nmalicious', '0'],
    ['0', undefined]
  ])('rejects invalid coordinate input %j, %j', (lat, lon) => {
    expect(() => parseCoordinates(lat, lon)).toThrow();
  });
});
