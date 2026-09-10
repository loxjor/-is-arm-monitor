import { describe, expect, it } from 'vitest';
import {
  angleDiffDeg,
  findSnappedGuideLineDeg,
  intersectRaySegment,
  nearestPointOnSegment,
} from './geometry';

describe('angleDiffDeg', () => {
  it('returns a simple positive difference', () => {
    expect(angleDiffDeg(10, 5)).toBe(5);
  });

  it('returns a simple negative difference', () => {
    expect(angleDiffDeg(5, 10)).toBe(-5);
  });

  it('wraps a difference above 180 down into the negative range', () => {
    expect(angleDiffDeg(170, -170)).toBe(-20);
  });

  it('wraps a difference below -180 up into the positive range', () => {
    expect(angleDiffDeg(-170, 170)).toBe(20);
  });

  it('returns 0 for equal angles', () => {
    expect(angleDiffDeg(0, 0)).toBe(0);
  });
});

describe('nearestPointOnSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('returns the point itself when it lies on the segment', () => {
    expect(nearestPointOnSegment({ x: 5, y: 0 }, a, b)).toEqual({ x: 5, y: 0 });
  });

  it('clamps to the end point when beyond the segment', () => {
    expect(nearestPointOnSegment({ x: 20, y: 0 }, a, b)).toEqual({ x: 10, y: 0 });
  });

  it('clamps to the start point when before the segment', () => {
    expect(nearestPointOnSegment({ x: -5, y: 0 }, a, b)).toEqual({ x: 0, y: 0 });
  });

  it('projects an off-axis point perpendicularly onto the segment', () => {
    expect(nearestPointOnSegment({ x: 5, y: 5 }, a, b)).toEqual({ x: 5, y: 0 });
  });

  it('returns the single point for a degenerate (zero-length) segment', () => {
    const point = { x: 1, y: 1 };
    expect(nearestPointOnSegment({ x: 3, y: 4 }, point, point)).toEqual(point);
  });
});

describe('intersectRaySegment', () => {
  it('finds the intersection of a ray with a perpendicular segment', () => {
    const hit = intersectRaySegment({ x: 0, y: 0 }, 1, 0, { x: 5, y: -5 }, { x: 5, y: 5 });
    expect(hit).not.toBeNull();
    expect(hit?.t).toBe(5);
    expect(hit?.point).toEqual({ x: 5, y: 0 });
  });

  it('returns null for a segment parallel to the ray', () => {
    const hit = intersectRaySegment({ x: 0, y: 0 }, 1, 0, { x: 0, y: 1 }, { x: 10, y: 1 });
    expect(hit).toBeNull();
  });

  it('returns null when the crossing point falls outside the segment bounds', () => {
    const hit = intersectRaySegment({ x: 0, y: 0 }, 1, 0, { x: 5, y: -5 }, { x: 5, y: -1 });
    expect(hit).toBeNull();
  });

  it('does not filter out intersections behind the ray origin (t < 0)', () => {
    const hit = intersectRaySegment({ x: 0, y: 0 }, 1, 0, { x: -5, y: -5 }, { x: -5, y: 5 });
    expect(hit).not.toBeNull();
    expect(hit?.t).toBe(-5);
    expect(hit?.point).toEqual({ x: -5, y: 0 });
  });
});

describe('findSnappedGuideLineDeg', () => {
  it('snaps an angle close to 0 degrees', () => {
    expect(findSnappedGuideLineDeg(2)).toBe(0);
  });

  it('snaps an angle close to 45 degrees', () => {
    expect(findSnappedGuideLineDeg(43)).toBe(45);
  });

  it('snaps exactly at the tolerance boundary (5 degrees)', () => {
    expect(findSnappedGuideLineDeg(5)).toBe(0);
  });

  it('returns null when outside the tolerance', () => {
    expect(findSnappedGuideLineDeg(20)).toBeNull();
  });

  it('snaps a negative angle close to -135 degrees onto the same line as 45', () => {
    expect(findSnappedGuideLineDeg(-133)).toBe(45);
  });

  it('normalizes 180 degrees onto the same line as 0', () => {
    expect(findSnappedGuideLineDeg(180)).toBe(0);
  });
});
