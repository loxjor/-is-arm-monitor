import type { WallEndpoint } from './geometry';

export interface RoomNode {
  id: string;
  x: number;
  y: number;
}

export interface RoomEdge {
  startNodeId: string;
  endNodeId: string;
  thickness: number;
}

export interface Room {
  /** Узлы контура по оси стен. */
  nodeIds: string[];
  /** Внутренний контур помещения — по внутренним граням стен. */
  polygon: WallEndpoint[];
  /** Площадь внутреннего контура, в единицах координат в квадрате. */
  area: number;
}

const COLLINEAR_EPS = 1e-9;

function shoelace(points: readonly WallEndpoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/**
 * Внутренний контур: каждое ребро смещается внутрь на половину своей толщины,
 * вершина — пересечение смещённых прямых соседних рёбер. Контур задан по
 * часовой стрелке на экране (y вниз), поэтому внутрь — вправо по ходу,
 * то есть (−dy, dx).
 */
function insetPolygon(points: readonly WallEndpoint[], halfThickness: readonly number[]): WallEndpoint[] {
  const n = points.length;
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const dir = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const h = halfThickness[i];
    return { origin: { x: p.x - dir.y * h, y: p.y + dir.x * h }, dir };
  });
  return points.map((_, i) => {
    const prev = lines[(i + n - 1) % n];
    const next = lines[i];
    const cross = prev.dir.x * next.dir.y - prev.dir.y * next.dir.x;
    if (Math.abs(cross) < COLLINEAR_EPS) {
      return { x: next.origin.x, y: next.origin.y };
    }
    const t =
      ((next.origin.x - prev.origin.x) * next.dir.y - (next.origin.y - prev.origin.y) * next.dir.x) / cross;
    return { x: prev.origin.x + prev.dir.x * t, y: prev.origin.y + prev.dir.y * t };
  });
}

interface HalfEdge {
  to: string;
  edge: number;
  angle: number;
}

interface Step {
  from: string;
  edge: number;
}

/**
 * Замкнутые помещения плоского графа стен — его внутренние грани. Обход
 * полурёбер: из u→v идём в то исходящее из v ребро, что стоит сразу перед
 * обратным v→u по углу; так каждая грань обходится целиком. Внешняя грань
 * компоненты в помещения не попадает, а висячие стены ("усы") срезаются из
 * контура, чтобы не ломать его.
 */
export function findRooms(nodes: readonly RoomNode[], edges: readonly RoomEdge[]): Room[] {
  const planar = planarize(nodes, edges);
  return findFaces(planar.nodes, planar.edges);
}

// Допуск касания узла с гранью чужой стены, в единицах координат (px).
const TOUCH_TOLERANCE = 1;

/**
 * Стена, упёртая концом в грань другой стены, в графе не делит с ней узел —
 * для поиска помещений такой стык надо достроить: чужое ребро разбивается в
 * точке проекции узла, а узел соединяется с ней коротким ребром той же
 * толщины, что и упёршаяся стена (оно целиком лежит внутри толщины хозяина).
 */
function planarize(
  nodes: readonly RoomNode[],
  edges: readonly RoomEdge[],
): { nodes: RoomNode[]; edges: RoomEdge[] } {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const outNodes: RoomNode[] = [...nodes];
  const splits = edges.map(() => [] as { t: number; id: string }[]);
  const connectors: RoomEdge[] = [];
  const linked = new Set<string>();
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  edges.forEach((e) => linked.add(pairKey(e.startNodeId, e.endNodeId)));

  const thicknessAt = new Map<string, number>();
  edges.forEach((e) => {
    for (const id of [e.startNodeId, e.endNodeId]) {
      thicknessAt.set(id, Math.max(thicknessAt.get(id) ?? 0, e.thickness));
    }
  });

  let virtual = 0;
  for (const node of nodes) {
    edges.forEach((e, index) => {
      const a = pos.get(e.startNodeId);
      const b = pos.get(e.endNodeId);
      if (!a || !b || e.startNodeId === node.id || e.endNodeId === node.id) {
        return;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) {
        return;
      }
      const t = Math.min(1, Math.max(0, ((node.x - a.x) * dx + (node.y - a.y) * dy) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      if (Math.hypot(node.x - px, node.y - py) > e.thickness / 2 + TOUCH_TOLERANCE) {
        return;
      }
      const len = Math.sqrt(len2);
      let targetId: string;
      if (t * len <= TOUCH_TOLERANCE) {
        targetId = e.startNodeId;
      } else if ((1 - t) * len <= TOUCH_TOLERANCE) {
        targetId = e.endNodeId;
      } else {
        targetId = `~p${virtual++}`;
        outNodes.push({ id: targetId, x: px, y: py });
        splits[index].push({ t, id: targetId });
      }
      const key = pairKey(node.id, targetId);
      if (!linked.has(key)) {
        linked.add(key);
        connectors.push({ startNodeId: node.id, endNodeId: targetId, thickness: thicknessAt.get(node.id) ?? e.thickness });
      }
    });
  }

  const outEdges: RoomEdge[] = [...connectors];
  edges.forEach((e, index) => {
    const points = splits[index].sort((p, q) => p.t - q.t);
    let prev = e.startNodeId;
    for (const point of points) {
      outEdges.push({ startNodeId: prev, endNodeId: point.id, thickness: e.thickness });
      prev = point.id;
    }
    outEdges.push({ startNodeId: prev, endNodeId: e.endNodeId, thickness: e.thickness });
  });
  return { nodes: outNodes, edges: outEdges };
}

function findFaces(nodes: readonly RoomNode[], edges: readonly RoomEdge[]): Room[] {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, HalfEdge[]>();
  const add = (from: string, item: HalfEdge): void => {
    const list = out.get(from);
    if (list) {
      list.push(item);
    } else {
      out.set(from, [item]);
    }
  };
  edges.forEach((e, edge) => {
    const a = pos.get(e.startNodeId);
    const b = pos.get(e.endNodeId);
    if (!a || !b || e.startNodeId === e.endNodeId) {
      return;
    }
    add(e.startNodeId, { to: e.endNodeId, edge, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    add(e.endNodeId, { to: e.startNodeId, edge, angle: Math.atan2(a.y - b.y, a.x - b.x) });
  });
  out.forEach((list) => list.sort((p, q) => p.angle - q.angle));

  const visited = new Set<string>();
  const key = (from: string, to: string, edge: number): string => `${from}>${to}#${edge}`;
  const rooms: Room[] = [];

  out.forEach((list, startId) => {
    for (const first of list) {
      if (visited.has(key(startId, first.to, first.edge))) {
        continue;
      }
      const walk: Step[] = [];
      let from = startId;
      let step = first;
      for (let guard = 0; guard <= edges.length * 2 + 2; guard++) {
        const k = key(from, step.to, step.edge);
        if (visited.has(k)) {
          break;
        }
        visited.add(k);
        walk.push({ from, edge: step.edge });
        const around = out.get(step.to)!;
        const back = around.findIndex((o) => o.to === from && o.edge === step.edge);
        const next = around[(back + around.length - 1) % around.length];
        from = step.to;
        step = next;
      }
      const room = faceToRoom(walk, pos, edges);
      if (room) {
        rooms.push(room);
      }
    }
  });
  return rooms;
}

function stripSpurs(walk: readonly Step[]): Step[] {
  const steps = [...walk];
  let i = 0;
  while (i < steps.length && steps.length > 2) {
    const j = (i + 1) % steps.length;
    if (steps[i].edge === steps[j].edge) {
      const hi = Math.max(i, j);
      const lo = Math.min(i, j);
      steps.splice(hi, 1);
      steps.splice(lo, 1);
      i = Math.max(0, lo - 1);
    } else {
      i++;
    }
  }
  return steps;
}

function faceToRoom(
  walk: readonly Step[],
  pos: ReadonlyMap<string, RoomNode>,
  edges: readonly RoomEdge[],
): Room | null {
  const steps = stripSpurs(walk);
  if (steps.length < 3) {
    return null;
  }
  const points = steps.map((s) => ({ x: pos.get(s.from)!.x, y: pos.get(s.from)!.y }));
  // При таком обходе внутренние грани идут по часовой стрелке на экране
  // (положительная площадь при y вниз), внешние — против.
  if (shoelace(points) <= 0) {
    return null;
  }
  const polygon = insetPolygon(
    points,
    steps.map((s) => edges[s.edge].thickness / 2),
  );
  return { nodeIds: steps.map((s) => s.from), polygon, area: Math.abs(shoelace(polygon)) };
}

/** Центр масс многоугольника (для подписи площади); у вырожденного — среднее вершин. */
export function polygonCentroid(points: readonly WallEndpoint[]): WallEndpoint {
  const area = shoelace(points);
  if (Math.abs(area) < COLLINEAR_EPS) {
    const n = points.length || 1;
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / n,
      y: points.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function pointInPolygonLocal(p: WallEndpoint, polygon: readonly WallEndpoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function squaredSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  const ex = px - qx;
  const ey = py - qy;
  return ex * ex + ey * ey;
}

function distanceToPolygon(p: WallEndpoint, polygon: readonly WallEndpoint[]): number {
  let minSq = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    minSq = Math.min(minSq, squaredSegmentDistance(p.x, p.y, a.x, a.y, b.x, b.y));
  }
  return Math.sqrt(minSq);
}

interface LabelCell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

/**
 * Точка внутри многоугольника, максимально удалённая от рёбер (polylabel,
 * Mapbox) — для подписи помещения. Центр масс невыпуклого помещения может
 * лежать снаружи, а эта точка — внутри и ближе к визуальному центру.
 */
export function polygonLabelPoint(polygon: readonly WallEndpoint[], precision = 1): WallEndpoint {
  const n = polygon.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { ...polygon[0] };
  if (n === 2) {
    return { x: (polygon[0].x + polygon[1].x) / 2, y: (polygon[0].y + polygon[1].y) / 2 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const cellSize = Math.min(maxX - minX, maxY - minY);
  if (cellSize <= 0) return { x: minX, y: minY };

  const pointCell = (x: number, y: number): LabelCell => {
    const d = pointInPolygonLocal({ x, y }, polygon) ? distanceToPolygon({ x, y }, polygon) : 0;
    return { x, y, h: 0, d, max: d };
  };
  const makeCell = (x: number, y: number, h: number): LabelCell => {
    const d = pointInPolygonLocal({ x, y }, polygon) ? distanceToPolygon({ x, y }, polygon) : 0;
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };

  let best = pointCell((minX + maxX) / 2, (minY + maxY) / 2);
  const centroid = polygonCentroid(polygon);
  const centroidCell = pointCell(centroid.x, centroid.y);
  if (centroidCell.d > best.d) best = centroidCell;

  let h = cellSize / 2;
  const cells: LabelCell[] = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      cells.push(makeCell(x + h, y + h, h));
    }
  }

  while (cells.length > 0) {
    cells.sort((a, b) => b.max - a.max);
    const cell = cells.pop()!;
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    h = cell.h / 2;
    cells.push(
      makeCell(cell.x - h, cell.y - h, h),
      makeCell(cell.x + h, cell.y - h, h),
      makeCell(cell.x - h, cell.y + h, h),
      makeCell(cell.x + h, cell.y + h, h),
    );
  }

  return { x: best.x, y: best.y };
}
