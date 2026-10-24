import type { WallEndpoint } from './geometry';

/** Прямая-ориентир: проходит через origin в направлении dir (единичный вектор). */
export interface AlignLine {
  origin: WallEndpoint;
  dir: WallEndpoint;
}

export interface AlignNode {
  id: string;
  x: number;
  y: number;
}

export interface AlignEdge {
  startNodeId: string;
  endNodeId: string;
}

export interface AlignResult {
  point: WallEndpoint;
  lines: AlignLine[];
}

const PARALLEL_EPS = 1e-6;
// Две ориентировочные линии из одной точки с практически одним направлением —
// дубликат (ось стены совпала с горизонталью/вертикалью).
const DUPLICATE_DOT = 1 - 1e-9;

/**
 * Линии-ориентиры у узлов: у каждого узла горизонталь и вертикаль, а у
 * свободного конца стены (степень 1) ещё и продолжение оси стены с
 * перпендикуляром к ней — по ним новый конец выравнивается относительно
 * уже нарисованного.
 */
export function alignmentLines(
  nodes: readonly AlignNode[],
  edges: readonly AlignEdge[],
): AlignLine[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    for (const [a, b] of [
      [e.startNodeId, e.endNodeId],
      [e.endNodeId, e.startNodeId],
    ]) {
      const list = neighbours.get(a);
      if (list) {
        list.push(b);
      } else {
        neighbours.set(a, [b]);
      }
    }
  }

  const lines: AlignLine[] = [];
  for (const node of nodes) {
    const origin = { x: node.x, y: node.y };
    const dirs: WallEndpoint[] = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    const adjacent = neighbours.get(node.id);
    if (adjacent?.length === 1) {
      const other = byId.get(adjacent[0]);
      const len = other ? Math.hypot(node.x - other.x, node.y - other.y) : 0;
      if (other && len > 0) {
        const along = { x: (node.x - other.x) / len, y: (node.y - other.y) / len };
        const across = { x: -along.y, y: along.x };
        for (const d of [along, across]) {
          if (!dirs.some((e) => Math.abs(e.x * d.x + e.y * d.y) > DUPLICATE_DOT)) {
            dirs.push(d);
          }
        }
      }
    }
    for (const dir of dirs) {
      lines.push({ origin, dir });
    }
  }

  return lines;
}

function distanceToLine(p: WallEndpoint, line: AlignLine): number {
  return Math.abs((p.x - line.origin.x) * line.dir.y - (p.y - line.origin.y) * line.dir.x);
}

const TIE_EPS = 1e-6;

/** Выигрывает ближайшая к точке линия; при равенстве (линии лежат одна на другой) — та, чей узел-источник ближе. */
function isBetter(dist: number, originDist: number, bestDist: number, bestOriginDist: number): boolean {
  return dist < bestDist - TIE_EPS || (Math.abs(dist - bestDist) <= TIE_EPS && originDist < bestOriginDist);
}

function originDistance(p: WallEndpoint, line: AlignLine): number {
  return Math.hypot(p.x - line.origin.x, p.y - line.origin.y);
}

function projectOnLine(p: WallEndpoint, line: AlignLine): WallEndpoint {
  const t = (p.x - line.origin.x) * line.dir.x + (p.y - line.origin.y) * line.dir.y;
  return { x: line.origin.x + line.dir.x * t, y: line.origin.y + line.dir.y * t };
}

function intersect(a: AlignLine, b: AlignLine): WallEndpoint | null {
  const cross = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
  if (Math.abs(cross) < PARALLEL_EPS) {
    return null;
  }
  const t = ((b.origin.x - a.origin.x) * b.dir.y - (b.origin.y - a.origin.y) * b.dir.x) / cross;
  return { x: a.origin.x + a.dir.x * t, y: a.origin.y + a.dir.y * t };
}

/**
 * Притягивает точку к линиям-ориентирам в пределах tolerance (расстояние до
 * прямой). Ближайшая линия проецирует точку на себя; если рядом с результатом
 * есть вторая непараллельная линия — точка садится на их пересечение.
 * constraint — луч, по которому точка обязана остаться (уже сработавшая
 * угловая направляющая): тогда ищется пересечение этого луча с ориентиром,
 * лежащее впереди (t > 0) и не дальше tolerance от курсора.
 */
export function snapToAlignment(
  point: WallEndpoint,
  lines: readonly AlignLine[],
  tolerance: number,
  constraint?: AlignLine,
): AlignResult | null {
  if (constraint) {
    let best: AlignResult | null = null;
    let bestDist = tolerance + TIE_EPS;
    let bestOrigin = Infinity;
    for (const line of lines) {
      const hit = intersect(constraint, line);
      if (!hit) {
        continue;
      }
      const ahead =
        (hit.x - constraint.origin.x) * constraint.dir.x + (hit.y - constraint.origin.y) * constraint.dir.y;
      const dist = Math.hypot(hit.x - point.x, hit.y - point.y);
      const origin = originDistance(hit, line);
      if (ahead > 0 && dist <= tolerance && isBetter(dist, origin, bestDist, bestOrigin)) {
        bestDist = dist;
        bestOrigin = origin;
        best = { point: hit, lines: [line] };
      }
    }
    return best;
  }

  let first: AlignLine | null = null;
  let firstDist = tolerance + TIE_EPS;
  let firstOrigin = Infinity;
  for (const line of lines) {
    const dist = distanceToLine(point, line);
    const origin = originDistance(point, line);
    if (dist <= tolerance && isBetter(dist, origin, firstDist, firstOrigin)) {
      firstDist = dist;
      firstOrigin = origin;
      first = line;
    }
  }
  if (!first) {
    return null;
  }
  const projected = projectOnLine(point, first);
  let second: AlignLine | null = null;
  let secondDist = tolerance + TIE_EPS;
  let secondOrigin = Infinity;
  for (const line of lines) {
    if (line === first || Math.abs(line.dir.x * first.dir.y - line.dir.y * first.dir.x) < PARALLEL_EPS) {
      continue;
    }
    const dist = distanceToLine(projected, line);
    const origin = originDistance(projected, line);
    if (dist <= tolerance && isBetter(dist, origin, secondDist, secondOrigin)) {
      secondDist = dist;
      secondOrigin = origin;
      second = line;
    }
  }
  if (second) {
    const corner = intersect(first, second);
    if (corner) {
      return { point: corner, lines: [first, second] };
    }
  }
  return { point: projected, lines: [first] };
}
