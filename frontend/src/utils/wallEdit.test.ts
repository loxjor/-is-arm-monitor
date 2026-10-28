import { describe, expect, it } from 'vitest';
import { buildSegmentPolygon, computeNodeFaceVertices } from './wallPolygon';
import {
  faceDimensions,
  mergeContinuousFaces,
  pointAtDistance,
  shiftAxisForOneSidedThickness,
  type KeyedFace,
} from './wallEdit';

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

describe('mergeContinuousFaces', () => {
  // Стена (0,0)→(200,0) разбита узлом (100,0); halfB — половина толщины правой части.
  // tee — есть ли в узле примыкание вниз (+y, "правая" сторона) толщиной 10.
  function splitWall(halfB: number, tee: boolean): KeyedFace[] {
    const node = { x: 100, y: 0 };
    const rays = [
      { key: 'a:end', dir: { x: -1, y: 0 }, halfThickness: 5 },
      { key: 'b:start', dir: { x: 1, y: 0 }, halfThickness: halfB },
    ];
    if (tee) {
      rays.push({ key: 't:start', dir: { x: 0, y: 1 }, halfThickness: 5 });
    }
    const atNode = computeNodeFaceVertices(node, rays);
    const free = (point: { x: number; y: number }, dir: { x: number; y: number }, half: number) =>
      computeNodeFaceVertices(point, [{ key: 'k', dir, halfThickness: half }]).get('k')!;
    const a = buildSegmentPolygon(free({ x: 0, y: 0 }, { x: 1, y: 0 }, 5), atNode.get('a:end')!);
    const b = buildSegmentPolygon(atNode.get('b:start')!, free({ x: 200, y: 0 }, { x: -1, y: 0 }, halfB));
    return [
      ...faceDimensions(a, { x: 0, y: 0 }, node).map((face) => ({ key: `a:${face.side}`, face })),
      ...faceDimensions(b, node, { x: 200, y: 0 }).map((face) => ({ key: `b:${face.side}`, face })),
    ];
  }

  it('T-стык — наружная грань целиком, со стороны примыкания по сегментам', () => {
    const runs = mergeContinuousFaces(splitWall(5, true));

    const outer = runs.find((run) => run.keys.includes('a:right'));
    expect(outer?.keys).toEqual(['a:right', 'b:right']);
    expect(outer?.face.length).toBeCloseTo(200);
    expect(runs.find((run) => run.keys.includes('a:left'))?.keys).toEqual(['a:left']);
    expect(runs.find((run) => run.keys.includes('b:left'))?.face.length).toBeCloseTo(95);
  });

  it('узел на прямой без примыканий — обе грани целиком', () => {
    const runs = mergeContinuousFaces(splitWall(5, false));

    expect(runs).toHaveLength(2);
    runs.forEach((run) => expect(run.face.length).toBeCloseTo(200));
  });

  it('смена толщины — грань идёт ступенькой и не склеивается', () => {
    expect(mergeContinuousFaces(splitWall(10, false))).toHaveLength(4);
  });
});
