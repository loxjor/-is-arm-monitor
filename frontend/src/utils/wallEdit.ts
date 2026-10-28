import type { WallEndpoint } from './geometry';

/**
 * Геометрия редактирования уже нарисованной стены — чистые функции без
 * Konva и без см/px (единицы те, что переданы). "Левая" грань — сторона
 * +perp, где perp = rotate90(dir) = (-dir.y, dir.x), как в utils/wallPolygon.ts:
 * buildSegmentPolygon кладёт её вершины первыми.
 */

export type WallSide = 'left' | 'right';

export interface FaceDimension {
  side: WallSide;
  from: WallEndpoint;
  to: WallEndpoint;
  length: number;
  /** Единичная нормаль от стены наружу этой грани — туда выносится размерная линия. */
  outward: WallEndpoint;
}

function unitDirection(start: WallEndpoint, end: WallEndpoint): WallEndpoint | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return null;
  }
  return { x: dx / length, y: dy / length };
}

function sideSign(side: WallSide): number {
  return side === 'left' ? 1 : -1;
}

/**
 * Размеры по обеим граням стены (как в RemPlanner — каждая грань меряется
 * отдельно, а не только ось). polygon — результат buildSegmentPolygon:
 * [левая-у-начала, левая-у-конца, правая-у-конца, правая-у-начала]. Длина
 * грани — именно расстояние между её вершинами на стыках, т.е. с учётом
 * митра и выступа свободного торца: это и есть длина стены, которую видно
 * изнутри помещения или снаружи.
 */
export function faceDimensions(
  polygon: readonly WallEndpoint[],
  axisStart: WallEndpoint,
  axisEnd: WallEndpoint,
): FaceDimension[] {
  const dir = unitDirection(axisStart, axisEnd);
  if (!dir || polygon.length !== 4) {
    return [];
  }
  const perp = { x: -dir.y, y: dir.x };
  const [leftStart, leftEnd, rightEnd, rightStart] = polygon;

  const make = (side: WallSide, from: WallEndpoint, to: WallEndpoint): FaceDimension => {
    const sign = sideSign(side);
    return {
      side,
      from,
      to,
      length: Math.hypot(to.x - from.x, to.y - from.y),
      outward: { x: perp.x * sign, y: perp.y * sign },
    };
  };

  return [make('left', leftStart, leftEnd), make('right', rightStart, rightEnd)];
}

/**
 * Новое положение оси, когда толщина меняется только с одной стороны:
 * грань growSide сдвигается на (newThickness − oldThickness), противоположная
 * остаётся на месте — значит ось уезжает в сторону growSide на половину
 * разницы. Так же работают кнопки L±/R± у RemPlanner (WallDepthController).
 */
export function shiftAxisForOneSidedThickness(
  start: WallEndpoint,
  end: WallEndpoint,
  oldThickness: number,
  newThickness: number,
  growSide: WallSide,
): { start: WallEndpoint; end: WallEndpoint } {
  const dir = unitDirection(start, end);
  if (!dir) {
    return { start, end };
  }
  const shift = ((newThickness - oldThickness) / 2) * sideSign(growSide);
  const offset = { x: -dir.y * shift, y: dir.x * shift };
  return {
    start: { x: start.x + offset.x, y: start.y + offset.y },
    end: { x: end.x + offset.x, y: end.y + offset.y },
  };
}

/** Точка на луче fixed → toward на расстоянии length от fixed — новое положение подвижного конца при вводе длины. */
export function pointAtDistance(
  fixed: WallEndpoint,
  toward: WallEndpoint,
  length: number,
): WallEndpoint | null {
  const dir = unitDirection(fixed, toward);
  if (!dir) {
    return null;
  }
  return { x: fixed.x + dir.x * length, y: fixed.y + dir.y * length };
}

/** Грань конкретной стены — вход mergeContinuousFaces; key различает стену и сторону. */
export interface KeyedFace {
  key: string;
  face: FaceDimension;
}

/** Непрерывная грань из одной или нескольких подряд идущих граней; keys — в порядке входа. */
export interface FaceRun {
  keys: string[];
  face: FaceDimension;
}

// Точки стыка соседних граней получаются из одного и того же пересечения
// (см. wedgeVertices), так что совпадают с точностью до float-шума.
const JOINT_EPS = 0.01;
const PARALLEL_EPS = 1e-6;

/**
 * Склеивает грани, которые продолжают друг друга без излома и разрыва: стена,
 * разбитая узлом (T-стык, точка на прямой), снаружи остаётся одной гранью и
 * должна мериться целиком. Грани соседей считаются одной, если у них общая
 * вершина и одна и та же нормаль наружу — тогда они на одной прямой и по
 * одну сторону стены. Со стороны примыкания грань в узле прерывается
 * (вершины разные), там размеры остаются по сегментам; то же при смене
 * толщины — грань идёт ступенькой.
 */
export function mergeContinuousFaces(faces: readonly KeyedFace[]): FaceRun[] {
  const parent = faces.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const near = (a: WallEndpoint, b: WallEndpoint): boolean =>
    Math.abs(a.x - b.x) < JOINT_EPS && Math.abs(a.y - b.y) < JOINT_EPS;

  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i].face;
      const b = faces[j].face;
      const sameOutward = a.outward.x * b.outward.x + a.outward.y * b.outward.y > 1 - PARALLEL_EPS;
      const touching = near(a.from, b.from) || near(a.from, b.to) || near(a.to, b.from) || near(a.to, b.to);
      if (sameOutward && touching) {
        parent[find(j)] = find(i);
      }
    }
  }

  const groups = new Map<number, number[]>();
  faces.forEach((_, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) {
      group.push(index);
    } else {
      groups.set(root, [index]);
    }
  });

  return [...groups.values()].map((members) => {
    const first = faces[members[0]].face;
    if (members.length === 1) {
      return { keys: [faces[members[0]].key], face: first };
    }
    // Крайние точки вдоль первой грани — так сохраняется её порядок from → to.
    const along = { x: first.to.x - first.from.x, y: first.to.y - first.from.y };
    const project = (point: WallEndpoint): number => point.x * along.x + point.y * along.y;
    let from = first.from;
    let to = first.to;
    members.forEach((index) => {
      const { face } = faces[index];
      [face.from, face.to].forEach((point) => {
        if (project(point) < project(from)) from = point;
        if (project(point) > project(to)) to = point;
      });
    });
    return {
      keys: members.map((index) => faces[index].key),
      face: { ...first, from, to, length: Math.hypot(to.x - from.x, to.y - from.y) },
    };
  });
}
