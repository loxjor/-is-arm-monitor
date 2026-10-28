import type { WallEndpoint } from './geometry';

/**
 * Перетаскивание построенной стены (как в RemPlanner): стена едет только
 * параллельно себе — вдоль нормали, — а её узлы тянут за собой соседние
 * стены. Здесь — чистая геометрия без Konva, единицы те, что переданы.
 */

export interface MoveNode {
  id: string;
  x: number;
  y: number;
}

export interface MoveWall {
  id: string;
  startNodeId: string;
  endNodeId: string;
  thickness: number;
}

export interface ShiftRange {
  /** Узлы, которые едут: стена целиком — с соосными участками, на которые её разбили T-стыки. */
  nodeIds: string[];
  /** Единичная нормаль стены — "левая" сторона, +perp, как в utils/wallEdit.ts. */
  normal: WallEndpoint;
  /** Допустимый сдвиг вдоль normal: от min (≤ 0) до max (≥ 0). */
  min: number;
  max: number;
}

// Соседняя стена "идёт поперёк" сдвигаемой (и укорачивается при сдвиге), если
// угол между ней и нормалью меньше 60°; почти параллельные соседи при сдвиге
// просто поворачиваются, их длина почти не меняется.
const ACROSS_COS = 0.5;
// Параллельными считаем стены с углом меньше ~3°.
const PARALLEL_SIN = 0.05;
// Свободный конец "упирается" в грань чужой стены, если лежит на ней с этим допуском.
const FACE_EPS = 0.5;

const dot = (a: WallEndpoint, b: WallEndpoint): number => a.x * b.x + a.y * b.y;
const sub = (a: WallEndpoint, b: WallEndpoint): WallEndpoint => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: WallEndpoint): WallEndpoint | null => {
  const length = Math.hypot(v.x, v.y);
  return length === 0 ? null : { x: v.x / length, y: v.y / length };
};

/**
 * Пределы сдвига стены wallId вдоль её нормали. Стена берётся целиком —
 * вместе с соосными участками той же прямой (узел T-стыка делит стену на
 * два ребра, а для пользователя это одна стена; сдвинь он один участок —
 * второй перекосился бы). Ограничения:
 *  - сосед по узлу, идущий поперёк, не короче minLength — стена не
 *    проскакивает дальний конец соседа (у T-стыка это края основной стены:
 *    узел не съезжает с её грани);
 *  - свободный конец, упёртый в грань чужой стены, не выходит за её края;
 *  - параллельная стена напротив (перекрывающаяся по длине) не даёт пройти
 *    сквозь себя: грани остаются хотя бы вплотную.
 * Если стена уже нарушает какой-то предел, он ослабляется до нуля — стоять
 * на месте можно всегда.
 */
export function wallShiftRange(
  nodes: ReadonlyMap<string, MoveNode>,
  walls: readonly MoveWall[],
  wallId: string,
  minLength: number,
): ShiftRange | null {
  const wall = walls.find((w) => w.id === wallId);
  const start = wall && nodes.get(wall.startNodeId);
  const end = wall && nodes.get(wall.endNodeId);
  const dir = start && end && unit(sub(end, start));
  if (!wall || !start || !end || !dir) return null;
  const normal = { x: -dir.y, y: dir.x };

  const chain = collinearChain(nodes, walls, wall, start, normal);
  const chainNodeIds = new Set(chain.flatMap((w) => [w.startNodeId, w.endNodeId]));
  const chainNodes = [...chainNodeIds].map((id) => nodes.get(id)).filter((n): n is MoveNode => !!n);
  const along = (n: MoveNode): number => dot(sub(n, start), dir);
  const a = chainNodes.reduce((best, n) => (along(n) < along(best) ? n : best));
  const b = chainNodes.reduce((best, n) => (along(n) > along(best) ? n : best));
  const length = along(b) - along(a);
  const inChain = new Set(chain.map((w) => w.id));
  let min = -Infinity;
  let max = Infinity;
  const limit = (offset: number, sign: number): void => {
    // offset — где предел относительно текущего положения; sign — с какой стороны.
    if (sign > 0) max = Math.min(max, offset);
    else min = Math.max(min, offset);
  };

  for (const node of chainNodes) {
    const neighbors = walls.filter(
      (w) => !inChain.has(w.id) && (w.startNodeId === node.id || w.endNodeId === node.id),
    );
    for (const neighbor of neighbors) {
      const far = nodes.get(neighbor.startNodeId === node.id ? neighbor.endNodeId : neighbor.startNodeId);
      const toFar = far && unit(sub(far, node));
      if (!far || !toFar || Math.abs(dot(toFar, normal)) <= ACROSS_COS) continue;
      const s = dot(sub(far, node), normal);
      limit(s > 0 ? s - minLength : s + minLength, Math.sign(s));
    }

    if (neighbors.length === 0 && (node === a || node === b)) {
      const host = abutmentHost(nodes, walls, inChain, node);
      if (host) {
        const s1 = dot(sub(host.start, node), normal);
        const s2 = dot(sub(host.end, node), normal);
        limit(Math.max(s1, s2), 1);
        limit(Math.min(s1, s2), -1);
      }
    }
  }

  const half = Math.max(...chain.map((w) => w.thickness)) / 2;
  for (const other of walls) {
    if (inChain.has(other.id)) continue;
    const p = nodes.get(other.startNodeId);
    const q = nodes.get(other.endNodeId);
    const otherDir = p && q && unit(sub(q, p));
    if (!p || !q || !otherDir || Math.abs(dot(otherDir, normal)) > PARALLEL_SIN) continue;
    const span = [dot(sub(p, a), dir), dot(sub(q, a), dir)];
    if (Math.max(...span) <= 0 || Math.min(...span) >= length) continue;
    const distance = dot(sub(p, a), normal);
    const gap = half + other.thickness / 2;
    // Стена на той же оси (продолжение) — не препятствие.
    if (Math.abs(distance) < gap) continue;
    limit(distance > 0 ? distance - gap : distance + gap, Math.sign(distance));
  }

  return { nodeIds: [...chainNodeIds], normal, min: Math.min(min, 0), max: Math.max(max, 0) };
}

/** Стена и все рёбра, продолжающие её по той же прямой через общие узлы. */
function collinearChain(
  nodes: ReadonlyMap<string, MoveNode>,
  walls: readonly MoveWall[],
  wall: MoveWall,
  origin: WallEndpoint,
  normal: WallEndpoint,
): MoveWall[] {
  const onLine = (id: string): boolean => {
    const node = nodes.get(id);
    return !!node && Math.abs(dot(sub(node, origin), normal)) <= FACE_EPS;
  };
  const chain = [wall];
  const seen = new Set([wall.id]);
  for (let i = 0; i < chain.length; i++) {
    const current = chain[i];
    for (const other of walls) {
      if (seen.has(other.id)) continue;
      const shares = [current.startNodeId, current.endNodeId].some(
        (id) => id === other.startNodeId || id === other.endNodeId,
      );
      if (shares && onLine(other.startNodeId) && onLine(other.endNodeId)) {
        seen.add(other.id);
        chain.push(other);
      }
    }
  }
  return chain;
}

/** Чужая стена, на грани которой лежит свободный узел (см. FloorPlanCanvas.findAbutmentFacePx). */
function abutmentHost(
  nodes: ReadonlyMap<string, MoveNode>,
  walls: readonly MoveWall[],
  exclude: ReadonlySet<string>,
  node: MoveNode,
): { start: WallEndpoint; end: WallEndpoint } | null {
  for (const other of walls) {
    if (exclude.has(other.id)) continue;
    const start = nodes.get(other.startNodeId);
    const end = nodes.get(other.endNodeId);
    const dir = start && end && unit(sub(end, start));
    if (!start || !end || !dir) continue;
    const rel = sub(node, start);
    const along = dot(rel, dir);
    const across = rel.x * -dir.y + rel.y * dir.x;
    const length = dot(sub(end, start), dir);
    if (along >= 0 && along <= length && Math.abs(Math.abs(across) - other.thickness / 2) <= FACE_EPS) {
      return { start, end };
    }
  }
  return null;
}
