import { describe, expect, it } from 'vitest';
import { buildSegmentPolygon, computeNodeFaceVertices } from './wallPolygon';
import { faceDimensions, pointAtDistance, shiftAxisForOneSidedThickness } from './wallEdit';

describe('faceDimensions', () => {
  it('свободная стена 100 толщиной 10 — обе грани ровно по 100 (торцы не выступают)', () => {
    const start = { x: 0, y: 0 };
    const end = { x: 100, y: 0 };
    const startFace = computeNodeFaceVertices(start, [{ key: 's', dir: { x: 1, y: 0 }, halfThickness: 5 }]).get('s')!;
    const endFace = computeNodeFaceVertices(end, [{ key: 'e', dir: { x: -1, y: 0 }, halfThickness: 5 }]).get('e')!;
    const polygon = buildSegmentPolygon(startFace, endFace);

    const [left, right] = faceDimensions(polygon, start, end);

    expect(left.side).toBe('left');
    expect(left.length).toBeCloseTo(100);
    expect(left.outward.y).toBe(1);
    expect(left.from.y).toBeCloseTo(5);
    expect(right.side).toBe('right');
    expect(right.length).toBeCloseTo(100);
    expect(right.outward.y).toBe(-1);
    expect(right.from.y).toBeCloseTo(-5);
  });

  it('прямой угол — внутренняя грань короче наружной на толщину', () => {
    // Стена (0,0)→(100,0) толщиной 10, в узле (100,0) к ней примыкает стена вниз (+y).
    const node = { x: 100, y: 0 };
    const atCorner = computeNodeFaceVertices(node, [
      { key: 'a:end', dir: { x: -1, y: 0 }, halfThickness: 5 },
      { key: 'b:start', dir: { x: 0, y: 1 }, halfThickness: 5 },
    ]);
    const atFree = computeNodeFaceVertices({ x: 0, y: 0 }, [
      { key: 'a:start', dir: { x: 1, y: 0 }, halfThickness: 5 },
    ]);
    const polygon = buildSegmentPolygon(atFree.get('a:start')!, atCorner.get('a:end')!);

    const [left, right] = faceDimensions(polygon, { x: 0, y: 0 }, node);

    // Левая грань (y=+5) смотрит внутрь угла: 0…95 = 95; правая (y=−5) — наружу: 0…105 = 105.
    expect(left.length).toBeCloseTo(95);
    expect(right.length).toBeCloseTo(105);
  });

  it('вырожденная стена нулевой длины — размеров нет', () => {
    const p = { x: 3, y: 3 };
    expect(faceDimensions([p, p, p, p], p, p)).toEqual([]);
  });
});

describe('shiftAxisForOneSidedThickness', () => {
  it('рост левой грани на 4 — ось уходит влево на 2, правая грань остаётся на месте', () => {
    const { start, end } = shiftAxisForOneSidedThickness({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 14, 'left');
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(2);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(2);
    // Правая грань была y = −5, стала y = 2 − 7 = −5.
    expect(start.y - 14 / 2).toBeCloseTo(-5);
  });

  it('уменьшение правой грани — ось уходит влево, левая грань остаётся на месте', () => {
    const { start } = shiftAxisForOneSidedThickness({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 6, 'right');
    expect(start.y).toBeCloseTo(2);
    // Левая грань была y = +5, стала y = 2 + 3 = 5.
    expect(start.y + 6 / 2).toBeCloseTo(5);
  });
});

describe('pointAtDistance', () => {
  it('ставит подвижный конец на заданное расстояние вдоль стены', () => {
    const point = pointAtDistance({ x: 0, y: 0 }, { x: 30, y: 40 }, 100)!;
    expect(point.x).toBeCloseTo(60);
    expect(point.y).toBeCloseTo(80);
  });

  it('совпадающие точки — направления нет, null', () => {
    expect(pointAtDistance({ x: 1, y: 1 }, { x: 1, y: 1 }, 10)).toBeNull();
  });
});
