import type { WallData, WallNode, WallSegment } from '../types/wall';
import type { SceneData, SceneDataV1 } from '../types/scene';
import { cm } from './scale';
import { generateId } from './id';

/**
 * Точки считаются одним узлом графа, если расстояние между ними не больше
 * этого допуска, в САНТИМЕТРАХ. Используется только при миграции старых
 * (version 1) планов — в текущей модели узлы не совпадают по координатам
 * случайно, а делят один и тот же id с самого создания (см. FloorPlanCanvas).
 */
export const JOINT_TOLERANCE_CM = 1;

type Endpoint = { wallIndex: number; end: 'start' | 'end'; x: number; y: number };

/**
 * Конвертирует список независимых отрезков (version 1: каждая стена — свои
 * x/y/length/rotation) в граф узлов и рёбер (version 2): концы стен, ближе
 * JOINT_TOLERANCE_CM друг к другу, склеиваются в один общий узел. Группировка
 * — по расстоянию до первой (затравочной) точки группы, тот же принцип, что
 * раньше использовал удалённый rebuildJoints для пересчёта стыков; итоговая
 * точка узла — среднее координат всех точек группы.
 */
export function migrateWallsToGraph(
  walls: readonly WallData[],
): { nodes: WallNode[]; segments: WallSegment[] } {
  const endpoints: Endpoint[] = [];
  walls.forEach((wall, wallIndex) => {
    const rad = (wall.rotation * Math.PI) / 180;
    endpoints.push({ wallIndex, end: 'start', x: wall.x, y: wall.y });
    endpoints.push({
      wallIndex,
      end: 'end',
      x: wall.x + Math.cos(rad) * wall.length,
      y: wall.y + Math.sin(rad) * wall.length,
    });
  });

  const used = new Set<Endpoint>();
  const groups: Endpoint[][] = [];
  for (const endpoint of endpoints) {
    if (used.has(endpoint)) {
      continue;
    }
    const group = [endpoint];
    used.add(endpoint);
    for (const other of endpoints) {
      if (used.has(other)) {
        continue;
      }
      const dist = Math.hypot(endpoint.x - other.x, endpoint.y - other.y);
      if (dist <= JOINT_TOLERANCE_CM) {
        group.push(other);
        used.add(other);
      }
    }
    groups.push(group);
  }

  const nodes: WallNode[] = [];
  const nodeIdByEndpoint = new Map<string, string>();
  groups.forEach((group) => {
    const avgX = group.reduce((sum, p) => sum + p.x, 0) / group.length;
    const avgY = group.reduce((sum, p) => sum + p.y, 0) / group.length;
    const nodeId = generateId('node');
    nodes.push({ id: nodeId, x: cm(avgX), y: cm(avgY) });
    group.forEach((p) => nodeIdByEndpoint.set(`${p.wallIndex}:${p.end}`, nodeId));
  });

  const segments: WallSegment[] = walls.map((wall, wallIndex) => ({
    id: generateId('wall'),
    startNodeId: nodeIdByEndpoint.get(`${wallIndex}:start`)!,
    endNodeId: nodeIdByEndpoint.get(`${wallIndex}:end`)!,
    thickness: wall.thickness,
  }));

  return { nodes, segments };
}

/**
 * Приводит SceneData любой читаемой версии к текущей (version 2). version 2
 * возвращается как есть — записывать новый код должен только её; version 1
 * узнаётся по полю version и конвертируется через migrateWallsToGraph.
 */
export function migrateSceneData(data: SceneData | SceneDataV1): SceneData {
  if (data.version === 2) {
    return data;
  }
  const { nodes, segments } = migrateWallsToGraph(data.walls);
  return { version: 2, nodes, segments, workspaces: data.workspaces, rooms: [] };
}
