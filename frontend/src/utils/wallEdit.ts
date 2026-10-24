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
