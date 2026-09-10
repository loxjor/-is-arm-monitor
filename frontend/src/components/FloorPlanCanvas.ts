import Konva from 'konva';
import { Workspace } from './Workspace';
import { Wall } from './Wall';
import type { WorkspaceData } from '../types/workspace';
import type { WallData } from '../types/wall';
import { generateId } from '../utils/id';
import { cmToPx, pxToCm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import { GRID_MAJOR_EVERY, GRID_MINOR_SPACING_PX, getGridTilePattern } from '../utils/grid';
import {
  type WallEndpoint,
  findSnappedGuideLineDeg,
  intersectRaySegment,
  nearestPointOnSegment,
} from '../utils/geometry';

export type CanvasMode = 'select' | 'draw-wall';

const WALL_DRAW_MIN_LENGTH_CM = 3;
const DEFAULT_WALL_THICKNESS_CM = 10;
const MIN_WALL_THICKNESS_CM = 2;
const MAX_WALL_THICKNESS_CM = 60;
const DIMENSION_LABEL_GAP_PX = 14;

// Направляющие "векторы" от точки начала стены: каждый угол представляет
// целую линию через точку (0°/180°, 45°/225° и т.д. — одна и та же прямая).
// Допуск примагничивания к ним (GUIDE_SNAP_TOLERANCE_DEG) — внутри
// findSnappedGuideLineDeg в utils/geometry.ts.
const GUIDE_LINE_ANGLES_DEG = [0, 45, 90, 135];
const GUIDE_LINE_LENGTH_PX = 4000;
const GUIDE_HIGHLIGHT_RADIUS_PX = 40;

// Привязка новой стены к концу уже существующей: точки в пределах этого
// радиуса считаются "тем же" углом здания и совмещаются один-в-один.
const WALL_JOINT_SNAP_RADIUS_PX = 24;
const SNAP_INDICATOR_RADIUS_PX = 6;

// Столкновения ближе этого расстояния от точки старта игнорируем — обычно
// это та самая стена, от грани/угла которой мы оттолкнулись.
const WALL_COLLISION_IGNORE_RADIUS_PX = 2;

type JointEntry = { wall: Wall; end: 'start' | 'end' };
type WallSnap =
  | { kind: 'corner'; point: WallEndpoint; wall: Wall }
  | { kind: 'face'; point: WallEndpoint; throughWall: Wall };

/**
 * Обёртка над Konva.Stage: слой фона (план этажа), слой стен (структура
 * здания), слой рабочих мест и общий Transformer для выделения/ресайза/
 * поворота. Поддерживает два режима работы:
 *  - "select"    — перетаскивание и трансформация существующих объектов;
 *  - "draw-wall" — рисование новых стен протягиванием мыши по подложке, с
 *    подписями длины/толщины в сантиметрах в реальном времени.
 *
 * Все размеры, которыми обменивается этот класс с внешним кодом (WallData,
 * WorkspaceData, wallThickness), — сантиметры. В пиксели Konva-сцены они
 * переводятся только внутри, через утилиты из utils/scale.
 */
export class FloorPlanCanvas {
  private stage: Konva.Stage;
  private gridLayer: Konva.Layer;
  private backgroundLayer: Konva.Layer;
  private structureLayer: Konva.Layer;
  private mainLayer: Konva.Layer;
  private transformer: Konva.Transformer;

  private workspaces = new Map<string, Workspace>();
  private walls = new Map<string, Wall>();
  private jointPoints = new Map<string, JointEntry[]>();

  private mode: CanvasMode = 'select';
  private selectedId: string | null = null;
  private wallThicknessCm = DEFAULT_WALL_THICKNESS_CM;

  // Связанный метод как поле класса: один и тот же ссылочно-стабильный
  // обработчик для addEventListener на window (не пересоздаётся при каждом
  // рендере/вызове, и его можно снять removeEventListener этой же ссылкой).
  private readonly handleWindowPointerUp = (): void => this.handleWallDrawEnd();

  private wallDrawStart: { x: number; y: number } | null = null;
  private wallDrawStartSnap: WallSnap | null = null;
  private wallDrawEndSnap: WallSnap | null = null;
  private wallPreview: Konva.Rect | null = null;
  private wallLengthLabel: Konva.Text | null = null;
  private wallThicknessLabel: Konva.Text | null = null;
  private guideHighlight: Konva.Circle | null = null;
  private guideLines: Konva.Line[] = [];
  private wallSnapIndicator: Konva.Circle | null = null;
  private wallGhost: Konva.Rect | null = null;

  constructor(containerId: string, width: number, height: number) {
    this.stage = new Konva.Stage({
      container: containerId,
      width,
      height,
    });

    this.gridLayer = new Konva.Layer({ listening: false });
    this.backgroundLayer = new Konva.Layer({ listening: false });
    this.structureLayer = new Konva.Layer();
    this.mainLayer = new Konva.Layer();

    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      enabledAnchors: [
        'top-left',
        'top-center',
        'top-right',
        'middle-left',
        'middle-right',
        'bottom-left',
        'bottom-center',
        'bottom-right',
      ],
      boundBoxFunc: (oldBox, newBox) => {
        const minSize = 20;
        if (newBox.width < minSize || newBox.height < minSize) {
          return oldBox;
        }
        return newBox;
      },
    });

    this.stage.add(this.gridLayer);
    this.stage.add(this.backgroundLayer);
    this.stage.add(this.structureLayer);
    this.stage.add(this.mainLayer);
    this.mainLayer.add(this.transformer);

    this.drawGrid();

    this.stage.on('click tap', (event) => {
      if (event.target === this.stage) {
        this.deselect();
      }
    });

    this.stage.on('mousedown touchstart', () => this.handleWallDrawStart());
    this.stage.on('mousemove touchmove', (event) => this.handleWallDrawMove(event));

    // На window, а не на stage: если увести курсор за пределы холста и
    // отпустить кнопку там, Konva-события на stage не долетают вовсе, и
    // рисование не завершилось бы — на сцене оставались бы превью,
    // подписи и направляющие. Один слушатель, привязанный один раз в
    // конструкторе, — чтобы не было двух путей завершения одного действия.
    window.addEventListener('mouseup', this.handleWindowPointerUp);
    window.addEventListener('touchend', this.handleWindowPointerUp);
  }

  private drawGrid(): void {
    const width = this.stage.width();
    const height = this.stage.height();

    this.gridLayer.add(
      new Konva.Rect({
        x: 0,
        y: 0,
        width,
        height,
        fillPatternImage: getGridTilePattern(),
        fillPatternRepeat: 'repeat',
        listening: false,
      }),
    );

    const majorSpacing = GRID_MINOR_SPACING_PX * GRID_MAJOR_EVERY;
    for (let x = 0; x <= width; x += majorSpacing) {
      this.gridLayer.add(
        new Konva.Line({
          points: [x, 0, x, height],
          stroke: '#c3c6cd',
          strokeWidth: 1,
          listening: false,
        }),
      );
    }
    for (let y = 0; y <= height; y += majorSpacing) {
      this.gridLayer.add(
        new Konva.Line({
          points: [0, y, width, y],
          stroke: '#c3c6cd',
          strokeWidth: 1,
          listening: false,
        }),
      );
    }

    this.gridLayer.batchDraw();
  }

  setWallThickness(thicknessCm: number): void {
    this.wallThicknessCm = Math.min(
      MAX_WALL_THICKNESS_CM,
      Math.max(MIN_WALL_THICKNESS_CM, thicknessCm),
    );
  }

  getWallThickness(): number {
    return this.wallThicknessCm;
  }

  setMode(mode: CanvasMode): void {
    this.mode = mode;
    this.deselect();

    const draggable = mode === 'select';
    this.workspaces.forEach((workspace) => workspace.setDraggable(draggable));
    this.walls.forEach((wall) => wall.setDraggable(draggable));

    // В режиме рисования слои со стенами/рабочими местами не должны
    // перехватывать хит-тест: иначе клик по уже существующей стене не
    // доходит до обработчика рисования (event.target — сама стена, не
    // stage), и начать новую стену от её торца/тела нельзя. Отрисовка
    // (в т.ч. призрака и индикатора примагничивания, которые тоже лежат в
    // structureLayer) от listening(false) не зависит — это два разных канваса.
    this.structureLayer.listening(mode === 'select');
    this.mainLayer.listening(mode === 'select');

    this.stage.container().style.cursor = mode === 'draw-wall' ? 'crosshair' : 'default';

    if (mode !== 'draw-wall') {
      // Переключение инструмента посреди протяжки не должно оставлять на
      // сцене брошенное превью/направляющие — рисуемая стена просто не
      // создаётся, как будто отпустили кнопку мыши за пределами холста.
      this.clearWallDrawingVisuals();
      this.updateWallGhost(null);
    }
  }

  getMode(): CanvasMode {
    return this.mode;
  }

  loadBackgroundPlan(imageUrl: string): void {
    const image = new Image();
    image.src = imageUrl;
    image.onload = () => {
      this.backgroundLayer.destroyChildren();
      const backgroundImage = new Konva.Image({
        image,
        width: this.stage.width(),
        height: this.stage.height(),
      });
      this.backgroundLayer.add(backgroundImage);
      this.backgroundLayer.batchDraw();
    };
  }

  addWorkspace(data: WorkspaceData): Workspace {
    const workspace = new Workspace(data, (selected) => this.select(selected.group, selected.id));
    workspace.setDraggable(this.mode === 'select');
    this.mainLayer.add(workspace.group);
    this.workspaces.set(data.id, workspace);
    this.transformer.moveToTop();
    this.mainLayer.batchDraw();
    return workspace;
  }

  addWall(data: WallData): Wall {
    const wall = new Wall(data, (selected) => this.select(selected.rect, selected.id));
    wall.setDraggable(this.mode === 'select');
    this.structureLayer.add(wall.rect);
    this.walls.set(data.id, wall);
    this.registerWallJoints(data, wall);
    this.transformer.moveToTop();
    this.structureLayer.batchDraw();
    return wall;
  }

  /**
   * Регистрирует обе концевые точки стены в общем реестре стыков. Как
   * только в одной точке оказывается вторая (или третья...) стена, все
   * стены в этой точке одноразово удлиняются на свою половину толщины
   * ("квадратный торец") — это закрывает щель/нахлёст на углу без
   * построения точного полигона объединения.
   */
  private registerWallJoints(data: WallData, wall: Wall): void {
    const rad = (data.rotation * Math.PI) / 180;
    const endPoint: WallEndpoint = {
      x: data.x + Math.cos(rad) * data.length,
      y: data.y + Math.sin(rad) * data.length,
    };

    this.registerJointEnd({ x: data.x, y: data.y }, wall, 'start');
    this.registerJointEnd(endPoint, wall, 'end');
  }

  private registerJointEnd(pointCm: WallEndpoint, wall: Wall, end: 'start' | 'end'): void {
    const key = `${Math.round(pointCm.x)}:${Math.round(pointCm.y)}`;
    const entries = this.jointPoints.get(key) ?? [];
    entries.push({ wall, end });
    this.jointPoints.set(key, entries);

    if (entries.length < 2) {
      return;
    }
    entries.forEach((entry) => {
      const extendCm = entry.wall.thicknessCm / 2;
      if (entry.end === 'start') {
        entry.wall.extendStartOnce(extendCm);
      } else {
        entry.wall.extendEndOnce(extendCm);
      }
    });
  }

  /**
   * Привязка точки к УЖЕ НАРИСОВАННОЙ геометрии стен — не к их осевой линии
   * (которую видит только инструмент рисования), а к фактическому
   * прямоугольнику, который хранится и рендерится:
   *  - "corner" — курсор рядом с торцом стены (короткая грань шириной во
   *    всю толщину стены, а не точка на оси — иначе на толстых стенах
   *    магнетизм не срабатывал бы даже при наведении прямо на видимый
   *    край). Результат — осевая точка начала/конца, нужная для корректной
   *    стыковки в registerWallJoints.
   *  - "face" — курсор рядом с боковой (длинной) гранью, в её пролёте, не
   *    у самых торцов. Результат — точка ровно на этой грани (T-образное
   *    примыкание должно касаться видимой поверхности стены, а не её
   *    невидимой оси, отстоящей от края на половину толщины).
   * Побеждает ближайшая по расстоянию грань среди всех стен и обоих типов.
   */
  private findWallSnapPx(pos: WallEndpoint): WallSnap | null {
    let bestKind: 'corner' | 'face' | null = null;
    let bestPoint: WallEndpoint | null = null;
    let bestWall: Wall | null = null;
    let bestDist = WALL_JOINT_SNAP_RADIUS_PX;

    for (const wall of this.walls.values()) {
      const data = wall.toData();
      const rad = (data.rotation * Math.PI) / 180;
      const dirX = Math.cos(rad);
      const dirY = Math.sin(rad);
      const perpX = -Math.sin(rad);
      const perpY = Math.cos(rad);
      const halfPx = cmToPx(data.thickness) / 2;
      const startPx = { x: cmToPx(data.x), y: cmToPx(data.y) };
      const lengthPx = cmToPx(data.length);
      const endPx = { x: startPx.x + dirX * lengthPx, y: startPx.y + dirY * lengthPx };

      const c1 = { x: startPx.x + perpX * halfPx, y: startPx.y + perpY * halfPx };
      const c2 = { x: startPx.x - perpX * halfPx, y: startPx.y - perpY * halfPx };
      const c3 = { x: endPx.x + perpX * halfPx, y: endPx.y + perpY * halfPx };
      const c4 = { x: endPx.x - perpX * halfPx, y: endPx.y - perpY * halfPx };

      const startCapPoint = nearestPointOnSegment(pos, c1, c2);
      const startCapDist = Math.hypot(pos.x - startCapPoint.x, pos.y - startCapPoint.y);
      if (startCapDist <= bestDist) {
        bestDist = startCapDist;
        bestKind = 'corner';
        bestPoint = startPx;
        bestWall = wall;
      }

      const endCapPoint = nearestPointOnSegment(pos, c3, c4);
      const endCapDist = Math.hypot(pos.x - endCapPoint.x, pos.y - endCapPoint.y);
      if (endCapDist <= bestDist) {
        bestDist = endCapDist;
        bestKind = 'corner';
        bestPoint = endPx;
        bestWall = wall;
      }

      const t = (pos.x - startPx.x) * dirX + (pos.y - startPx.y) * dirY;
      if (t >= WALL_JOINT_SNAP_RADIUS_PX && t <= lengthPx - WALL_JOINT_SNAP_RADIUS_PX) {
        const distPerp = (pos.x - startPx.x) * perpX + (pos.y - startPx.y) * perpY;
        const faceSign = distPerp >= 0 ? 1 : -1;
        const facePoint = {
          x: startPx.x + dirX * t + perpX * halfPx * faceSign,
          y: startPx.y + dirY * t + perpY * halfPx * faceSign,
        };
        const faceDist = Math.hypot(pos.x - facePoint.x, pos.y - facePoint.y);
        if (faceDist <= bestDist) {
          bestDist = faceDist;
          bestKind = 'face';
          bestPoint = facePoint;
          bestWall = wall;
        }
      }
    }

    if (!bestKind || !bestPoint || !bestWall) {
      return null;
    }
    return bestKind === 'corner'
      ? { kind: 'corner', point: bestPoint, wall: bestWall }
      : { kind: 'face', point: bestPoint, throughWall: bestWall };
  }

  /**
   * Кратчайшее расстояние (px) от start вдоль направления (dirX, dirY) до
   * границы любой уже существующей стены, не дальше maxLengthPx. Не даёт
   * новой стене пройти сквозь/поверх уже нарисованной — она физически
   * останавливается на первом препятствии, как и полагается прямоугольнику,
   * а не абстрактной линии. Столкновения у самого начала (WALL_COLLISION_
   * IGNORE_RADIUS_PX) и у самого конца отрезка (в пределах intended-длины)
   * игнорируются — это, как правило, стена, от которой мы уже оттолкнулись
   * при старте, либо законная точка примыкания в конце.
   *
   * Для стен из ignoreWalls (та самая стена, от угла/грани которой стартовали)
   * порог игнорирования локально увеличивается до половины ЕЁ толщины: старт
   * лежит на её границе, и без этого ray сразу же "сталкивается" с её
   * собственными соседними гранями в паре пикселей от начала. Стена при этом
   * не исключается целиком — за пределами этой локальной зоны она по-прежнему
   * останавливает луч, иначе протяжка назад вдоль её же оси проходила бы
   * прямо сквозь неё без остановки.
   */
  private findFirstWallCollisionTPx(
    start: WallEndpoint,
    dirX: number,
    dirY: number,
    maxLengthPx: number,
    ignoreWalls: ReadonlySet<Wall>,
  ): number | null {
    let bestT: number | null = null;

    for (const wall of this.walls.values()) {
      const data = wall.toData();
      const rad = (data.rotation * Math.PI) / 180;
      const wDirX = Math.cos(rad);
      const wDirY = Math.sin(rad);
      const wPerpX = -Math.sin(rad);
      const wPerpY = Math.cos(rad);
      const halfPx = cmToPx(data.thickness) / 2;
      const startPx = { x: cmToPx(data.x), y: cmToPx(data.y) };
      const lengthPx = cmToPx(data.length);
      const endPx = { x: startPx.x + wDirX * lengthPx, y: startPx.y + wDirY * lengthPx };

      const c1 = { x: startPx.x + wPerpX * halfPx, y: startPx.y + wPerpY * halfPx };
      const c2 = { x: startPx.x - wPerpX * halfPx, y: startPx.y - wPerpY * halfPx };
      const c3 = { x: endPx.x + wPerpX * halfPx, y: endPx.y + wPerpY * halfPx };
      const c4 = { x: endPx.x - wPerpX * halfPx, y: endPx.y - wPerpY * halfPx };

      const edges: [WallEndpoint, WallEndpoint][] = [
        [c1, c2],
        [c3, c4],
        [c1, c3],
        [c2, c4],
      ];

      const ignoreT = ignoreWalls.has(wall)
        ? halfPx + 1
        : WALL_COLLISION_IGNORE_RADIUS_PX;

      for (const [a, b] of edges) {
        const hit = intersectRaySegment(start, dirX, dirY, a, b);
        if (!hit) {
          continue;
        }
        if (hit.t <= ignoreT || hit.t >= maxLengthPx - 0.5) {
          continue;
        }
        if (bestT === null || hit.t < bestT) {
          bestT = hit.t;
        }
      }
    }

    return bestT;
  }

  /**
   * Итоговые длина/угол/тип примыкания для конца рисуемой стены: сначала
   * примагничивание к грани/углу соседней стены (или угловая магнитность к
   * направляющим, если рядом ничего нет), затем — проверка, не проходит ли
   * получившийся отрезок СКВОЗЬ другую стену раньше своего конца; если да,
   * длина обрезается до этой стены, и она сама становится новой точкой
   * примыкания. Используется и в превью (handleWallDrawMove), и в финальном
   * результате — расчёт один и тот же, чтобы стена не "прыгала" при отпускании.
   */
  private resolveWallEnd(
    start: WallEndpoint,
    rawPos: WallEndpoint,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): { lengthPx: number; angleDeg: number; snap: WallSnap | null; snappedGuideDeg: number | null } {
    const positionSnap = this.findWallSnapPx(rawPos);

    let lengthPx: number;
    let angleDeg: number;
    let snap: WallSnap | null = positionSnap;
    let snappedGuideDeg: number | null = null;

    if (positionSnap) {
      const dx = positionSnap.point.x - start.x;
      const dy = positionSnap.point.y - start.y;
      lengthPx = Math.hypot(dx, dy);
      angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    } else {
      const geometry = this.computeWallGeometryPx(start, rawPos, event);
      lengthPx = geometry.lengthPx;
      angleDeg = geometry.angleDeg;
      snappedGuideDeg = geometry.snappedGuideDeg;
    }

    const rad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);

    // Стена, от угла/грани которой оттолкнулась протяжка, не должна
    // блокировать саму точку старта (см. findFirstWallCollisionTPx) —
    // дальше по своей длине она по-прежнему останавливает луч.
    const ignoreWalls = new Set<Wall>();
    if (this.wallDrawStartSnap) {
      ignoreWalls.add(
        this.wallDrawStartSnap.kind === 'corner'
          ? this.wallDrawStartSnap.wall
          : this.wallDrawStartSnap.throughWall,
      );
    }

    const collisionT = this.findFirstWallCollisionTPx(start, dirX, dirY, lengthPx, ignoreWalls);
    if (collisionT !== null) {
      const roughPoint = { x: start.x + dirX * collisionT, y: start.y + dirY * collisionT };
      const collisionSnap = this.findWallSnapPx(roughPoint);
      if (collisionSnap) {
        const dx = collisionSnap.point.x - start.x;
        const dy = collisionSnap.point.y - start.y;
        lengthPx = Math.hypot(dx, dy);
        angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        snap = collisionSnap;
      } else {
        lengthPx = collisionT;
        snap = null;
      }
      snappedGuideDeg = null;
    }

    return { lengthPx, angleDeg, snap, snappedGuideDeg };
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  private select(node: Konva.Node, id: string): void {
    this.selectedId = id;
    this.transformer.nodes([node]);
    this.transformer.getLayer()?.batchDraw();
  }

  private deselect(): void {
    this.selectedId = null;
    this.transformer.nodes([]);
    this.transformer.getLayer()?.batchDraw();
  }

  private handleWallDrawStart(): void {
    // Слои со стенами/рабочими местами не слушают события в этом режиме
    // (см. setMode), поэтому event.target здесь всегда stage — отдельная
    // проверка не нужна.
    if (this.mode !== 'draw-wall') {
      return;
    }
    const pointerPos = this.stage.getPointerPosition();
    if (!pointerPos) {
      return;
    }
    const startSnap = this.findWallSnapPx(pointerPos);
    const pos = startSnap?.point ?? pointerPos;
    this.wallDrawStartSnap = startSnap;
    this.updateWallGhost(null);

    const thicknessPx = cmToPx(this.wallThicknessCm);

    this.wallDrawStart = pos;

    this.guideHighlight = new Konva.Circle({
      x: pos.x,
      y: pos.y,
      radius: GUIDE_HIGHLIGHT_RADIUS_PX,
      fill: 'rgba(76, 175, 80, 0.15)',
      listening: false,
    });
    this.guideLines = GUIDE_LINE_ANGLES_DEG.map((angleDeg) => {
      const rad = (angleDeg * Math.PI) / 180;
      const dx = Math.cos(rad) * GUIDE_LINE_LENGTH_PX;
      const dy = Math.sin(rad) * GUIDE_LINE_LENGTH_PX;
      return new Konva.Line({
        points: [pos.x - dx, pos.y - dy, pos.x + dx, pos.y + dy],
        stroke: '#57c15c',
        strokeWidth: 1,
        dash: [6, 6],
        opacity: 0.4,
        listening: false,
      });
    });
    this.structureLayer.add(this.guideHighlight, ...this.guideLines);

    this.wallPreview = new Konva.Rect({
      x: pos.x,
      y: pos.y,
      width: 0,
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: 0,
      fillPatternImage: getWallHatchPattern(),
      fillPatternRepeat: 'repeat',
      stroke: '#3a3a3a',
      strokeWidth: 1,
      listening: false,
    });
    this.wallLengthLabel = new Konva.Text({
      text: '0',
      fontSize: 13,
      fontStyle: 'bold',
      fill: '#1f2430',
      listening: false,
    });
    this.wallThicknessLabel = new Konva.Text({
      text: `${this.wallThicknessCm}`,
      fontSize: 13,
      fill: '#1f2430',
      listening: false,
    });
    this.structureLayer.add(this.wallPreview, this.wallLengthLabel, this.wallThicknessLabel);
  }

  private handleWallDrawMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    const pos = this.stage.getPointerPosition();
    if (!pos) {
      return;
    }

    // Ещё не рисуем стену — под курсором "призрак" (квадрат сечения стены)
    // и подсветка точки, к которой притянется клик, если она рядом (угол
    // или середина существующей стены).
    if (!this.wallDrawStart || !this.wallPreview) {
      if (this.mode === 'draw-wall') {
        const hoverSnap = this.findWallSnapPx(pos);
        this.updateWallGhost(hoverSnap?.point ?? pos);
        this.updateWallSnapIndicator(hoverSnap);
        this.structureLayer.batchDraw();
      }
      return;
    }

    const thicknessPx = cmToPx(this.wallThicknessCm);

    // Примагничивание к грани/углу соседней стены и обрезка при столкновении
    // с уже существующей стеной — общая логика, см. resolveWallEnd. Делаем
    // это здесь же, во время протяжки, а не только при отпускании кнопки —
    // иначе пользователь не увидит, что стена уже уткнулась в препятствие.
    const { lengthPx, angleDeg, snap, snappedGuideDeg } = this.resolveWallEnd(
      this.wallDrawStart,
      pos,
      event,
    );
    this.wallDrawEndSnap = snap;

    this.wallPreview.setAttrs({
      width: lengthPx,
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: angleDeg,
    });

    this.updateWallDimensionLabels(this.wallDrawStart, lengthPx, angleDeg, thicknessPx);
    this.updateGuideHighlight(snappedGuideDeg);
    this.updateWallSnapIndicator(snap);
    this.structureLayer.batchDraw();
  }

  /**
   * Убирает превью стены, подписи размеров, направляющие и индикатор
   * примагничивания со сцены и сбрасывает состояние протяжки. Общий выход
   * для всех путей завершения/прерывания рисования (mouseup/touchend вне
   * зависимости от того, где отпустили кнопку, и смена режима во время
   * протяжки) — чтобы на сцене не оставалось "осиротевших" узлов.
   */
  private clearWallDrawingVisuals(): void {
    this.wallPreview?.destroy();
    this.wallPreview = null;
    this.wallLengthLabel?.destroy();
    this.wallLengthLabel = null;
    this.wallThicknessLabel?.destroy();
    this.wallThicknessLabel = null;
    this.guideHighlight?.destroy();
    this.guideHighlight = null;
    this.guideLines.forEach((line) => line.destroy());
    this.guideLines = [];
    this.updateWallSnapIndicator(null);
    this.wallDrawStart = null;
    this.wallDrawStartSnap = null;
    this.wallDrawEndSnap = null;
  }

  private handleWallDrawEnd(): void {
    if (!this.wallDrawStart || !this.wallPreview) {
      return;
    }

    const start = this.wallDrawStart;
    const lengthPx = this.wallPreview.width();
    const rotation = this.wallPreview.rotation();

    // Точка конца уже была примагничена вживую в handleWallDrawMove — здесь
    // просто забираем итоговый результат, чтобы не пересчитывать и не
    // рисковать разойтись с тем, что пользователь видел на превью.
    const startSnap = this.wallDrawStartSnap;
    const endSnap = this.wallDrawEndSnap;

    this.clearWallDrawingVisuals();

    if (pxToCm(lengthPx) >= WALL_DRAW_MIN_LENGTH_CM) {
      const wall = this.addWall({
        id: generateId('wall'),
        x: pxToCm(start.x),
        y: pxToCm(start.y),
        length: pxToCm(lengthPx),
        thickness: this.wallThicknessCm,
        rotation,
      });

      // Угол-к-углу уже закрывается в registerWallJoints. T-образное
      // примыкание (конец новой стены упирается в грань другой) — отдельный
      // случай: точка примыкания уже лежит на видимой поверхности сквозной
      // стены, поэтому "стержень" достаточно довести дальше на свою же
      // полтолщины — он войдёт в тело сквозной стены и скроется в её
      // непрозрачной заливке, без щели. Саму сквозную стену не трогаем —
      // она и так непрерывна.
      if (startSnap?.kind === 'face') {
        wall.extendStartOnce(wall.thicknessCm / 2);
      }
      if (endSnap?.kind === 'face') {
        wall.extendEndOnce(wall.thicknessCm / 2);
      }
    } else {
      this.structureLayer.batchDraw();
    }
  }

  /**
   * Длина (px) и угол линии от start до pos. Если курсор попадает в допуск
   * GUIDE_SNAP_TOLERANCE_DEG вокруг одной из направляющих (0/45/90/135°),
   * угол магнитится к ней — как обычная угловая привязка в CAD-инструментах.
   * Зажатый Shift отключает магнетизм для действительно свободного угла.
   */
  private computeWallGeometryPx(
    start: { x: number; y: number },
    pos: { x: number; y: number },
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): { lengthPx: number; angleDeg: number; snappedGuideDeg: number | null } {
    const dx = pos.x - start.x;
    const dy = pos.y - start.y;
    const rawAngleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    let angleDeg = rawAngleDeg;
    let lengthPx = Math.hypot(dx, dy);

    const nativeEvent = event.evt as MouseEvent;
    const magnetismEnabled = !nativeEvent.shiftKey;
    const snappedGuideDeg = magnetismEnabled ? findSnappedGuideLineDeg(rawAngleDeg) : null;

    if (snappedGuideDeg !== null) {
      angleDeg = Math.round(rawAngleDeg / 45) * 45;
      // Проецируем вектор мыши на выбранное направление, иначе длина стены
      // будет завышена на величину бокового отклонения курсора.
      const angleRad = (angleDeg * Math.PI) / 180;
      lengthPx = Math.max(0, dx * Math.cos(angleRad) + dy * Math.sin(angleRad));
    }

    return { lengthPx, angleDeg, snappedGuideDeg };
  }

  /** Подсвечивает активную направляющую и точку начала, когда магнетизм сработал. */
  private updateGuideHighlight(snappedGuideDeg: number | null): void {
    this.guideHighlight?.fill(
      snappedGuideDeg !== null ? 'rgba(76, 175, 80, 0.28)' : 'rgba(76, 175, 80, 0.15)',
    );

    GUIDE_LINE_ANGLES_DEG.forEach((guideAngle, index) => {
      const line = this.guideLines[index];
      const isActive = snappedGuideDeg === guideAngle;
      line.stroke(isActive ? '#2e7d32' : '#57c15c');
      line.strokeWidth(isActive ? 1.5 : 1);
      line.opacity(isActive ? 0.9 : 0.4);
    });
  }

  /** Кружок-индикатор точки примагничивания (угол/середина стены) — отдельно от угловых направляющих. */
  private updateWallSnapIndicator(snap: WallSnap | null): void {
    if (!snap) {
      this.wallSnapIndicator?.destroy();
      this.wallSnapIndicator = null;
      return;
    }

    if (!this.wallSnapIndicator) {
      this.wallSnapIndicator = new Konva.Circle({
        radius: SNAP_INDICATOR_RADIUS_PX,
        stroke: '#1976d2',
        strokeWidth: 2,
        fill: '#ffffff',
        listening: false,
      });
      this.structureLayer.add(this.wallSnapIndicator);
    }

    this.wallSnapIndicator.position(snap.point);
    this.wallSnapIndicator.moveToTop();
  }

  /**
   * "Призрак" — квадрат сечения стены (толщина × толщина) под курсором в
   * режиме рисования до начала протяжки. Показывает, с какой толщиной и
   * в какой именно точке начнётся стена, если кликнуть прямо сейчас —
   * центр призрака совпадает с точкой примагничивания, когда она есть.
   */
  private updateWallGhost(point: WallEndpoint | null): void {
    if (!point) {
      this.wallGhost?.destroy();
      this.wallGhost = null;
      return;
    }

    const sizePx = cmToPx(this.wallThicknessCm);

    if (!this.wallGhost) {
      this.wallGhost = new Konva.Rect({
        fillPatternImage: getWallHatchPattern(),
        fillPatternRepeat: 'repeat',
        opacity: 0.55,
        stroke: '#3a3a3a',
        strokeWidth: 1,
        dash: [3, 3],
        listening: false,
      });
      this.structureLayer.add(this.wallGhost);
    }

    this.wallGhost.setAttrs({
      width: sizePx,
      height: sizePx,
      offsetX: sizePx / 2,
      offsetY: sizePx / 2,
      x: point.x,
      y: point.y,
    });
    this.wallGhost.moveToTop();
  }

  /**
   * Подпись длины — по центру линии стены, вдоль её направления (с
   * коррекцией "вверх ногами" для углов больше 90°). Подпись толщины — у
   * конца стены, всегда горизонтальная. Обе смещены перпендикулярно линии,
   * чтобы не перекрывать саму штриховку.
   */
  private updateWallDimensionLabels(
    start: { x: number; y: number },
    lengthPx: number,
    angleDeg: number,
    thicknessPx: number,
  ): void {
    if (!this.wallLengthLabel || !this.wallThicknessLabel) {
      return;
    }

    const angleRad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -Math.sin(angleRad);
    const perpY = Math.cos(angleRad);
    const labelOffset = thicknessPx / 2 + DIMENSION_LABEL_GAP_PX;

    let textRotation = angleDeg;
    if (textRotation > 90 || textRotation < -90) {
      textRotation += 180;
    }

    const midX = start.x + (dirX * lengthPx) / 2 - perpX * labelOffset;
    const midY = start.y + (dirY * lengthPx) / 2 - perpY * labelOffset;

    this.wallLengthLabel.setAttrs({
      text: `${Math.round(pxToCm(lengthPx))}`,
      x: midX,
      y: midY,
      rotation: textRotation,
    });

    const endX = start.x + dirX * lengthPx - perpX * labelOffset;
    const endY = start.y + dirY * lengthPx - perpY * labelOffset;

    this.wallThicknessLabel.setAttrs({
      x: endX + dirX * DIMENSION_LABEL_GAP_PX,
      y: endY + dirY * DIMENSION_LABEL_GAP_PX,
    });
  }
}
