import { describe, expect, it } from 'bun:test';
import { buildTrajectory, getDestination } from './trajectoryAnalysis';

describe('trajectory analysis', () => {
  it('calculates a destination in the requested direction', () => {
    const destination = getDestination(0, 0, 90, 111.2);
    expect(destination.lat).toBeCloseTo(0, 1);
    expect(destination.lon).toBeCloseTo(1, 1);
  });

  it('keeps the origin and projects each non-zero six-hour wind step', () => {
    const speeds = [
      10, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 40
    ];
    const directions = Array.from({ length: speeds.length }, () => 0);

    const points = buildTrajectory({ lat: 3, lon: 100 }, speeds, directions);

    expect(points).toHaveLength(5);
    expect(points[0]).toEqual([100, 3]);
    expect(points.slice(1).every(([, lat]) => lat < 3)).toBe(true);
  });

  it('does not project when winds are absent', () => {
    expect(buildTrajectory({ lat: 3, lon: 100 }, [], [])).toEqual([[100, 3]]);
  });
});
