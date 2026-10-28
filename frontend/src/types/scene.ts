import type { WallData, WallNode, WallSegment } from './wall';
import type { WorkspaceData } from './workspace';
import type { WallOpening } from './opening';
import type { FixtureData } from './fixture';
import type { Cm } from '../utils/scale';

/**
 * Подпись помещения: название (новое получает "каб. N", его можно сменить
 * хоть на "Коридор") и необязательное примечание. Помещения не хранятся —
 * они находятся заново как замкнутые контуры стен (utils/rooms.ts); подпись
 * принадлежит тому, внутри которого лежит её точка, поэтому переживает
 * правку стен вокруг.
 */
export interface RoomLabel {
  id: string;
  x: Cm;
  y: Cm;
  title: string;
  /** Пустая строка — без примечания. */
  note: string;
}

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
  /** Нет в снимках, сделанных до появления названий помещений. */
  rooms?: RoomLabel[];
  /** Двери и окна; нет в снимках, сделанных до их появления. */
  openings?: WallOpening[];
  /** Лестницы и лифты; нет в снимках, сделанных до их появления. */
  fixtures?: FixtureData[];
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

/**
 * Этаж плана: своя сцена (стены, проёмы, подписи, рабочие места). На холсте
 * всегда один этаж; остальные лежат здесь же и подставляются при
 * переключении (см. main.ts).
 */
export interface PlanFloor {
  id: string;
  name: string;
  scene: SceneData;
}

/** План целиком — то, что сохраняется и загружается одним документом. */
export interface PlanData {
  floors: PlanFloor[];
}

/** Пустая сцена — новый этаж или новый план. */
export function emptyScene(): SceneData {
  return { version: 2, nodes: [], segments: [], workspaces: [], rooms: [], openings: [], fixtures: [] };
}
