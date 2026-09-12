import type { WallData, WallNode, WallSegment } from './wall';
import type { WorkspaceData } from './workspace';

/**
 * Снимок всей сцены — используется и для undo внутри сессии (Т-05), и как
 * формат, который уходит на сервер целиком одним PUT (Т-03). version — на
 * будущее: контракт, который едет в базу, версионируем с первого дня, а не
 * когда придётся мигрировать первую сохранённую запись.
 *
 * Стены — граф узлов и рёбер (Этап 5, см. types/wall.ts), а не список
 * независимых отрезков: соседние стены делят узел угла буквально (один и
 * тот же id), а не совпадают по координатам. Угол поэтому не хранится
 * отдельно и не требует пересчёта — он вычисляется из рёбер, сходящихся в
 * общем узле.
 */
export interface SceneData {
  version: 2;
  nodes: WallNode[];
  segments: WallSegment[];
  workspaces: WorkspaceData[];
}

/**
 * Старый (version 1) формат — стены независимыми отрезками. Живёт только
 * ради чтения ранее сохранённых планов; писать его новый код не должен.
 * migrateSceneData (utils/wallGraph.ts) переводит его в SceneData.
 */
export interface SceneDataV1 {
  version: 1;
  walls: WallData[];
  workspaces: WorkspaceData[];
}
