import type { WallEndpoint } from './geometry';
import type { FaceLine } from './wallPolygon';

/** Стена для поиска примыкания: концы и толщина в пикселях холста. */
export interface AbutmentWallInput {
  startNodeId: string;
  endNodeId: string;
  startPx: WallEndpoint;
  endPx: WallEndpoint;
  thicknessPx: number;
}

/**
 * Стена с заранее посчитанными направлением, длиной и габаритом. Готовится
 * один раз на проход (rebuildWallGeometry, continuableFreeEnds), а не заново
 * для каждого свободного узла.
 */
export interface PreparedAbutmentWall {
  startNodeId: string;
  endNodeId: string;
  startPx: WallEndpoint;
  dir: WallEndpoint;
  lengthPx: number;
  half: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Запас габарита сверх полутолщины и допуска: предфильтр обязан быть строго
 * консервативным (никогда не отсекать стену, которую приняла бы точная
 * проверка), а округления при нормировке направления дают ошибки на порядки
 * меньше пикселя.
 */
const AABB_SLACK_PX = 1;

export function prepareAbutmentWalls(walls: Iterable<AbutmentWallInput>, epsilonPx: number): PreparedAbutmentWall[] {
  const prepared: PreparedAbutmentWall[] = [];
  for (const wall of walls) {
    const { startPx, endPx, thicknessPx } = wall;
    const lengthPx = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);
    if (lengthPx === 0) {
      continue;
    }
    const half = thicknessPx / 2;
    const pad = Math.abs(half) + epsilonPx + AABB_SLACK_PX;
    prepared.push({
      startNodeId: wall.startNodeId,
      endNodeId: wall.endNodeId,
      startPx,
      dir: { x: (endPx.x - startPx.x) / lengthPx, y: (endPx.y - startPx.y) / lengthPx },
      lengthPx,
      half,
      minX: Math.min(startPx.x, endPx.x) - pad,
      maxX: Math.max(startPx.x, endPx.x) + pad,
      minY: Math.min(startPx.y, endPx.y) - pad,
      maxY: Math.max(startPx.y, endPx.y) + pad,
    });
  }
  return prepared;
}

/**
 * Грань чужой стены, на которой лежит свободный узел (конец, привязанный к
 * грани при рисовании), — по её линии обрезается торец. Первая подходящая в
 * порядке walls. Дешёвый габаритный предфильтр отсекает далёкие стены до
 * точной проверки; результат тот же, что без него.
 */
export function findAbutmentFace(
  nodeId: string,
  nodePx: WallEndpoint,
  walls: readonly PreparedAbutmentWall[],
  epsilonPx: number,
): FaceLine | undefined {
  for (const wall of walls) {
    if (nodePx.x < wall.minX || nodePx.x > wall.maxX || nodePx.y < wall.minY || nodePx.y > wall.maxY) {
      continue;
    }
    if (wall.startNodeId === nodeId || wall.endNodeId === nodeId) {
      continue;
    }
    const { startPx, dir, lengthPx, half } = wall;
    const relX = nodePx.x - startPx.x;
    const relY = nodePx.y - startPx.y;
    const t = relX * dir.x + relY * dir.y;
    const d = -relX * dir.y + relY * dir.x;
    if (t < 0 || t > lengthPx || Math.abs(Math.abs(d) - half) > epsilonPx) {
      continue;
    }
    const sign = Math.sign(d);
    return {
      point: { x: startPx.x - dir.y * half * sign, y: startPx.y + dir.x * half * sign },
      dir,
    };
  }
  return undefined;
}
