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

describe('findSnappedGuideLineDeg (Этап 5.5 — допуск по расстоянию, не по углу)', () => {
  const TOLERANCE = 5;

  it('snaps when the perpendicular distance to the 0° line is within tolerance', () => {
    expect(findSnappedGuideLineDeg(100, 2, TOLERANCE)).toBe(0);
  });

  it('snaps exactly at the tolerance boundary', () => {
    expect(findSnappedGuideLineDeg(100, 5, TOLERANCE)).toBe(0);
  });

  it('does not snap just outside the tolerance', () => {
    expect(findSnappedGuideLineDeg(100, 5.01, TOLERANCE)).toBeNull();
  });

  it('snaps to the 45° line when close to it', () => {
    const rad45 = Math.PI / 4;
    const perp = { x: -Math.sin(rad45), y: Math.cos(rad45) };
    const dx = 100 + perp.x * 3;
    const dy = 100 + perp.y * 3;
    expect(findSnappedGuideLineDeg(dx, dy, TOLERANCE)).toBe(45);
  });

  it('returns null when far from every guide line', () => {
    expect(findSnappedGuideLineDeg(100, 30, TOLERANCE)).toBeNull();
  });

  it('picks the closest line among several within tolerance', () => {
    // (1,1) лежит точно на линии 45° (расстояние 0) и всего в 1 от линии 0°.
    expect(findSnappedGuideLineDeg(1, 1, TOLERANCE)).toBe(45);
  });

  it('не зависит от направления вектора — работает и для (-dx,-dy) (та же прямая)', () => {
    expect(findSnappedGuideLineDeg(-100, -2, TOLERANCE)).toBe(0);
  });

  it('порог не растёт вместе с длиной стены — эталон из TASKS.md: 100/4см примагничивается, 550/7см нет', () => {
    // Стена 100 см с отклонением 4 см (2.29°) — примагничивается.
    expect(findSnappedGuideLineDeg(Math.sqrt(100 ** 2 - 4 ** 2), 4, TOLERANCE)).toBe(0);
    // Стена 550 см с отклонением 7 см (0.73°, вчетверо меньше!) — нет:
    // порог задан расстоянием (7 > 5), а не углом.
    expect(findSnappedGuideLineDeg(Math.sqrt(550 ** 2 - 7 ** 2), 7, TOLERANCE)).toBeNull();
  });
});
