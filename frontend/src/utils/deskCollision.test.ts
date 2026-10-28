import { describe, expect, it } from 'vitest';
import { boundsMayOverlap, boundsOf, polygonsOverlap, rectCorners, shrinkRect, type Point } from './deskCollision';

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

describe('bounds prefilter', () => {
  it('computes the axis-aligned bounds of a rotated rectangle', () => {
    const b = boundsOf(rectCorners({ x: 0, y: 0 }, 10, 4, 90));
    expect(b.minX).toBeCloseTo(-4);
    expect(b.maxX).toBeCloseTo(0);
    expect(b.minY).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(10);
  });

  it('treats touching bounds as possibly overlapping and separated ones as not', () => {
    expect(boundsMayOverlap(boundsOf(square(0, 0, 10)), boundsOf(square(10, 0, 10)))).toBe(true);
    expect(boundsMayOverlap(boundsOf(square(0, 0, 10)), boundsOf(square(10.001, 0, 10)))).toBe(false);
    expect(boundsMayOverlap(boundsOf(square(0, 0, 10)), boundsOf(square(0, -20, 10)))).toBe(false);
  });

  it('an empty polygon never passes the prefilter (polygonsOverlap is false for it too)', () => {
    expect(boundsMayOverlap(boundsOf([]), boundsOf(square(0, 0, 10)))).toBe(false);
    expect(polygonsOverlap([], square(0, 0, 10))).toBe(false);
  });

  it('never rejects a pair that polygonsOverlap reports as overlapping', () => {
    // Детерминированный «случайный» перебор: префильтр не должен менять ответ.
    let seed = 1;
    const rand = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const lShape: Point[] = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ];
    for (let i = 0; i < 2000; i++) {
      const desk = shrinkRect(rectCorners({ x: rand() * 60 - 20, y: rand() * 60 - 20 }, 5 + rand() * 15, 5 + rand() * 15, rand() * 360), 1);
      for (const other of [lShape, rectCorners({ x: rand() * 40, y: rand() * 40 }, 8, 3, rand() * 360)]) {
        const exact = polygonsOverlap(desk, other);
        const filtered = boundsMayOverlap(boundsOf(desk), boundsOf(other)) && polygonsOverlap(desk, other);
        expect(filtered).toBe(exact);
      }
    }
  });
});
