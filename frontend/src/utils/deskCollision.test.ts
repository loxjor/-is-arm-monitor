import { describe, expect, it } from 'vitest';
import { polygonsOverlap, rectCorners, shrinkRect } from './deskCollision';

const square = (x: number, y: number, size: number) => rectCorners({ x, y }, size, size, 0);

describe('polygonsOverlap', () => {
  it('detects crossing, containment and separation', () => {
    expect(polygonsOverlap(square(0, 0, 10), square(5, 5, 10))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 10), square(2, 2, 3))).toBe(true);
    expect(polygonsOverlap(square(0, 0, 10), square(20, 0, 10))).toBe(false);
  });

  it('works with a non-convex wall polygon', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ];
    expect(polygonsOverlap(lShape, square(15, 15, 10))).toBe(false); // во «внутреннем углу» буквы L
    expect(polygonsOverlap(lShape, square(5, 20, 4))).toBe(true);
  });

  it('touching edge to edge is not a collision after shrinking', () => {
    const wall = square(0, 0, 10);
    const desk = shrinkRect(square(10, 0, 10), 0.5);
    expect(polygonsOverlap(wall, desk)).toBe(false);
  });
});

describe('rectCorners', () => {
  it('rotates around the top-left corner', () => {
    const [a, b, c] = rectCorners({ x: 0, y: 0 }, 10, 4, 90);
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b!.x).toBeCloseTo(0);
    expect(b!.y).toBeCloseTo(10);
    expect(c!.x).toBeCloseTo(-4);
  });
});
