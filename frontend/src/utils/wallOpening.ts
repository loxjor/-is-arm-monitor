import { OPENING_DEFAULTS, type WallOpening } from '../types/opening';
import { cm } from './scale';
import type { WallEndpoint } from './geometry';

/**
 * Геометрия проёмов (двери/окна) в стене — чистые функции без Konva, единицы
 * те, что переданы. offset — центр проёма вдоль оси от start; "левая" сторона —
 * +perp, perp = (-dir.y, dir.x), как в utils/wallEdit.ts.
 */

export interface OccupiedRange {
  offset: number;
  width: number;
}

export interface LeafGeometry {
  hinge: WallEndpoint;
  /** Углы прямоугольника полотна: петля, дальний конец, дальний конец + толщина, петля + толщина */
  leaf: [WallEndpoint, WallEndpoint, WallEndpoint, WallEndpoint];
  arc: { center: WallEndpoint; radius: number; startAngle: number; endAngle: number };
}

export const DOOR_LEAF_THICKNESS = 4;

// Допуск на накопленную погрешность float: касание краями проёмов — не пересечение.
const EPS = 1e-9;

function axisFrame(start: WallEndpoint, end: WallEndpoint) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) {
    return null;
  }
  const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  return { length, dir, perp: { x: -dir.y, y: dir.x } };
}

export function clampOpeningOffset(
  offset: number,
  width: number,
  segmentLength: number,
  others: readonly OccupiedRange[],
): number | null {
  const half = width / 2;
  const lo = half;
  const hi = segmentLength - half;
  if (!(segmentLength > 0) || lo > hi + EPS) {
    return null;
  }

  // Центр нового проёма не может лежать строго внутри (c - w/2 - hw, c + w/2 + hw) соседа.
  const forbidden = others.map((o) => [o.offset - o.width / 2 - half, o.offset + o.width / 2 + half] as const);
  const isValid = (x: number) =>
    x >= lo - EPS && x <= hi + EPS && forbidden.every(([a, b]) => x <= a + EPS || x >= b - EPS);

  const desired = Math.min(Math.max(offset, lo), hi);
  if (isValid(desired)) {
    return desired;
  }

  const candidates = [lo, hi, ...forbidden.flat()].filter((x) => Number.isFinite(x) && isValid(x));
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((best, x) => (Math.abs(x - desired) < Math.abs(best - desired) ? x : best));
}

export function projectPointToSegmentOffset(
  point: WallEndpoint,
  start: WallEndpoint,
  end: WallEndpoint,
): { offset: number; distance: number; side: 'left' | 'right' } {
  const frame = axisFrame(start, end);
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (!frame) {
    return { offset: 0, distance: Math.hypot(dx, dy), side: 'left' };
  }
  const along = dx * frame.dir.x + dy * frame.dir.y;
  const across = dx * frame.perp.x + dy * frame.perp.y;
  return {
    offset: Math.min(Math.max(along, 0), frame.length),
    distance: Math.abs(across),
    side: across >= 0 ? 'left' : 'right',
  };
}

export function openingAxisRange(opening: OccupiedRange): [number, number] {
  return [opening.offset - opening.width / 2, opening.offset + opening.width / 2];
}

/** Порядок вершин как в buildSegmentPolygon: левая-у-начала, левая-у-конца, правая-у-конца, правая-у-начала. */
export function openingCutPolygon(
  start: WallEndpoint,
  end: WallEndpoint,
  thickness: number,
  opening: OccupiedRange,
): WallEndpoint[] {
  const frame = axisFrame(start, end);
  if (!frame) {
    return [];
  }
  const [from, to] = openingAxisRange(opening);
  const half = thickness / 2;
  const at = (along: number, across: number): WallEndpoint => ({
    x: start.x + frame.dir.x * along + frame.perp.x * across,
    y: start.y + frame.dir.y * along + frame.perp.y * across,
  });
  return [at(from, half), at(to, half), at(to, -half), at(from, -half)];
}

/**
 * Условный знак двери на плане: петля сидит на грани стены со стороны
 * открывания, полотно приоткрыто на openAngleDeg (90 — перпендикулярно
 * стене). Дуга — от закрытого положения (вдоль оси к проёму) к открытому;
 * endAngle = startAngle ± openAngleDeg, знак зависит от стороны открывания,
 * поэтому углы не нормализованы в [0, 360). Толщина полотна откладывается в
 * сторону закрытого положения.
 */
export function doorLeafGeometry(
  start: WallEndpoint,
  end: WallEndpoint,
  thickness: number,
  opening: OccupiedRange & Pick<WallOpening, 'hinge' | 'swing'>,
  openAngleDeg = 90,
): LeafGeometry | null {
  const frame = axisFrame(start, end);
  if (!frame) {
    return null;
  }
  const [from, to] = openingAxisRange(opening);
  const hingeAlong = opening.hinge === 'start' ? from : to;
  const side = opening.swing === 'left' ? 1 : -1;
  const normal = { x: frame.perp.x * side, y: frame.perp.y * side };
  const closed = opening.hinge === 'start' ? frame.dir : { x: 0 - frame.dir.x, y: 0 - frame.dir.y }; // 0 - v, а не -v: иначе atan2 даёт -180 вместо 180 для y = -0

  const hinge = {
    x: start.x + frame.dir.x * hingeAlong + normal.x * (thickness / 2),
    y: start.y + frame.dir.y * hingeAlong + normal.y * (thickness / 2),
  };
  const angle = (openAngleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const leafDir = { x: closed.x * cos + normal.x * sin, y: closed.y * cos + normal.y * sin };
  const toClosed = { x: closed.x * sin - normal.x * cos, y: closed.y * sin - normal.y * cos };
  const tip = { x: hinge.x + leafDir.x * opening.width, y: hinge.y + leafDir.y * opening.width };
  const t = DOOR_LEAF_THICKNESS;

  const startAngle = (Math.atan2(closed.y, closed.x) * 180) / Math.PI;
  const normalAngle = (Math.atan2(normal.y, normal.x) * 180) / Math.PI;
  let delta = normalAngle - startAngle;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;

  return {
    hinge,
    leaf: [
      hinge,
      tip,
      { x: tip.x + toClosed.x * t, y: tip.y + toClosed.y * t },
      { x: hinge.x + toClosed.x * t, y: hinge.y + toClosed.y * t },
    ],
    arc: { center: hinge, radius: opening.width, startAngle, endAngle: startAngle + Math.sign(delta) * openAngleDeg },
  };
}

/**
 * Разбиение сегмента узлом (T-примыкание): проём уходит в ту половину, где его
 * центр (центр ровно в точке разбиения — во вторую). Длина второй половины
 * неизвестна вызывающему коду, поэтому для неё проверяется только нижняя
 * граница. Не поместившиеся проёмы удаляются.
 */
export function redistributeOpeningsOnSplit(
  openings: readonly WallOpening[],
  segmentId: string,
  splitOffset: number,
  firstNewId: string,
  secondNewId: string,
  firstLength: number,
): WallOpening[] {
  const result = new Map<number, WallOpening>();
  const halves = [
    { id: firstNewId, length: firstLength, shift: 0, items: [] as number[] },
    { id: secondNewId, length: Infinity, shift: splitOffset, items: [] as number[] },
  ];

  openings.forEach((o, index) => {
    if (o.segmentId !== segmentId) {
      result.set(index, o);
      return;
    }
    halves[o.offset < splitOffset ? 0 : 1].items.push(index);
  });

  for (const half of halves) {
    const placed: OccupiedRange[] = [];
    const ordered = [...half.items].sort((a, b) => openings[a].offset - openings[b].offset);
    for (const index of ordered) {
      const o = openings[index];
      const next = clampOpeningOffset(o.offset - half.shift, o.width, half.length, placed);
      if (next === null) {
        continue;
      }
      placed.push({ offset: next, width: o.width });
      result.set(index, { ...o, segmentId: half.id, offset: cm(next) });
    }
  }

  return openings.flatMap((_, index) => {
    const o = result.get(index);
    return o ? [o] : [];
  });
}

/** Параметры проёма, которые задаёт пользователь (инструмент или выделенный проём). */
export interface OpeningOptions {
  kind: WallOpening['kind'];
  width: number;
  height: number;
  sillHeight: number;
}

// Подоконник выше 2.5 м на плане этажа не встречается — это уже фрамуга, а не окно.
const MAX_SILL_HEIGHT_CM = 250;

/**
 * Применяет правку к параметрам проёма и приводит их в допустимые для вида
 * пределы (OPENING_DEFAULTS): смена вида подставляет его стандартную ширину,
 * только если текущая в новые пределы не влезает; у дверей и проёмов
 * подоконника нет. Всё в целых сантиметрах.
 */
export function normalizeOpeningOptions(current: OpeningOptions, patch: Partial<OpeningOptions>): OpeningOptions {
  const kind = patch.kind ?? current.kind;
  const limits = OPENING_DEFAULTS[kind];
  const clamp = (value: number, min: number, max: number, fallback: number): number =>
    Number.isFinite(value) ? Math.round(Math.min(Math.max(value, min), max)) : fallback;
  const kindChanged = kind !== current.kind;
  const width = patch.width ?? current.width;
  const fitsWidth = width >= limits.minWidth && width <= limits.maxWidth;
  const isWindow = kind === 'window' || kind === 'windowway';
  return {
    kind,
    width: kindChanged && !fitsWidth ? limits.width : clamp(width, limits.minWidth, limits.maxWidth, limits.width),
    height: clamp(patch.height ?? (kindChanged ? limits.height : current.height), limits.minHeight, limits.maxHeight, limits.height),
    sillHeight: isWindow
      ? clamp(patch.sillHeight ?? (kindChanged ? limits.sillHeight : current.sillHeight), 0, MAX_SILL_HEIGHT_CM, limits.sillHeight)
      : 0,
  };
}
