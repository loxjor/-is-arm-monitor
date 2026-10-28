import Konva from 'konva';
import { Workspace } from './Workspace';
import { DeskSelection } from './DeskSelection';
import { Wall } from './Wall';
import { WallControls, type WallEnd } from './WallControls';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { WallNode, WallSegment } from '../types/wall';
import type { SceneData, SceneDataV1 } from '../types/scene';
import { migrateSceneData } from '../utils/wallGraph';
import {
  computeNodeFaceVertices,
  buildSegmentPolygon,
  type FaceLine,
  type NodeRay,
} from '../utils/wallPolygon';
import { generateId } from '../utils/id';
import {
  boundsMayOverlap,
  boundsOf,
  polygonsOverlap,
  rectCorners,
  shrinkRect,
  type Point as DeskPoint,
} from '../utils/deskCollision';
import { PIXELS_PER_CM, cm, cmToPx, pxToCm, type Cm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import { onThemeChange, palette, withAlpha } from '../theme';
import { GRID_MAJOR_EVERY, GRID_MINOR_SPACING_PX, getGridTilePattern } from '../utils/grid';
import {
  type WallEndpoint,
  GUIDE_LINE_ANGLES_DEG,
  angleDiffDeg,
  findSnappedGuideLineDeg,
  intersectRaySegment,
  rayStartRelation,
} from '../utils/geometry';
import { alignmentLines, snapToAlignment, type AlignLine, type AlignResult } from '../utils/wallAlign';
import { findRooms, polygonCentroid, type Room } from '../utils/rooms';
import { changeGate, lastValueMemo, wallGraphKey } from '../utils/memo';
import {
  findAbutmentFace,
  prepareAbutmentWalls,
  type AbutmentWallInput,
  type PreparedAbutmentWall,
} from '../utils/wallAbutment';
import { pointAtDistance, shiftAxisForOneSidedThickness, type WallSide } from '../utils/wallEdit';
import {
  faceForwardGeometry,
  END_SECTOR_LIMIT_DEG,
  endGuideLinesDeg,
  endSectorGeometry,
  faceGuideLinesDeg,
  findFaceHug,
  isInForwardSector,
  isInSector,
  nextDrawMode,
  type DrawMode,
  type FaceHug,
  type WallBody,
} from '../utils/wallStart';

// 'view' — только просмотр (учётная часть): объекты не выделяются и не
// двигаются, работают лишь зум и панорамирование.
export type CanvasMode = 'select' | 'draw-wall' | 'view' | 'place-desk';

/** Размер стола, который ставит инструмент «Рабочее место», см (как DESK в workplace-map). */
export const DESK_PLACEMENT_SIZE_CM = { width: 120, height: 60 } as const;
const DESK_GRID_SNAP_CM = 10;
// Поворот стола рамкой Transformer — с привязкой к шагу 45° (rotationSnapStep в workplace-map).
const DESK_ROTATION_SNAP_DEG = 45;
const DESK_SWEEP_STEP_PX = 2;
const DESK_SWEEP_STEP_DEG = 2;

/** То, что тулбар показывает про выделенную стену. */
export interface SelectedWallInfo {
  lengthCm: Cm;
  thicknessCm: Cm;
}

const WALL_DRAW_MIN_LENGTH_CM = 3;
const MAX_WALL_LENGTH_CM = 10000;
// Шаг кнопок толщины −/+ у выделенной стены; с Shift — крупный шаг.
const THICKNESS_STEP_CM = 1;
const THICKNESS_STEP_LARGE_CM = 5;
const DEFAULT_WALL_THICKNESS_CM = 10;
const MIN_WALL_THICKNESS_CM = 2;
const MAX_WALL_THICKNESS_CM = 60;
const DIMENSION_LABEL_GAP_PX = 14;

// Направляющие "векторы" от точки начала стены: каждый угол представляет
// целую линию через точку (0°/180°, 45°/225° и т.д. — одна и та же прямая),
// см. GUIDE_LINE_ANGLES_DEG в utils/geometry.ts (тот же массив, чтобы
// отрисовка и магнетизм не могли разойтись).
//
// Допуск примагничивания задан РАССТОЯНИЕМ от курсора до направляющей
// (GUIDE_SNAP_TOLERANCE_CM), а не разницей углов: угловой допуск на длинной
// стене давал огромное отклонение в сантиметрах (5° на стене в 10 м — это
// 87 см бокового смещения, стена молча "выпрямлялась" от почти любого
// нажатия), а допуск в сантиметрах от длины стены не зависит — см.
// findSnappedGuideLineDeg в utils/geometry.ts.
const GUIDE_SNAP_TOLERANCE_CM = 5;
// Выравнивание по осям других стен захватывает чуть шире угловых
// направляющих: курсор "притормаживает" у линии, а не проскакивает её.
const ALIGN_SNAP_TOLERANCE_CM = 8;
// Призрак прилегает к грани, пока курсор не дальше толщины + 5 см от неё
// (RemPlanner: 2·_offset + 5 при _offset = полутолщины) — в см сцены, а не в
// экранных px, как и у них.
const FACE_HUG_EXTRA_CM = 5;
// Штырь при нажатии у грани тянется за курсором внутри квадрата призрака, но
// не короче 80% толщины (у RemPlanner 8 при толщине 10).
const FACE_STUB_MIN_FRACTION = 0.8;
const GUIDE_LINE_LENGTH_PX = 4000;
const GUIDE_HIGHLIGHT_RADIUS_PX = 40;

// Привязка новой стены к узлу/грани уже существующей: точки в пределах этого
// радиуса считаются "тем же" углом здания и совмещаются один-в-один (для
// угла — путём переиспользования id существующего узла, см. findWallSnapPx).
const WALL_JOINT_SNAP_RADIUS_PX = 24;
// Призрак и точка старта/конца стены рядом с чужой стеной садятся на её
// ГРАНЬ (как физический объект — не заходят внутрь тела), а не на ось: ось
// (T-примыкание, см. splitWallAtPoint) — только когда курсор целится
// почти точно в центр тела стены, а не просто "где-то рядом с ней". Этот
// порог поэтому заметно меньше WALL_JOINT_SNAP_RADIUS_PX.
const WALL_AXIS_SNAP_RADIUS_PX = 6;
const SNAP_INDICATOR_RADIUS_PX = 6;

// Столкновения ближе этого расстояния от точки старта игнорируем — обычно
// это та самая стена, от грани/угла которой мы оттолкнулись.
const WALL_COLLISION_IGNORE_RADIUS_PX = 2;
// Допуск "старт лежит на грани/оси" в px сцены: точки привязки к грани и оси
// вычисляются ровно, расхождение — только погрешность float.
const RAY_START_EPSILON_PX = 0.5;

// Диапазон зума колесом мыши (stage.scale()) и шаг увеличения за одно
// деление колеса.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.05;
// Отступ от краёв экрана при "вписать в экран" (resetView) — в экранных px.
const VIEW_RESET_PADDING_PX = 60;

// Статичное поле сетки: ±GRID_HALF_EXTENT_PX от начала координат сцены
// (100 м в сумме на ось при PIXELS_PER_CM=2) — с запасом под "план шириной
// не менее 60 м" из критерия приёмки. Не привязано к размеру окна и не
// перерисовывается при pan/zoom: глобальная трансформация stage двигает и
// масштабирует его вместе со всем остальным содержимым бесплатно.
const GRID_HALF_EXTENT_PX = 10000;
// Ниже этого масштаба мелкая сетка (шаг 40px в координатах сцены) превращается
// в кашу на экране — прячем её, крупная сетка остаётся ориентиром.
const GRID_MINOR_VISIBLE_ABOVE_SCALE = 0.4;

const UNDO_STACK_DEPTH = 50;

type WallSnap =
  | { kind: 'corner'; point: WallEndpoint; nodeId: string }
  | { kind: 'axis'; point: WallEndpoint; wallId: string }
  | { kind: 'face'; point: WallEndpoint };

/**
 * Куда встанет начало новой стены под курсором и как нарисовать призрак.
 * Угол — существующий узел (призрак по центру узла); грань — точка контакта
 * на грани чужой стены, а призрак вплотную снаружи (см. utils/wallStart.ts).
 */
interface WallStartHit {
  snap: WallSnap | null;
  ghostCenter: WallEndpoint;
  ghostRotationDeg: number;
  face: FaceHug | null;
  // Старт от торца — продолжение свободного конца стены: направление
  // продолжения (от тела стены наружу) и перпендикуляр к нему; допустимые
  // углы новой стены — ±135° от продолжения (см. endSectorGeometry).
  endSector: { forward: WallEndpoint; side: WallEndpoint } | null;
}

/** Итог расчёта конца рисуемой стены (см. resolveWallEnd). */
interface WallEndResolution {
  lengthPx: number;
  angleDeg: number;
  snap: WallSnap | null;
  snappedGuideDeg: number | null;
  /** Выравнивание конца по линиям от других стен (если сработало). */
  align?: AlignResult;
}

/**
 * Обёртка над Konva.Stage: слой фона (план этажа), слой стен (структура
 * здания), слой рабочих мест и общий Transformer для выделения/ресайза/
 * поворота. Поддерживает два режима работы:
 *  - "select"    — перетаскивание и трансформация существующих объектов;
 *  - "draw-wall" — рисование новых стен протягиванием мыши по подложке, с
 *    подписями длины/толщины в сантиметрах в реальном времени.
 *
 * Стены — граф узлов (WallNode) и рёбер (WallSegment, см. types/wall.ts), а
 * не список независимых прямоугольников: соседние стены делят вершину угла
 * буквально (один и тот же id узла), поэтому угол не хранится отдельным
 * состоянием и не требует пересчёта после перемещения/трансформации — он
 * всегда соответствует текущим координатам общего узла (см. Wall.render).
 *
 * Все размеры, которыми обменивается этот класс с внешним кодом (WallNode,
 * WallSegment, WorkspaceData, wallThickness), — сантиметры. В пиксели
 * Konva-сцены они переводятся только внутри, через утилиты из utils/scale.
 */
export class FloorPlanCanvas {
  private stage: Konva.Stage;
  private gridLayer: Konva.Layer;
  private gridMinorRect: Konva.Rect | null = null;
  private backgroundLayer: Konva.Layer;
  private structureLayer: Konva.Layer;
  private dimensionLayer: Konva.Layer;
  private mainLayer: Konva.Layer;
  private controlsLayer: Konva.Layer;
  private deskSelection: DeskSelection;
  private wallControls: WallControls;
  private onSelectionChange: ((wall: SelectedWallInfo | null) => void) | null = null;
  /**
   * Пропуск повторных уведомлений тулбара: emitSelectionChange зовётся из
   * каждого rebuildWallGeometry (в том числе на каждый mousemove при
   * перетаскивании), а панель настроек нужно перерисовывать, только когда
   * поменялось то, что она показывает.
   */
  private readonly selectionChangeGate = changeGate();
  // Перетаскивание ручки конца выделенной стены: какой узел тянем и к какому
  // чужому узлу он сейчас примагничен (тогда при отпускании узлы сливаются).
  /**
   * Перетаскивание ручки конца. adjacentNodeIds/sharingWallIds считаются один
   * раз в начале жеста: пока ручку тянут, двигаются только координаты узла,
   * связи графа не меняются (слияние узлов — уже при отпускании).
   */
  private handleDrag: {
    nodeId: string;
    mergeTargetNodeId: string | null;
    adjacentNodeIds: ReadonlySet<string>;
    sharingWallIds: ReadonlySet<string>;
  } | null = null;

  private workspaces = new Map<string, Workspace>();
  private nodes = new Map<string, WallNode>();
  private walls = new Map<string, Wall>();

  private mode: CanvasMode = 'select';
  private selectedId: string | null = null;
  private wallThicknessCm: Cm = cm(DEFAULT_WALL_THICKNESS_CM);
  // Толщина выделенной стены меняется вживую при каждом вводе в поле
  // тулбара (см. setWallThickness), но в undo должно попасть ОДНО действие
  // на всю сессию редактирования, а не одно на каждое нажатие клавиши —
  // флаг взводится при первом реальном изменении после выделения и
  // сбрасывается при следующей смене выделения.
  private selectedWallThicknessSnapshotTaken = false;

  private undoStack: SceneData[] = [];
  // На время restore() регистрация узлов/сегментов/рабочих мест не должна
  // сама себе класть снимки в стек undo — иначе отмена действия сама стала
  // бы отменяемым действием и стек бы никогда не пустел на "исходное" состояние.
  private isRestoring = false;
  private onScaleChange: ((scale: number) => void) | null = null;

  // Связанный метод как поле класса: один и тот же ссылочно-стабильный
  // обработчик для addEventListener на window (не пересоздаётся при каждом
  // рендере/вызове, и его можно снять removeEventListener этой же ссылкой).
  private readonly handleWindowPointerUp = (): void => this.handleWallDrawEnd();

  // Панорамирование средней кнопкой мыши — независимо от Konva-drag'а
  // объектов/stage, поэтому не может с ним конфликтовать: активируется
  // только по event.button === 1, который рисование и Transformer не трогают.
  private isPanning = false;
  private panStart: { pointerX: number; pointerY: number; stageX: number; stageY: number } | null =
    null;
  private readonly handlePanMove = (event: MouseEvent): void => this.handleMiddleButtonPanMove(event);
  private readonly handlePanEnd = (event: MouseEvent): void => this.handleMiddleButtonPanEnd(event);
  /**
   * Зум двумя пальцами: расстояние между пальцами, масштаб и точка сцены
   * под серединой между ними в момент касания вторым пальцем. Пока жест
   * идёт, остальные обработчики касаний (рисование, призрак стола) молчат.
   */
  private pinch: {
    distance: number;
    scale: number;
    pointTo: { x: number; y: number };
    /** draggable сцены до жеста: на время жеста перетаскивание выключено, иначе первый палец двигал бы сцену поверх зума. */
    wasDraggable: boolean;
  } | null = null;

  private wallDrawStart: { x: number; y: number } | null = null;
  private wallDrawStartSnap: WallSnap | null = null;
  // Старт от грани чужой стены: грань и выбранный режим протяжки — вперёд
  // свободным углом или параллельно грани, прижавшись к ней (см. nextDrawMode).
  private wallDrawFace: FaceHug | null = null;
  /** Линии-ориентиры текущей протяжки (см. alignWallEnd); null — вне протяжки или ещё не построены. */
  private wallDrawAlignLines: AlignLine[] | null = null;
  private wallDrawMode: DrawMode = 'none';
  // Старт от торца: сектор допустимых углов ±135° от продолжения стены и
  // красный сектор запрета позади торца (см. WallStartHit.endSector).
  private wallDrawEndSector: WallStartHit['endSector'] = null;
  private forbiddenWedge: Konva.Wedge | null = null;
  // Ось рисуемой стены (между узлами) — итог превью: длина и угол.
  private wallDrawAxis = { lengthPx: 0, angleDeg: 0 };
  private wallDrawEndSnap: WallSnap | null = null;
  private wallPreview: Konva.Rect | null = null;
  private wallLengthLabel: Konva.Text | null = null;
  private wallThicknessLabel: Konva.Text | null = null;
  private guideHighlight: Konva.Circle | null = null;
  private guideLines: Konva.Line[] = [];
  // Пунктир выравнивания от концов/узлов других стен и заливка замкнутых помещений.
  private alignGuideNodes: (Konva.Line | Konva.Circle)[] = [];
  private roomGroup = new Konva.Group({ listening: false });
  private readonly roomsMemo = lastValueMemo<Room[]>();
  /** Помещения, по которым построены текущие узлы roomGroup (null — пересоздать). */
  private renderedRooms: Room[] | null = null;
  private roomLabels: { label: Konva.Text; centroid: WallEndpoint }[] = [];
  private readonly continuableFreeEndsMemo = lastValueMemo<ReadonlySet<string>>();
  // Мировые углы линий-направляющих текущей протяжки: четыре мировые оси
  // для свободного старта, нормаль и ±45° — для старта от грани.
  private guideAnglesDeg: number[] = GUIDE_LINE_ANGLES_DEG;
  private wallSnapIndicator: Konva.Circle | null = null;
  private wallGhost: Konva.Rect | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeTheme: () => void;
  private snapEnabled = true;
  private deskGhost: Konva.Rect | null = null;
  private deskGhostRotation = 0;
  private onDeskPlace: ((topLeftCm: { x: Cm; y: Cm }, rotation: number) => void) | null = null;

  constructor(containerId: string, width: number, height: number) {
    this.stage = new Konva.Stage({
      container: containerId,
      width,
      height,
    });

    this.gridLayer = new Konva.Layer({ listening: false });
    this.backgroundLayer = new Konva.Layer({ listening: false });
    this.structureLayer = new Konva.Layer();
    this.dimensionLayer = new Konva.Layer({ listening: false });
    this.mainLayer = new Konva.Layer();
    this.controlsLayer = new Konva.Layer();
    this.wallControls = new WallControls({
      onHandleDragStart: (end) => this.handleWallEndDragStart(end),
      onHandleDragMove: (end, pos, shiftKey) => this.handleWallEndDragMove(end, pos, shiftKey),
      onHandleDragEnd: () => this.handleWallEndDragEnd(),
      onThicknessStep: (side, direction, shiftKey) =>
        this.stepSelectedWallThickness(side, direction * (shiftKey ? THICKNESS_STEP_LARGE_CM : THICKNESS_STEP_CM)),
    });
    this.controlsLayer.add(this.wallControls.group);

    this.deskSelection = new DeskSelection(this.stage, {
      onStart: () => this.pushUndoSnapshot(),
      onRotate: (workspace, angle) => this.rotateDeskTo(workspace, angle),
      onEnd: (workspace) => this.finishDeskRotation(workspace),
    });
    this.controlsLayer.add(this.deskSelection.group);

    this.backgroundLayer.add(this.roomGroup);
    this.stage.add(this.gridLayer);
    this.stage.add(this.backgroundLayer);
    this.stage.add(this.structureLayer);
    this.stage.add(this.dimensionLayer);
    this.stage.add(this.mainLayer);
    this.stage.add(this.controlsLayer);

    this.drawGrid();

    this.stage.on('click tap', (event) => {
      // Konva шлёт click при отпускании ручки поворота над пустой сценой — раньше,
      // чем поворот завершится (window mouseup), и выделение не должно слететь.
      if (event.target === this.stage && !this.deskSelection.isRotating) {
        this.deselect();
      }
    });

    // Раньше остальных обработчиков касаний: второй палец должен успеть
    // прервать начатую первым пальцем протяжку, пока она не продолжилась.
    // hitOnDragEnabled — чтобы touchmove доходил и во время перетаскивания сцены.
    Konva.hitOnDragEnabled = true;
    this.stage.on('touchstart touchmove', (event) => this.handlePinch(event.evt));
    window.addEventListener('touchend', this.handlePinchEnd);
    window.addEventListener('touchcancel', this.handlePinchEnd);
    this.stage.on('mousedown touchstart', (event) => this.handleWallDrawStart(event));
    this.stage.on('mousemove touchmove', (event) => this.handleWallDrawMove(event));
    this.stage.on('wheel', (event) => this.handleWheelZoom(event));
    this.stage.on('mousemove touchmove', () => {
      if (this.mode !== 'place-desk' || this.pinch) return;
      const pointer = this.stage.getRelativePointerPosition();
      if (pointer) this.updateDeskGhost(pointer);
    });
    this.stage.on('click tap', (event) => this.handleDeskPlaceClick(event));
    this.stage.container().addEventListener('mouseleave', () => this.hideDeskGhost());

    // На window, а не на stage: если увести курсор за пределы холста и
    // отпустить кнопку там, Konva-события на stage не долетают вовсе, и
    // рисование не завершилось бы — на сцене оставались бы превью,
    // подписи и направляющие. Один слушатель, привязанный один раз в
    // конструкторе, — чтобы не было двух путей завершения одного действия.
    window.addEventListener('mouseup', this.handleWindowPointerUp);
    window.addEventListener('touchend', this.handleWindowPointerUp);

    // Панорамирование средней кнопкой — сырые DOM-события в обход Konva,
    // работает в любом режиме и не конфликтует с рисованием (там отдельная
    // проверка кнопки) и с перетаскиванием объектов (у них своя draggable).
    this.stage.container().addEventListener('mousedown', (event) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      this.isPanning = true;
      this.panStart = {
        pointerX: event.clientX,
        pointerY: event.clientY,
        stageX: this.stage.x(),
        stageY: this.stage.y(),
      };
      window.addEventListener('mousemove', this.handlePanMove);
      window.addEventListener('mouseup', this.handlePanEnd);
    });

    this.resizeObserver = new ResizeObserver(() => {
      const container = this.stage.container();
      this.stage.width(container.clientWidth);
      this.stage.height(container.clientHeight);
      this.stage.batchDraw();
    });
    this.resizeObserver.observe(this.stage.container());
    this.unsubscribeTheme = onThemeChange(() => this.applyTheme());

    // Пока рисуем стену, курсор мог уйти за пределы холста без отпускания
    // кнопки (её отпустят уже на window — см. handleWindowPointerUp) —
    // саму протяжку это не прерывает. А вот "призрак"/индикатор
    // примагничивания, которые показываются ДО начала протяжки, обязаны
    // исчезнуть: иначе они зависают на краю холста после того, как курсор
    // его покинул, и mousemove для их обновления больше не приходит.
    this.stage.container().addEventListener('mouseleave', () => {
      if (this.wallDrawStart) {
        return;
      }
      this.updateWallGhost(null);
      this.updateWallSnapIndicator(null);
      this.structureLayer.batchDraw();
    });

    // Применяем режим по умолчанию: без этого вызова stage.draggable()
    // остаётся false и курсор — не 'default'/'crosshair' до первого клика
    // по кнопке тулбара, хотя this.mode уже логически 'select'.
    this.setMode(this.mode);
  }

  private handleMiddleButtonPanMove(event: MouseEvent): void {
    if (!this.isPanning || !this.panStart) {
      return;
    }
    this.stage.position({
      x: this.panStart.stageX + (event.clientX - this.panStart.pointerX),
      y: this.panStart.stageY + (event.clientY - this.panStart.pointerY),
    });
    this.stage.batchDraw();
  }

  private handleMiddleButtonPanEnd(event: MouseEvent): void {
    if (event.button !== 1) {
      return;
    }
    this.isPanning = false;
    this.panStart = null;
    window.removeEventListener('mousemove', this.handlePanMove);
    window.removeEventListener('mouseup', this.handlePanEnd);
  }

  /** Зум колесом мыши с сохранением точки сцены под курсором на месте. */
  private handleWheelZoom(event: Konva.KonvaEventObject<WheelEvent>): void {
    event.evt.preventDefault();

    const oldScale = this.stage.scaleX();
    const pointer = this.stage.getPointerPosition();
    if (!pointer) {
      return;
    }

    const pointTo = {
      x: (pointer.x - this.stage.x()) / oldScale,
      y: (pointer.y - this.stage.y()) / oldScale,
    };

    const direction = event.evt.deltaY > 0 ? -1 : 1;
    const rawScale = direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP;
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawScale));

    this.stage.scale({ x: newScale, y: newScale });
    this.stage.position({
      x: pointer.x - pointTo.x * newScale,
      y: pointer.y - pointTo.y * newScale,
    });
    this.stage.batchDraw();
    this.applyZoomVisuals(newScale);
  }

  /**
   * Зум двумя пальцами с сохранением точки сцены под серединой между ними —
   * как колесо держит точку под курсором. Середина при этом может ехать:
   * сцена следует за пальцами, так что жест сразу и масштабирует, и двигает.
   */
  private handlePinch(event: TouchEvent): void {
    if (event.touches.length < 2) {
      return;
    }
    event.preventDefault();
    const rect = this.stage.container().getBoundingClientRect();
    const [a, b] = [event.touches[0], event.touches[1]];
    const center = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    if (!this.pinch) {
      if (distance === 0) {
        return;
      }
      // Первый палец мог успеть начать протяжку стены или перетаскивание
      // сцены — жест двумя пальцами их отменяет, а не завершает.
      const wasDraggable = this.stage.draggable();
      if (this.stage.isDragging()) {
        this.stage.stopDrag();
      }
      this.stage.draggable(false);
      if (this.wallDrawStart) {
        this.clearWallDrawingVisuals();
      }
      this.hideDeskGhost();
      const scale = this.stage.scaleX();
      this.pinch = {
        distance,
        scale,
        pointTo: { x: (center.x - this.stage.x()) / scale, y: (center.y - this.stage.y()) / scale },
        wasDraggable,
      };
      this.structureLayer.batchDraw();
      return;
    }

    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.pinch.scale * (distance / this.pinch.distance)));
    this.stage.scale({ x: newScale, y: newScale });
    this.stage.position({
      x: center.x - this.pinch.pointTo.x * newScale,
      y: center.y - this.pinch.pointTo.y * newScale,
    });
    this.stage.batchDraw();
    this.applyZoomVisuals(newScale);
  }

  // Жест кончается, когда на экране остаётся меньше двух пальцев.
  private readonly handlePinchEnd = (event: TouchEvent): void => {
    if (this.pinch && event.touches.length < 2) {
      this.stage.draggable(this.pinch.wasDraggable);
      this.pinch = null;
    }
  };

  /** Видимость мелкой сетки и колбэк масштаба — общий хвост zoom-логики (колесо/сброс вида). */
  private applyZoomVisuals(scale: number): void {
    this.gridMinorRect?.visible(scale > GRID_MINOR_VISIBLE_ABOVE_SCALE);
    this.gridLayer.batchDraw();
    this.renderScaleDependentOverlays();
    this.deskSelection.setScale(scale);
    this.onScaleChange?.(scale);
  }

  /** Текущий масштаб сцены (1 = 100%). */
  getScale(): number {
    return this.stage.scaleX();
  }

  /** Вызывается сразу при подписке (с текущим масштабом) и далее при каждом зуме колесом. */
  setOnScaleChange(callback: (scale: number) => void): void {
    this.onScaleChange = callback;
    callback(this.stage.scaleX());
  }

  /**
   * Сброс вида: если на сцене есть стены/рабочие места — масштаб и позиция
   * подбираются так, чтобы их общий bounding box (через getClientRect,
   * уже в координатах сцены — relativeTo: stage убирает текущие pan/zoom)
   * поместился в экран с отступом VIEW_RESET_PADDING_PX по краям. Если
   * сцена пуста — минимальный вариант: scale 1, position {x:0, y:0}.
   */
  resetView(): void {
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    this.walls.forEach((wall) => rects.push(wall.line.getClientRect({ relativeTo: this.stage })));
    this.workspaces.forEach((workspace) =>
      rects.push(workspace.group.getClientRect({ relativeTo: this.stage })),
    );

    if (rects.length === 0) {
      this.stage.scale({ x: 1, y: 1 });
      this.stage.position({ x: 0, y: 0 });
      this.stage.batchDraw();
      this.applyZoomVisuals(1);
      return;
    }

    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.width));
    const maxY = Math.max(...rects.map((r) => r.y + r.height));
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const availableWidth = Math.max(1, this.stage.width() - VIEW_RESET_PADDING_PX * 2);
    const availableHeight = Math.max(1, this.stage.height() - VIEW_RESET_PADDING_PX * 2);

    const fitScale = Math.min(
      contentWidth > 0 ? availableWidth / contentWidth : MAX_ZOOM,
      contentHeight > 0 ? availableHeight / contentHeight : MAX_ZOOM,
    );
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitScale));

    const centerX = minX + contentWidth / 2;
    const centerY = minY + contentHeight / 2;

    this.stage.scale({ x: newScale, y: newScale });
    this.stage.position({
      x: this.stage.width() / 2 - centerX * newScale,
      y: this.stage.height() / 2 - centerY * newScale,
    });
    this.stage.batchDraw();
    this.applyZoomVisuals(newScale);
  }

  /**
   * Рисуется один раз при создании сцены — статичное поле ±GRID_HALF_EXTENT_PX
   * от начала координат, а не под текущий размер окна. Pan/zoom его не
   * перерисовывают: это просто содержимое слоя, к которому применяется общая
   * трансформация stage, как и ко всем остальным слоям.
   */
  private drawGrid(): void {
    const origin = -GRID_HALF_EXTENT_PX;
    const extent = GRID_HALF_EXTENT_PX;
    const size = extent - origin;

    this.gridMinorRect = new Konva.Rect({
      x: origin,
      y: origin,
      width: size,
      height: size,
      fillPatternImage: getGridTilePattern(),
      fillPatternRepeat: 'repeat',
      listening: false,
    });
    this.gridLayer.add(this.gridMinorRect);

    const majorSpacing = GRID_MINOR_SPACING_PX * GRID_MAJOR_EVERY;
    const segments: [number, number, number, number][] = [];
    for (let x = origin; x <= extent; x += majorSpacing) {
      segments.push([x, origin, x, extent]);
    }
    for (let y = origin; y <= extent; y += majorSpacing) {
      segments.push([origin, y, extent, y]);
    }
    // Одна фигура вместо ~200 Konva.Line: слой перерисовывается на каждый тик
    // зума, и обход сотен узлов дороже самих штрихов. Каждая линия — отдельный
    // путь со своим stroke, ровно как рисовал Konva.Line: цвет линии
    // полупрозрачный, и на пересечениях наложение должно остаться прежним.
    this.gridLayer.add(
      new Konva.Shape({
        stroke: palette().line,
        strokeWidth: 1,
        listening: false,
        sceneFunc: (context, shape) => {
          for (const [x1, y1, x2, y2] of segments) {
            context.beginPath();
            context.moveTo(x1, y1);
            context.lineTo(x2, y2);
            context.strokeShape(shape);
          }
        },
      }),
    );

    this.gridLayer.batchDraw();
  }

  /**
   * Возвращает применённое (обрезанное в допустимый диапазон) значение.
   * Всегда обновляет толщину, с которой начнётся СЛЕДУЮЩАЯ новая стена; если
   * при этом выделена существующая стена — меняет толщину и ей тоже (это и
   * есть единственный способ поменять толщину уже нарисованной стены в этой
   * модели: Transformer на полигон с митром больше не навешивается — тянуть
   * его за анкер значило бы искажать уже посчитанные вершины стыков).
   * Изменения при выделенной стене снимаются ОДНИМ Ctrl+Z на всю сессию
   * редактирования (см. selectedWallThicknessSnapshotTaken), а не по одному
   * на каждое нажатие клавиши в поле.
   */
  setWallThickness(thicknessCm: number): Cm {
    const clamped = cm(Math.min(MAX_WALL_THICKNESS_CM, Math.max(MIN_WALL_THICKNESS_CM, thicknessCm)));
    this.wallThicknessCm = clamped;

    const selectedWall = this.selectedId ? this.walls.get(this.selectedId) : undefined;
    if (selectedWall && selectedWall.thicknessCm !== clamped) {
      if (!this.selectedWallThicknessSnapshotTaken) {
        this.pushUndoSnapshot();
        this.selectedWallThicknessSnapshotTaken = true;
      }
      selectedWall.thicknessCm = clamped;
      this.rebuildWallGeometry();
    }

    return clamped;
  }

  getWallThickness(): Cm {
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

    // Konva закрашивает hit-canvas (то, по чему бьёт getIntersection при
    // клике) только внутри реального draw()/batchDraw(), с состоянием
    // listening на МОМЕНТ этого вызова — самого по себе изменения флага
    // недостаточно. Стена, добавленная во время рисования (когда
    // structureLayer.listening() был false), поэтому раньше могла остаться
    // недостижимой для клика после переключения в "Выбор": последняя
    // перерисовка слоя случилась ДО того, как он стал listening, и её hit-
    // canvas так и не узнал о новых фигурах. deselect() выше уже
    // перерисовывает mainLayer (mainLayer), поэтому у
    // рабочих мест этот баг не проявлялся — только у стен.
    this.structureLayer.batchDraw();

    // Панорамирование левой кнопкой по пустому месту — только в select:
    // Konva сама не отдаст жест stage, если mousedown пришёлся на объект
    // с собственной draggable=true (тот перетащится сам, а не сцена).
    this.stage.draggable(mode === 'select' || mode === 'view');

    this.stage.container().style.cursor = mode === 'draw-wall' || mode === 'place-desk' ? 'crosshair' : 'default';

    if (mode !== 'place-desk') {
      this.hideDeskGhost();
    }

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

  /**
   * Режим 'place-desk': клик ставит стол центром в точку курсора — движок
   * сообщает только место и поворот, данные стола (id, подпись) задаёт
   * вызывающий код и добавляет его через addWorkspace.
   */
  setOnDeskPlace(callback: (topLeftCm: { x: Cm; y: Cm }, rotation: number) => void): void {
    this.onDeskPlace = callback;
  }

  /** Клавиша R в режиме размещения — повернуть будущий стол на 90°. */
  rotateDeskGhost(): void {
    this.deskGhostRotation = (this.deskGhostRotation + 90) % 360;
    const pointer = this.stage.getRelativePointerPosition();
    if (pointer) this.updateDeskGhost(pointer);
  }

  /**
   * Левый верхний угол стола (начало координат Workspace, вокруг него же
   * поворот), при котором центр повёрнутого стола совпадает с точкой.
   */
  private deskTopLeftPx(centerPx: { x: number; y: number }): { x: number; y: number } {
    const w = cmToPx(DESK_PLACEMENT_SIZE_CM.width);
    const h = cmToPx(DESK_PLACEMENT_SIZE_CM.height);
    const rad = (this.deskGhostRotation * Math.PI) / 180;
    return {
      x: centerPx.x - ((w / 2) * Math.cos(rad) - (h / 2) * Math.sin(rad)),
      y: centerPx.y - ((w / 2) * Math.sin(rad) + (h / 2) * Math.cos(rad)),
    };
  }

  private updateDeskGhost(pointerPx: { x: number; y: number }): void {
    if (!this.deskGhost) {
      this.deskGhost = new Konva.Rect({
        width: cmToPx(DESK_PLACEMENT_SIZE_CM.width),
        height: cmToPx(DESK_PLACEMENT_SIZE_CM.height),
        strokeWidth: 2,
        dash: [6, 3],
        cornerRadius: palette().radiusMd,
        opacity: 0.8,
        listening: false,
      });
      this.mainLayer.add(this.deskGhost);
    }
    const topLeft = this.deskTopLeftPx(this.snapDeskCenter(pointerPx));
    const blocked = this.deskCollides(this.ghostCornersPx(topLeft));
    this.deskGhost.position(topLeft);
    this.deskGhost.rotation(this.deskGhostRotation);
    const ghostColor = blocked ? palette()['status-occupied'] : palette()['status-free'];
    this.deskGhost.fill(withAlpha(ghostColor, 0.2));
    this.deskGhost.stroke(ghostColor);
    this.deskGhost.visible(true);
    this.mainLayer.batchDraw();
  }

  /** Центр нового стола — к сетке 10 см (как DESK.SNAP_TO_GRID в workplace-map), если магниты включены. */
  private snapDeskCenter(pointerPx: { x: number; y: number }): { x: number; y: number } {
    if (!this.snapEnabled) return pointerPx;
    const step = cmToPx(DESK_GRID_SNAP_CM);
    return { x: Math.round(pointerPx.x / step) * step, y: Math.round(pointerPx.y / step) * step };
  }

  private ghostCornersPx(topLeft: { x: number; y: number }): DeskPoint[] {
    return rectCorners(
      topLeft,
      cmToPx(DESK_PLACEMENT_SIZE_CM.width),
      cmToPx(DESK_PLACEMENT_SIZE_CM.height),
      this.deskGhostRotation,
    );
  }

  /**
   * Перекрывает ли прямоугольник стола какую-нибудь стену или другой стол.
   * Стол ужимается на 1 px: вплотную к стене или к соседу ставить можно.
   */
  private deskCollides(cornersPx: readonly DeskPoint[], excludeWorkspaceId?: string): boolean {
    const desk = shrinkRect(cornersPx, 1);
    // Сначала дешёвая проверка охватывающих прямоугольников: точная
    // polygonsOverlap нужна лишь соседям — а зовётся это на каждый шаг протяжки стола.
    const deskBounds = boundsOf(desk);
    const overlaps = (polygon: readonly DeskPoint[]): boolean =>
      boundsMayOverlap(deskBounds, boundsOf(polygon)) && polygonsOverlap(desk, polygon);
    for (const wall of this.walls.values()) {
      if (overlaps(wall.getPolygon())) return true;
    }
    for (const [id, workspace] of this.workspaces) {
      if (id !== excludeWorkspaceId && overlaps(workspace.cornersPx())) return true;
    }
    return false;
  }

  private hideDeskGhost(): void {
    if (this.deskGhost?.visible()) {
      this.deskGhost.visible(false);
      this.mainLayer.batchDraw();
    }
  }

  private handleDeskPlaceClick(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    if (this.mode !== 'place-desk') return;
    if (event.evt instanceof MouseEvent && event.evt.button !== 0) return;
    const pointer = this.stage.getRelativePointerPosition();
    if (!pointer) return;
    const topLeft = this.deskTopLeftPx(this.snapDeskCenter(pointer));
    // На стену или другой стол не ставим — призрак в этот момент красный.
    if (this.deskCollides(this.ghostCornersPx(topLeft))) return;
    this.onDeskPlace?.({ x: pxToCm(topLeft.x), y: pxToCm(topLeft.y) }, this.deskGhostRotation);
  }

  /** Центр видимой части сцены, см — туда инструмент «Рабочее место» ставит новый стол. */
  getViewCenterCm(): { x: Cm; y: Cm } {
    const scale = this.stage.scaleX();
    return {
      x: pxToCm((this.stage.width() / 2 - this.stage.x()) / scale),
      y: pxToCm((this.stage.height() / 2 - this.stage.y()) / scale),
    };
  }

  /** Переключатель «Размеры» в тулбаре: подписи длин стен. */
  setShowDimensions(visible: boolean): void {
    this.dimensionLayer.visible(visible);
    this.dimensionLayer.batchDraw();
  }

  /** Переключатель «Магниты»: выключено — то же, что чертить с зажатым Shift. */
  setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
  }

  /** Снимает слушатели с window и уничтожает сцену — когда холст встроен в экран, который закрывают. */
  destroy(): void {
    window.removeEventListener('mouseup', this.handleWindowPointerUp);
    window.removeEventListener('touchend', this.handleWindowPointerUp);
    window.removeEventListener('touchend', this.handlePinchEnd);
    window.removeEventListener('touchcancel', this.handlePinchEnd);
    window.removeEventListener('mousemove', this.handlePanMove);
    window.removeEventListener('mouseup', this.handlePanEnd);
    this.resizeObserver.disconnect();
    this.unsubscribeTheme();
    this.stage.destroy();
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
    this.pushUndoSnapshot();

    const workspace = new Workspace(data, (selected) => this.selectWorkspace(selected));
    workspace.setDraggable(this.mode === 'select');
    // Как в CursorTool workplace-map: стол «упирается» в стену или соседа и
    // остаётся на последней свободной позиции, а не отскакивает после отпускания.
    let lastValid = workspace.group.position();
    workspace.group.on('dragstart', () => {
      this.pushUndoSnapshot();
      lastValid = workspace.group.position();
      if (this.deskSelection.selected !== workspace) this.selectWorkspace(workspace);
    });
    workspace.group.on('dragmove', () => {
      const target = workspace.group.position();
      // Идём от последней свободной точки к курсору мелкими шагами: при резком
      // рывке мыши иначе стол перепрыгнул бы тонкую стену за один dragmove.
      const steps = Math.max(1, Math.ceil(Math.hypot(target.x - lastValid.x, target.y - lastValid.y) / DESK_SWEEP_STEP_PX));
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        workspace.group.position({ x: lastValid.x + (target.x - lastValid.x) * t, y: lastValid.y + (target.y - lastValid.y) * t });
        if (this.deskCollides(workspace.cornersPx(), workspace.id)) {
          workspace.group.position({
            x: lastValid.x + (target.x - lastValid.x) * ((i - 1) / steps),
            y: lastValid.y + (target.y - lastValid.y) * ((i - 1) / steps),
          });
          break;
        }
      }
      lastValid = workspace.group.position();
      this.deskSelection.update();
    });
    this.mainLayer.add(workspace.group);
    this.workspaces.set(data.id, workspace);
    this.mainLayer.batchDraw();
    return workspace;
  }

  /** Поворот ручкой: на занятое место стол не встаёт — остаётся прежний угол. */
  private rotateDeskTo(workspace: Workspace, angleDeg: number): number {
    const start = workspace.group.rotation();
    // Кратчайшая дуга до нужного угла, по шагам — чтобы угол стола не «перескочил» соседа.
    const delta = ((((angleDeg - start) % 360) + 540) % 360) - 180;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / DESK_SWEEP_STEP_DEG));
    for (let i = 1; i <= steps; i += 1) {
      workspace.rotateAroundCenter(start + (delta * i) / steps);
      if (this.deskCollides(workspace.cornersPx(), workspace.id)) {
        workspace.rotateAroundCenter(start + (delta * (i - 1)) / steps);
        break;
      }
    }
    workspace.rotateAroundCenter(((workspace.group.rotation() % 360) + 360) % 360);
    this.mainLayer.batchDraw();
    return workspace.group.rotation();
  }

  /** Доводка к ближайшим 45° после отпускания ручки (при включённых магнитах), если там свободно. */
  private finishDeskRotation(workspace: Workspace): void {
    if (!this.snapEnabled) return;
    const snapped = (Math.round(workspace.group.rotation() / DESK_ROTATION_SNAP_DEG) * DESK_ROTATION_SNAP_DEG) % 360;
    this.rotateDeskTo(workspace, snapped);
  }

  private nodePointPx(nodeId: string): WallEndpoint {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Unknown wall node: ${nodeId}`);
    }
    return { x: cmToPx(node.x), y: cmToPx(node.y) };
  }

  private segmentGeometryPx(wall: Wall): {
    startPx: WallEndpoint;
    endPx: WallEndpoint;
    thicknessPx: number;
    rotation: number;
    lengthPx: number;
  } {
    const startPx = this.nodePointPx(wall.startNodeId);
    const endPx = this.nodePointPx(wall.endNodeId);
    const dx = endPx.x - startPx.x;
    const dy = endPx.y - startPx.y;
    return {
      startPx,
      endPx,
      thicknessPx: cmToPx(wall.thicknessCm),
      rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
      lengthPx: Math.hypot(dx, dy),
    };
  }

  /** Регистрирует узел графа без снимка в undo — снимок берёт на себя вызывающий (см. finishWallDraw/restore). */
  private registerWallNode(node: WallNode): void {
    this.nodes.set(node.id, node);
  }

  /**
   * Регистрирует сегмент, создаёт его Konva-представление. Полигон не
   * строится здесь же — точки известны только после rebuildWallGeometry
   * (нужна геометрия ВСЕХ сегментов в затронутых узлах, не только этого),
   * так что вызывающий обязан вызвать её сам следом. Без снимка в undo —
   * см. registerWallNode.
   */
  private registerWallSegment(segment: WallSegment): Wall {
    const wall = new Wall(segment, (selected) => this.selectWall(selected));
    wall.setDraggable(this.mode === 'select');
    wall.line.on('dragstart transformstart', () => {
      this.pushUndoSnapshot();
      // Ручки и кнопки стоят по старым координатам узлов, пока тело стены
      // едет — вернутся на место в rebuildWallGeometry после dragend.
      this.wallControls.hide();
      this.controlsLayer.batchDraw();
    });
    wall.line.on('dragend', () => this.handleWallDragEnd(wall));
    this.structureLayer.add(wall.line);
    this.dimensionLayer.add(wall.dimensionGroup);
    this.walls.set(segment.id, wall);
    return wall;
  }

  /**
   * Пересчитывает полигоны ВСЕХ стен из текущего графа узлов — источник
   * истины по геометрии стыков (смещённые грани + вершина угла как
   * пересечение граней смежных рёбер, см. utils/wallPolygon.ts), а не
   * накопленное состояние: узел сдвинулся — соседние стены при следующем
   * вызове просто получат новые точки как есть. Дёшево пересчитать всё
   * целиком, а не только затронутые узлы: даже на плане в несколько сотен
   * стен это O(рёбра), без ощутимой задержки на каждое действие.
   */
  private rebuildWallGeometry(): void {
    // Граф мог измениться (в том числе undo посреди протяжки) — ориентиры
    // текущей протяжки построятся заново при следующем alignWallEnd.
    this.wallDrawAlignLines = null;
    const raysByNode = new Map<string, NodeRay[]>();
    const pushRay = (nodeId: string, ray: NodeRay): void => {
      const existing = raysByNode.get(nodeId);
      if (existing) {
        existing.push(ray);
      } else {
        raysByNode.set(nodeId, [ray]);
      }
    };

    this.walls.forEach((wall) => {
      const startNode = this.nodes.get(wall.startNodeId);
      const endNode = this.nodes.get(wall.endNodeId);
      if (!startNode || !endNode) {
        return;
      }
      const startPx = { x: cmToPx(startNode.x), y: cmToPx(startNode.y) };
      const endPx = { x: cmToPx(endNode.x), y: cmToPx(endNode.y) };
      const dx = endPx.x - startPx.x;
      const dy = endPx.y - startPx.y;
      const length = Math.hypot(dx, dy) || 1;
      const dir = { x: dx / length, y: dy / length };
      const halfThickness = cmToPx(wall.thicknessCm) / 2;

      pushRay(wall.startNodeId, { key: `${wall.id}:start`, dir, halfThickness });
      pushRay(wall.endNodeId, {
        key: `${wall.id}:end`,
        dir: { x: -dir.x, y: -dir.y },
        halfThickness,
      });
    });

    const faceByRayKey = new Map<string, { left: WallEndpoint; right: WallEndpoint }>();
    // Готовится лениво: без свободных концов (замкнутый контур) не нужна вовсе.
    let abutmentWalls: PreparedAbutmentWall[] | null = null;
    raysByNode.forEach((rays, nodeId) => {
      const node = this.nodes.get(nodeId);
      if (!node) {
        return;
      }
      const nodePx = { x: cmToPx(node.x), y: cmToPx(node.y) };
      let abutment: FaceLine | undefined;
      if (rays.length === 1) {
        abutmentWalls ??= this.prepareAbutmentWalls();
        abutment = this.findAbutmentFacePx(nodeId, nodePx, abutmentWalls);
      }
      computeNodeFaceVertices(nodePx, rays, abutment).forEach((face, key) => faceByRayKey.set(key, face));
    });

    this.walls.forEach((wall) => {
      const startFace = faceByRayKey.get(`${wall.id}:start`);
      const endFace = faceByRayKey.get(`${wall.id}:end`);
      if (!startFace || !endFace) {
        return;
      }
      wall.render(
        buildSegmentPolygon(startFace, endFace),
        this.nodePointPx(wall.startNodeId),
        this.nodePointPx(wall.endNodeId),
      );
    });

    this.structureLayer.batchDraw();
    this.renderWallOverlays();
  }

  /**
   * Грань чужой стены, на которой лежит свободный узел (конец, привязанный
   * к грани при рисовании, см. WallSnap 'face'), — по её линии обрезается
   * торец (см. computeNodeFaceVertices).
   */
  private findAbutmentFacePx(
    nodeId: string,
    nodePx: WallEndpoint,
    prepared: readonly PreparedAbutmentWall[],
  ): FaceLine | undefined {
    return findAbutmentFace(nodeId, nodePx, prepared, RAY_START_EPSILON_PX);
  }

  /**
   * Геометрия всех стен для findAbutmentFacePx — один раз на проход по узлам,
   * а не заново для каждого свободного конца (rebuildWallGeometry зовётся на
   * каждый mousemove при перетаскивании ручки).
   */
  private prepareAbutmentWalls(): PreparedAbutmentWall[] {
    const inputs: AbutmentWallInput[] = [];
    this.walls.forEach((wall) => {
      inputs.push({
        startNodeId: wall.startNodeId,
        endNodeId: wall.endNodeId,
        startPx: this.nodePointPx(wall.startNodeId),
        endPx: this.nodePointPx(wall.endNodeId),
        thicknessPx: cmToPx(wall.thicknessCm),
      });
    });
    return prepareAbutmentWalls(inputs, RAY_START_EPSILON_PX);
  }

  /**
   * Всё, что рисуется поверх стен и зависит от масштаба: размеры по граням,
   * ручки/кнопки выделенной стены. Плюс тулбар узнаёт новые длину/толщину
   * выделенной стены — геометрия только что могла поменяться.
   */
  /** Смена темы (или загрузка шрифта): всё, что нарисовано цветами токенов, перекрашивается. */
  private applyTheme(): void {
    this.gridLayer.destroyChildren();
    this.drawGrid();
    this.gridMinorRect?.visible(this.stage.scaleX() > GRID_MINOR_VISIBLE_ABOVE_SCALE);
    this.walls.forEach((wall) => wall.applyTheme());
    this.workspaces.forEach((workspace) => workspace.applyTheme());
    this.wallControls.applyTheme();
    this.deskSelection.update();
    this.deskGhost?.destroy();
    this.deskGhost = null;
    // Заливка и шрифт подписей помещений — из токенов темы: пересоздать, даже
    // если сами помещения не изменились.
    this.renderedRooms = null;
    this.renderWallOverlays();
    this.stage.batchDraw();
  }

  private renderWallOverlays(): void {
    this.renderScaleDependentOverlays();
    this.emitSelectionChange();
  }

  /**
   * Та часть renderWallOverlays, что зависит от масштаба. Зум зовёт только её:
   * длина и толщина выделенной стены от масштаба не меняются, и сообщать
   * тулбару о «новом» выделении на каждый тик колеса незачем.
   */
  private renderScaleDependentOverlays(): void {
    const scale = this.stage.scaleX();
    this.walls.forEach((wall) => wall.renderDimensions(scale));
    this.renderRooms(scale);
    this.dimensionLayer.batchDraw();
    this.updateWallControls();
  }

  private get selectedWall(): Wall | undefined {
    return this.selectedId ? this.walls.get(this.selectedId) : undefined;
  }

  private updateWallControls(): void {
    const wall = this.selectedWall;
    if (!wall || this.mode !== 'select') {
      this.wallControls.hide();
    } else {
      const { startPx, endPx, thicknessPx } = this.segmentGeometryPx(wall);
      this.wallControls.show(startPx, endPx, thicknessPx, this.stage.scaleX());
    }
    this.controlsLayer.batchDraw();
  }

  /** Подписка тулбара на выделение стены: null — выделена не стена или ничего. Вызывается сразу с текущим состоянием. */
  setOnSelectionChange(callback: (wall: SelectedWallInfo | null) => void): void {
    this.onSelectionChange = callback;
    // Новый подписчик получает текущее состояние, даже если оно уже отправлялось прежнему.
    this.selectionChangeGate.reset();
    this.emitSelectionChange();
  }

  /**
   * Сообщает тулбару выделение, только если изменилось отправляемое значение
   * или то, что панель настроек читает у холста сама (режим, id выделения —
   * стол тоже, толщина новой стены): повтор с теми же данными перерисовал бы
   * панель теми же значениями.
   */
  private emitSelectionChange(): void {
    if (!this.onSelectionChange) {
      return;
    }
    const wall = this.selectedWall;
    const info: SelectedWallInfo | null = wall
      ? { lengthCm: pxToCm(this.segmentGeometryPx(wall).lengthPx), thicknessCm: wall.thicknessCm }
      : null;
    const key = `${this.mode}|${this.selectedId ?? ''}|${this.wallThicknessCm}|${
      info ? `${info.lengthCm}:${info.thicknessCm}` : '-'
    }`;
    if (this.selectionChangeGate(key)) {
      this.onSelectionChange(info);
    }
  }

  /** Сколько стен сходится в каждом узле. */
  private nodeDegrees(): Map<string, number> {
    const degrees = new Map<string, number>();
    this.walls.forEach((wall) => {
      degrees.set(wall.startNodeId, (degrees.get(wall.startNodeId) ?? 0) + 1);
      degrees.set(wall.endNodeId, (degrees.get(wall.endNodeId) ?? 0) + 1);
    });
    return degrees;
  }

  /**
   * Точная длина выделенной стены по оси. Двигается тот конец, к которому
   * примыкает меньше стен (обычно свободный), — так ввод длины меньше всего
   * тянет за собой соседей; при равенстве двигается конец стены. Возвращает
   * применённое значение или null, если стена не выделена.
   */
  setSelectedWallLength(lengthCm: number): Cm | null {
    const wall = this.selectedWall;
    if (!wall || !Number.isFinite(lengthCm)) {
      return null;
    }
    const clamped = cm(Math.min(MAX_WALL_LENGTH_CM, Math.max(WALL_DRAW_MIN_LENGTH_CM, lengthCm)));
    const degrees = this.nodeDegrees();
    const moveEnd = (degrees.get(wall.endNodeId) ?? 0) <= (degrees.get(wall.startNodeId) ?? 0);
    const fixedId = moveEnd ? wall.startNodeId : wall.endNodeId;
    const movingId = moveEnd ? wall.endNodeId : wall.startNodeId;
    const movingNode = this.nodes.get(movingId);
    const target = pointAtDistance(this.nodePointPx(fixedId), this.nodePointPx(movingId), cmToPx(clamped));
    if (!movingNode || !target) {
      return null;
    }

    this.pushUndoSnapshot();
    movingNode.x = pxToCm(target.x);
    movingNode.y = pxToCm(target.y);
    this.rebuildWallGeometry();
    return clamped;
  }

  /**
   * Толщина выделенной стены меняется только со стороны side: противоположная
   * грань остаётся на месте, ось (оба узла) сдвигается на половину разницы
   * (см. shiftAxisForOneSidedThickness). Узлы общие, поэтому примыкающие стены
   * удлиняются/укорачиваются вслед за этим, как у RemPlanner. Толщина по
   * умолчанию для новых стен при этом не меняется.
   */
  private stepSelectedWallThickness(side: WallSide, deltaCm: number): void {
    const wall = this.selectedWall;
    if (!wall) {
      return;
    }
    const newThickness = cm(
      Math.min(MAX_WALL_THICKNESS_CM, Math.max(MIN_WALL_THICKNESS_CM, wall.thicknessCm + deltaCm)),
    );
    const startNode = this.nodes.get(wall.startNodeId);
    const endNode = this.nodes.get(wall.endNodeId);
    if (newThickness === wall.thicknessCm || !startNode || !endNode) {
      return;
    }

    this.pushUndoSnapshot();
    const shifted = shiftAxisForOneSidedThickness(startNode, endNode, wall.thicknessCm, newThickness, side);
    startNode.x = cm(shifted.start.x);
    startNode.y = cm(shifted.start.y);
    endNode.x = cm(shifted.end.x);
    endNode.y = cm(shifted.end.y);
    wall.thicknessCm = newThickness;
    this.rebuildWallGeometry();
  }

  private wallEndNodeId(end: WallEnd): string | null {
    const wall = this.selectedWall;
    if (!wall) {
      return null;
    }
    return end === 'start' ? wall.startNodeId : wall.endNodeId;
  }

  private handleWallEndDragStart(end: WallEnd): void {
    const nodeId = this.wallEndNodeId(end);
    if (!nodeId) {
      return;
    }
    this.pushUndoSnapshot();
    this.handleDrag = { nodeId, mergeTargetNodeId: null, ...this.handleDragLinks(nodeId) };
  }

  /**
   * Узлы, уже соединённые с этим одной стеной, в слияние не берём — иначе
   * стена между ними схлопнулась бы в точку. Стены, делящие узел, едут
   * вместе с ним — для привязок и столкновений они не в счёт.
   */
  private handleDragLinks(nodeId: string): { adjacentNodeIds: Set<string>; sharingWallIds: Set<string> } {
    const adjacentNodeIds = new Set<string>([nodeId]);
    const sharingWallIds = new Set<string>();
    this.walls.forEach((other) => {
      if (other.startNodeId === nodeId) adjacentNodeIds.add(other.endNodeId);
      if (other.endNodeId === nodeId) adjacentNodeIds.add(other.startNodeId);
      if (other.startNodeId === nodeId || other.endNodeId === nodeId) sharingWallIds.add(other.id);
    });
    return { adjacentNodeIds, sharingWallIds };
  }

  /**
   * Ручка конца двигает узел графа целиком — вместе с ним и все стены, что
   * его делят. Привязки те же, что при рисовании: к чужому узлу (тогда при
   * отпускании узлы сливаются в один угол) или к направляющим через 45° от
   * другого конца этой стены; Shift отключает направляющие.
   */
  private handleWallEndDragMove(end: WallEnd, pos: WallEndpoint, shiftKey: boolean): WallEndpoint {
    const wall = this.selectedWall;
    const drag = this.handleDrag;
    const node = drag ? this.nodes.get(drag.nodeId) : undefined;
    if (!wall || !drag || !node) {
      return pos;
    }

    const adjacent = drag.adjacentNodeIds;

    let target = pos;
    let guideSnapped = false;
    let mergeTargetNodeId: string | null = null;
    let bestDist = this.snapRadiusPx;
    this.nodes.forEach((candidate, id) => {
      if (adjacent.has(id)) {
        return;
      }
      const point = { x: cmToPx(candidate.x), y: cmToPx(candidate.y) };
      const dist = Math.hypot(pos.x - point.x, pos.y - point.y);
      if (dist <= bestDist) {
        bestDist = dist;
        target = point;
        mergeTargetNodeId = id;
      }
    });

    if (!mergeTargetNodeId && !shiftKey && this.snapEnabled) {
      const anchor = this.nodePointPx(end === 'start' ? wall.endNodeId : wall.startNodeId);
      const dx = pos.x - anchor.x;
      const dy = pos.y - anchor.y;
      const guideDeg = findSnappedGuideLineDeg(dx, dy, cmToPx(GUIDE_SNAP_TOLERANCE_CM));
      if (guideDeg !== null) {
        const rad = (guideDeg * Math.PI) / 180;
        const along = dx * Math.cos(rad) + dy * Math.sin(rad);
        target = { x: anchor.x + Math.cos(rad) * along, y: anchor.y + Math.sin(rad) * along };
        guideSnapped = true;
      }
    }

    if (!mergeTargetNodeId) {
      target = this.constrainHandleTarget(
        drag.sharingWallIds,
        end === 'start' ? wall.endNodeId : wall.startNodeId,
        pos,
        target,
        guideSnapped,
      );
    }

    drag.mergeTargetNodeId = mergeTargetNodeId;
    node.x = pxToCm(target.x);
    node.y = pxToCm(target.y);
    this.rebuildWallGeometry();
    return target;
  }

  /**
   * Конец стены при правке ведёт себя как при рисовании: магнитится к грани/
   * оси чужой стены (если не держит направляющую) и не проходит сквозь стены
   * — упирается в первую на пути от противоположного конца. Стены, делящие
   * двигаемый узел, не в счёт: они едут вместе с ним.
   */
  private constrainHandleTarget(
    exclude: ReadonlySet<string>,
    anchorNodeId: string,
    pos: WallEndpoint,
    target: WallEndpoint,
    guideSnapped: boolean,
  ): WallEndpoint {
    let result = target;
    if (!guideSnapped) {
      const snap = this.findWallSnapPx(pos, exclude);
      if (snap && snap.kind !== 'corner') {
        result = snap.point;
      }
    }
    const anchor = this.nodePointPx(anchorNodeId);
    const dx = result.x - anchor.x;
    const dy = result.y - anchor.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      return result;
    }
    const hitT = this.findFirstWallCollisionTPx(anchor, dx / length, dy / length, length, exclude);
    if (hitT !== null && hitT > 0 && hitT < length) {
      return { x: anchor.x + (dx / length) * hitT, y: anchor.y + (dy / length) * hitT };
    }
    return result;
  }

  private handleWallEndDragEnd(): void {
    const drag = this.handleDrag;
    this.handleDrag = null;
    if (drag?.mergeTargetNodeId) {
      this.mergeNodes(drag.nodeId, drag.mergeTargetNodeId);
    } else if (drag) {
      this.joinAbuttingFreeEnds();
    }
  }

  /**
   * Сливает узел fromId в intoId: все стены, ссылавшиеся на fromId, теперь
   * сходятся в intoId — получается обычный общий угол графа. Стены,
   * схлопнувшиеся в точку, и дубликаты (две стены между одной парой узлов)
   * выбрасываются. Перестраивается через restore — тем же путём, что undo;
   * снимок для отмены уже сделан в начале перетаскивания.
   */
  private mergeNodes(fromId: string, intoId: string): void {
    const data = this.serialize();
    const seenPairs = new Set<string>();
    const segments = data.segments
      .map((segment) => ({
        ...segment,
        startNodeId: segment.startNodeId === fromId ? intoId : segment.startNodeId,
        endNodeId: segment.endNodeId === fromId ? intoId : segment.endNodeId,
      }))
      .filter((segment) => {
        if (segment.startNodeId === segment.endNodeId) {
          return false;
        }
        const pair = [segment.startNodeId, segment.endNodeId].sort().join('|');
        if (seenPairs.has(pair)) {
          return false;
        }
        seenPairs.add(pair);
        return true;
      });

    const selectedId = this.selectedId;
    this.restore({ ...data, nodes: data.nodes.filter((node) => node.id !== fromId), segments });
    const wall = selectedId ? this.walls.get(selectedId) : undefined;
    if (wall) {
      this.selectWall(wall);
    }
  }

  /**
   * Перетаскивание тела стены двигает ОБА её узла на одну и ту же дельту —
   * и, следовательно, автоматически тянет за собой любую другую стену,
   * которая делит с этой один из узлов (угол остаётся сомкнутым без
   * отдельного пересчёта стыков, только полный пересчёт геометрии). Дельта
   * — это то, куда Konva уже сдвинул сам Line при перетаскивании: точки
   * полигона (points) при drag не меняются, меняются только x/y самой
   * фигуры, так что после жеста x/y и есть дельта в px, а не отдельная
   * позиция, которую пришлось бы сравнивать с координатами узла.
   */
  private handleWallDragEnd(wall: Wall): void {
    const deltaPxX = wall.line.x();
    const deltaPxY = wall.line.y();
    if (deltaPxX === 0 && deltaPxY === 0) {
      return;
    }
    wall.line.position({ x: 0, y: 0 });

    const startNode = this.nodes.get(wall.startNodeId);
    const endNode = this.nodes.get(wall.endNodeId);
    if (!startNode || !endNode) {
      return;
    }

    const deltaXCm = pxToCm(deltaPxX);
    const deltaYCm = pxToCm(deltaPxY);
    startNode.x = cm(startNode.x + deltaXCm);
    startNode.y = cm(startNode.y + deltaYCm);
    endNode.x = cm(endNode.x + deltaXCm);
    endNode.y = cm(endNode.y + deltaYCm);

    this.rebuildWallGeometry();
  }

  /**
   * Завершает рисование новой стены: узел на конце, примагниченном к
   * существующему углу (snap.kind === 'corner'), — это ТОТ ЖЕ узел (тот же
   * id), а не новый с совпадающими координатами; конец, примагниченный
   * ТОЧНО к оси существующей стены (snap.kind === 'axis'), разбивает эту
   * стену узлом (см. splitWallAtPoint) — T-стык становится обычным узлом с
   * тремя рёбрами; конец рядом с гранью стены (snap.kind === 'face') и
   * остальные концы получают свежий несвязанный узел в точке, где
   * остановилась протяжка (для 'face' — ровно на грани, стена не
   * разбивается).
   */
  private finishWallDraw(
    startPointPx: WallEndpoint,
    endPointPx: WallEndpoint,
    startSnap: WallSnap | null,
    endSnap: WallSnap | null,
    thicknessCm: Cm,
  ): Wall {
    this.pushUndoSnapshot();

    const startNodeId = this.resolveDrawEndpointNodeId(startSnap, startPointPx);
    const endNodeId = this.resolveDrawEndpointNodeId(endSnap, endPointPx);

    const wall = this.registerWallSegment({
      id: generateId('wall'),
      startNodeId,
      endNodeId,
      thickness: thicknessCm,
    });
    this.rebuildWallGeometry();
    this.joinAbuttingFreeEnds();
    return this.walls.get(wall.id) ?? wall;
  }

  /**
   * Свободный конец, упёршийся в грань другой стены у её свободного торца
   * (ближе чем толщина обеих стен), — это угол, а не T-стык: узел сливается с
   * торцом хозяина, и стены получают общий узел с обычным миттером. Дальше от
   * торца упор остаётся T-примыканием.
   */
  private joinAbuttingFreeEnds(): void {
    const degrees = this.nodeDegrees();
    for (const [nodeId, node] of this.nodes) {
      if (degrees.get(nodeId) !== 1) {
        continue;
      }
      const own = [...this.walls.values()].find((w) => w.startNodeId === nodeId || w.endNodeId === nodeId);
      if (!own) {
        continue;
      }
      const otherId = own.startNodeId === nodeId ? own.endNodeId : own.startNodeId;
      const nodePx = { x: cmToPx(node.x), y: cmToPx(node.y) };
      const otherPx = this.nodePointPx(otherId);
      const ownDir = { x: nodePx.x - otherPx.x, y: nodePx.y - otherPx.y };
      const reach = (thicknessPx: number): number => cmToPx(own.thicknessCm) / 2 + thicknessPx / 2;
      for (const host of this.walls.values()) {
        if (host.startNodeId === nodeId || host.endNodeId === nodeId) {
          continue;
        }
        const { startPx, endPx, thicknessPx } = this.segmentGeometryPx(host);
        const hostDir = { x: endPx.x - startPx.x, y: endPx.y - startPx.y };
        const cross = ownDir.x * hostDir.y - ownDir.y * hostDir.x;
        if (Math.abs(cross) < 1e-6) {
          continue;
        }
        // Пересечение осей — будущий угол; сдвиг каждой стены идёт только вдоль
        // её же оси, поэтому направления не перекашиваются.
        const t = ((startPx.x - otherPx.x) * hostDir.y - (startPx.y - otherPx.y) * hostDir.x) / cross;
        const corner = { x: otherPx.x + ownDir.x * t, y: otherPx.y + ownDir.y * t };
        const limit = reach(thicknessPx);
        if (Math.hypot(corner.x - nodePx.x, corner.y - nodePx.y) > limit * 2) {
          continue;
        }
        const target = [host.startNodeId, host.endNodeId].find((id) => {
          const hostNode = this.nodes.get(id);
          return (
            degrees.get(id) === 1 &&
            hostNode !== undefined &&
            Math.hypot(corner.x - cmToPx(hostNode.x), corner.y - cmToPx(hostNode.y)) <= limit
          );
        });
        const targetNode = target ? this.nodes.get(target) : undefined;
        if (target && targetNode) {
          targetNode.x = pxToCm(corner.x);
          targetNode.y = pxToCm(corner.y);
          this.mergeNodes(nodeId, target);
          return;
        }
      }
    }
  }

  /** Узел для одного конца рисуемой стены — см. варианты в finishWallDraw. */
  private resolveDrawEndpointNodeId(snap: WallSnap | null, pointPx: WallEndpoint): string {
    if (snap?.kind === 'corner') {
      return snap.nodeId;
    }
    if (snap?.kind === 'axis') {
      return this.splitWallAtPoint(snap.wallId, snap.point);
    }
    return this.createNodeAt(pointPx);
  }

  /**
   * T-примыкание: разбивает существующее ребро узлом в точке на его оси —
   * вместо одного ребра получаются два коллинеарных плюс третье (та новая
   * стена, чей конец сюда примагнитился). T-стык становится обычным узлом
   * с тремя рёбрами — никакой отдельной логики "войти в тело стены на
   * полтолщины" не нужно, T-грань получается сама из вершин угла (см.
   * utils/wallPolygon.ts, случай "три и более рёбер"). Возвращает id
   * нового узла.
   */
  private splitWallAtPoint(wallId: string, axisPointPx: WallEndpoint): string {
    const wall = this.walls.get(wallId);
    if (!wall) {
      // Стена уже не существует — например, оба конца новой стены попали
      // на одну и ту же сквозную стену, и первый вызов её уже разбил на
      // два новых сегмента с другими id. Не падаем: просто ставим обычный
      // несвязанный узел в этой точке (редкий случай, вручную не тестируется).
      return this.createNodeAt(axisPointPx);
    }

    const { startNodeId, endNodeId, thicknessCm } = wall;
    const newNodeId = this.createNodeAt(axisPointPx);

    wall.destroy();
    this.walls.delete(wallId);

    this.registerWallSegment({
      id: generateId('wall'),
      startNodeId,
      endNodeId: newNodeId,
      thickness: thicknessCm,
    });
    this.registerWallSegment({
      id: generateId('wall'),
      startNodeId: newNodeId,
      endNodeId,
      thickness: thicknessCm,
    });

    return newNodeId;
  }

  private createNodeAt(pointPx: WallEndpoint): string {
    const id = generateId('node');
    this.registerWallNode({ id, x: pxToCm(pointPx.x), y: pxToCm(pointPx.y) });
    return id;
  }

  /**
   * Радиусы/длины привязки и служебной графики заданы константами в
   * ЭКРАННЫХ пикселях (сколько это должно занимать на экране визуально),
   * но сравниваются с расстояниями в координатах СЦЕНЫ (где лежат стены).
   * При масштабе stage, отличном от 1, эти две системы расходятся: радиус
   * 24 при масштабе 0.2 — это всего 4.8 экранных пикселя (магнетизм кажется
   * сломанным), а при масштабе 4 — уже 96 (цепляет всё подряд). Деление на
   * stage.scaleX() возвращает константе её исходный, постоянный на экране
   * смысл независимо от текущего зума.
   */
  private get snapRadiusPx(): number {
    return WALL_JOINT_SNAP_RADIUS_PX / this.stage.scaleX();
  }

  private get axisSnapRadiusPx(): number {
    return WALL_AXIS_SNAP_RADIUS_PX / this.stage.scaleX();
  }

  private get collisionIgnoreRadiusPx(): number {
    return WALL_COLLISION_IGNORE_RADIUS_PX / this.stage.scaleX();
  }

  private get snapIndicatorRadiusPx(): number {
    return SNAP_INDICATOR_RADIUS_PX / this.stage.scaleX();
  }

  private get dimensionLabelGapPx(): number {
    return DIMENSION_LABEL_GAP_PX / this.stage.scaleX();
  }

  /**
   * Привязка точки к уже существующей геометрии — призрак и точка старта/
   * конца стены ведут себя как физический объект: не заходят внутрь тела
   * чужой стены, а садятся на её грань, — и только точное наведение в
   * центр тела стены (в пределах axisSnapRadiusPx, заметно уже общего
   * snapRadiusPx) даёт "ось" и намерение её разбить:
   *  - "corner" — курсор рядом с УЗЛОМ графа (любым, вне зависимости от
   *    того, сколько сегментов на него ссылается) — примагничивание к узлу,
   *    а не к псевдо-углу, выведенному из прямоугольника стены, и есть тот
   *    механизм, который заставляет новую стену РАЗДЕЛИТЬ существующую
   *    вершину, а не создать рядом другую с теми же координатами;
   *  - "axis" — курсор целится почти точно в ОСЬ стены (не просто где-то
   *    рядом с ней), в её пролёте, не у самых торцов — намерение "врезать"
   *    новую стену в существующую. Результат — точка на оси; она и станет
   *    новым узлом, разбивающим ребро на два коллинеарных плюс примыкающее
   *    (T-стык, см. splitWallAtPoint);
   *  - "face" — курсор рядом с боковой гранью стены (в т.ч. если формально
   *    находится НАД её телом, но не точно на оси) — результат точка на
   *    ближайшей грани, со стороны курсора; здесь стена не разбивается,
   *    новый узел просто ставится рядом, как самостоятельный.
   * Побеждает ближайшая по расстоянию цель среди всех типов.
   */
  private findWallSnapPx(pos: WallEndpoint, exclude?: ReadonlySet<string>): WallSnap | null {
    if (!this.snapEnabled) {
      return null;
    }
    const snapRadiusPx = this.snapRadiusPx;
    const axisSnapRadiusPx = this.axisSnapRadiusPx;
    let bestDist = snapRadiusPx;
    let best: WallSnap | null = null;

    for (const [nodeId, node] of this.nodes) {
      const nodePx = { x: cmToPx(node.x), y: cmToPx(node.y) };
      const dist = Math.hypot(pos.x - nodePx.x, pos.y - nodePx.y);
      if (dist <= bestDist) {
        bestDist = dist;
        best = { kind: 'corner', point: nodePx, nodeId };
      }
    }

    for (const wall of this.walls.values()) {
      if (exclude?.has(wall.id)) {
        continue;
      }
      const { startPx, thicknessPx, rotation, lengthPx } = this.segmentGeometryPx(wall);
      const rad = (rotation * Math.PI) / 180;
      const dirX = Math.cos(rad);
      const dirY = Math.sin(rad);
      const perpX = -Math.sin(rad);
      const perpY = Math.cos(rad);
      const halfPx = thicknessPx / 2;

      const t = (pos.x - startPx.x) * dirX + (pos.y - startPx.y) * dirY;
      if (t < snapRadiusPx || t > lengthPx - snapRadiusPx) {
        continue;
      }

      const distPerp = (pos.x - startPx.x) * perpX + (pos.y - startPx.y) * perpY;

      if (Math.abs(distPerp) <= axisSnapRadiusPx) {
        const axisPoint = { x: startPx.x + dirX * t, y: startPx.y + dirY * t };
        const dist = Math.abs(distPerp);
        if (dist <= bestDist) {
          bestDist = dist;
          best = { kind: 'axis', point: axisPoint, wallId: wall.id };
        }
        continue;
      }

      const faceSign = distPerp >= 0 ? 1 : -1;
      const facePoint = {
        x: startPx.x + dirX * t + perpX * halfPx * faceSign,
        y: startPx.y + dirY * t + perpY * halfPx * faceSign,
      };
      const faceDist = Math.hypot(pos.x - facePoint.x, pos.y - facePoint.y);
      if (faceDist <= bestDist) {
        bestDist = faceDist;
        best = { kind: 'face', point: facePoint };
      }
    }

    return best;
  }

  /**
   * Свободные концы (степень 1), не приставленные к чужой грани, — от них
   * можно продолжить стену. Поиск примыкания перебирает все стены для
   * каждого конца (O(узлы·стены)), а findWallStartSnapPx зовётся на каждый
   * mousemove, пока граф не меняется, — поэтому результат кэшируется по
   * отпечатку графа (координаты узлов, концы и толщины рёбер).
   */
  private continuableFreeEnds(): ReadonlySet<string> {
    const key = wallGraphKey(this.nodes.values(), this.wallKeyEdges());
    return this.continuableFreeEndsMemo(key, () => {
      const degrees = this.nodeDegrees();
      const result = new Set<string>();
      let abutmentWalls: PreparedAbutmentWall[] | null = null;
      for (const [nodeId, node] of this.nodes) {
        if (degrees.get(nodeId) !== 1) {
          continue;
        }
        abutmentWalls ??= this.prepareAbutmentWalls();
        if (!this.findAbutmentFacePx(nodeId, { x: cmToPx(node.x), y: cmToPx(node.y) }, abutmentWalls)) {
          result.add(nodeId);
        }
      }
      return result;
    });
  }

  private *wallKeyEdges(): Generator<{ startNodeId: string; endNodeId: string; thickness: number }> {
    for (const wall of this.walls.values()) {
      yield { startNodeId: wall.startNodeId, endNodeId: wall.endNodeId, thickness: wall.thicknessCm };
    }
  }

  /** Стены как тела для привязки старта к граням — ось, полутолщина и готовый полигон. */
  private wallBodies(): WallBody[] {
    const bodies: WallBody[] = [];
    this.walls.forEach((wall) => {
      const polygon = wall.getPolygon();
      if (polygon.length !== 4) {
        return;
      }
      const { startPx, endPx, thicknessPx } = this.segmentGeometryPx(wall);
      bodies.push({
        id: wall.id,
        start: startPx,
        end: endPx,
        halfThickness: thicknessPx / 2,
        polygon,
      });
    });
    return bodies;
  }

  /**
   * Привязка НАЧАЛА стены (и призрака до нажатия) — как у RemPlanner, призрак
   * никогда не входит в тело чужой стены: рядом со свободным концом (в радиусе
   * привязки) стена продолжит его — начнётся в этом узле; иначе, если курсор над стеной или у её грани,
   * призрак прилегает к грани снаружи (см. findFaceHug), а стена начнётся в
   * точке контакта на грани — без разбиения стены-хозяина, торец обрежется
   * по грани (findAbutmentFacePx). Старт по оси больше не делается: в тело
   * стены призрак не заходит.
   */
  private findWallStartSnapPx(pos: WallEndpoint): WallStartHit {
    let corner: WallSnap | null = null;
    let bestDist = this.snapRadiusPx;
    const continuable = this.continuableFreeEnds();
    for (const [nodeId, node] of this.nodes) {
      // Продолжить можно только свободный конец: в узле, где уже сходятся
      // несколько стен, или в основании стены, приставленной к чужой грани,
      // призрак по центру узла сидел бы наполовину в теле стены — там
      // стена стартует от грани (findFaceHug).
      if (!continuable.has(nodeId)) {
        continue;
      }
      const nodePx = { x: cmToPx(node.x), y: cmToPx(node.y) };
      const dist = Math.hypot(pos.x - nodePx.x, pos.y - nodePx.y);
      if (dist <= bestDist) {
        bestDist = dist;
        corner = { kind: 'corner', point: nodePx, nodeId };
      }
    }
    if (corner && corner.kind === 'corner') {
      return {
        snap: corner,
        ghostCenter: corner.point,
        ghostRotationDeg: 0,
        face: null,
        endSector: this.endSectorAt(corner.nodeId),
      };
    }

    const halfPx = cmToPx(this.wallThicknessCm) / 2;
    const hug = findFaceHug(pos, this.wallBodies(), halfPx, 2 * halfPx + cmToPx(FACE_HUG_EXTRA_CM));
    if (hug) {
      return {
        snap: { kind: 'face', point: hug.contact },
        ghostCenter: hug.ghostCenter,
        ghostRotationDeg: (Math.atan2(hug.tangent.y, hug.tangent.x) * 180) / Math.PI,
        face: hug,
        endSector: null,
      };
    }
    return { snap: null, ghostCenter: pos, ghostRotationDeg: 0, face: null, endSector: null };
  }

  /**
   * Направление продолжения свободного конца: от второго узла единственной
   * стены к этому, единичный вектор — и перпендикуляр к нему. null, если
   * стена вырождена (узлы совпадают).
   */
  private endSectorAt(nodeId: string): WallStartHit['endSector'] {
    for (const wall of this.walls.values()) {
      if (wall.startNodeId !== nodeId && wall.endNodeId !== nodeId) {
        continue;
      }
      const otherId = wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId;
      const nodePx = this.nodePointPx(nodeId);
      const otherPx = this.nodePointPx(otherId);
      const length = Math.hypot(nodePx.x - otherPx.x, nodePx.y - otherPx.y);
      if (length === 0) {
        return null;
      }
      const forward = { x: (nodePx.x - otherPx.x) / length, y: (nodePx.y - otherPx.y) / length };
      return { forward, side: { x: -forward.y, y: forward.x } };
    }
    return null;
  }

  /**
   * Кратчайшее расстояние (px) от start вдоль направления (dirX, dirY) до
   * границы любой уже существующей стены, не дальше maxLengthPx. Не даёт
   * новой стене пройти сквозь/поверх уже нарисованной — она физически
   * останавливается на первом препятствии, как и полагается прямоугольнику,
   * а не абстрактной линии. Столкновения у самого начала и у самого конца
   * отрезка (в пределах intended-длины) игнорируются — это, как правило,
   * стена, от которой мы уже оттолкнулись при старте, либо законная точка
   * примыкания в конце.
   *
   * Стена, внутри тела которой начинается луч (старт в её узле или на её
   * оси, см. rayStartRelation), препятствием не считается вовсе: из её тела
   * луч обязан выйти, и под острым углом это происходит далеко от старта —
   * прежний порог "полтолщины" такие стены обрезал или не давал создать.
   * Луч вдоль такой стены (нахлёст) или с грани внутрь тела — отказ: длина 0.
   */
  /** Луч из start лёг бы внахлёст на стену, из которой выходит, или ушёл бы с грани внутрь тела. */
  private isRayStartBlocked(
    start: WallEndpoint,
    dirX: number,
    dirY: number,
    exclude?: ReadonlySet<string>,
  ): boolean {
    for (const wall of this.walls.values()) {
      if (exclude?.has(wall.id)) {
        continue;
      }
      const { startPx, endPx, thicknessPx } = this.segmentGeometryPx(wall);
      const relation = rayStartRelation(
        start,
        { x: dirX, y: dirY },
        startPx,
        endPx,
        thicknessPx / 2,
        RAY_START_EPSILON_PX,
      );
      if (relation === 'overlaps' || relation === 'into-face') {
        return true;
      }
    }
    return false;
  }

  private findFirstWallCollisionTPx(
    start: WallEndpoint,
    dirX: number,
    dirY: number,
    maxLengthPx: number,
    exclude?: ReadonlySet<string>,
  ): number | null {
    if (this.isRayStartBlocked(start, dirX, dirY, exclude)) {
      return 0;
    }
    let bestT: number | null = null;

    for (const wall of this.walls.values()) {
      if (exclude?.has(wall.id)) {
        continue;
      }
      const { startPx, endPx, thicknessPx, rotation } = this.segmentGeometryPx(wall);
      const relation = rayStartRelation(
        start,
        { x: dirX, y: dirY },
        startPx,
        endPx,
        thicknessPx / 2,
        RAY_START_EPSILON_PX,
      );
      if (relation === 'inside') {
        continue;
      }
      const rad = (rotation * Math.PI) / 180;
      const wPerpX = -Math.sin(rad);
      const wPerpY = Math.cos(rad);
      const halfPx = thicknessPx / 2;

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

      const ignoreT = this.collisionIgnoreRadiusPx;

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
   * примагничивание к узлу/оси/грани соседней стены (или угловая магнитность
   * к направляющим, если рядом ничего нет), затем — проверка, не проходит
   * ли получившийся отрезок СКВОЗЬ другую стену раньше своего конца; если
   * да, длина обрезается до этой стены, и она сама становится новой точкой
   * примыкания. Используется и в превью (handleWallDrawMove), и в финальном
   * результате — расчёт один и тот же, чтобы стена не "прыгала" при отпускании.
   *
   * Исключение — курсор ТОЧНО целится в ось существующей стены (T-примыкание,
   * см. findWallSnapPx): это осознанное намерение довести стену до центра
   * чужого тела, а не случайное прохождение сквозь него, и столкновение с
   * БЛИЖНЕЙ гранью той же стены по пути к этой точной цели не должно её
   * подменять — иначе врезка в середину стены снаружи всегда обрезалась бы
   * до грани раньше, чем долетала до оси, и T-примыкание стало бы недостижимо.
   */
  private resolveWallEnd(
    start: WallEndpoint,
    rawPos: WallEndpoint,
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
    forcedAngleDeg?: number,
    forwardFace?: FaceHug,
    endSector?: WallStartHit['endSector'],
  ): WallEndResolution {
    if (forcedAngleDeg !== undefined) {
      // Параллельно грани: угол задан режимом протяжки, а привязки конца к
      // узлам/граням его бы сломали — остаётся только обрезка столкновением.
      // Стена, упёршаяся в чужую грань, получит торец по этой грани сама
      // (findAbutmentFacePx).
      const forcedRad = (forcedAngleDeg * Math.PI) / 180;
      const forcedX = Math.cos(forcedRad);
      const forcedY = Math.sin(forcedRad);
      const along = Math.max(0, (rawPos.x - start.x) * forcedX + (rawPos.y - start.y) * forcedY);
      const hitT = this.findFirstWallCollisionTPx(start, forcedX, forcedY, along);
      return { lengthPx: hitT ?? along, angleDeg: forcedAngleDeg, snap: null, snappedGuideDeg: null };
    }

    let positionSnap = this.findWallSnapPx(rawPos);
    // От грани "вперёд" конец привязывается к узлу/грани, только если эта
    // точка лежит в допустимом секторе ±45° от нормали (RemPlanner).
    if (
      positionSnap &&
      forwardFace &&
      !isInForwardSector(
        { x: positionSnap.point.x - start.x, y: positionSnap.point.y - start.y },
        forwardFace.normal,
        forwardFace.tangent,
      )
    ) {
      positionSnap = null;
    }
    // От торца — то же для сектора ±135°: привязка к точке в запретной зоне
    // позади торца отменяется.
    if (
      positionSnap &&
      endSector &&
      !isInSector(
        { x: positionSnap.point.x - start.x, y: positionSnap.point.y - start.y },
        endSector.forward,
        endSector.side,
        END_SECTOR_LIMIT_DEG,
      )
    ) {
      positionSnap = null;
    }

    // Привязка к оси (угловая направляющая) сильнее магнита к грани/оси стены:
    // иначе у стены направление сбрасывалось бы со своей оси. Тогда конец
    // доходит до стены вдоль направляющей (см. обрезку ниже). Узел остаётся
    // целью, если лежит на оси.
    if (positionSnap && !(event.evt as MouseEvent).shiftKey) {
      const rel = { x: rawPos.x - start.x, y: rawPos.y - start.y };
      const tol = cmToPx(GUIDE_SNAP_TOLERANCE_CM);
      const axisGuide = forwardFace
        ? faceForwardGeometry(rel, forwardFace.normal, forwardFace.tangent, tol, true).snappedLineDeg
        : endSector
          ? endSectorGeometry(rel, endSector.forward, endSector.side, tol, true).snappedLineDeg
          : this.computeWallGeometryPx(start, rawPos, event).snappedGuideDeg;
      if (axisGuide !== null) {
        // Узел остаётся целью, только если лежит на самой оси; иначе конец
        // идёт по оси, а не уводится в сторону к узлу.
        const guideRad = (axisGuide * Math.PI) / 180;
        const nodeOffAxis =
          positionSnap.kind === 'corner' &&
          Math.abs(
            (positionSnap.point.x - start.x) * Math.sin(guideRad) -
              (positionSnap.point.y - start.y) * Math.cos(guideRad),
          ) > RAY_START_EPSILON_PX * 2;
        if (positionSnap.kind !== 'corner' || nodeOffAxis) {
          positionSnap = null;
        }
      }
    }

    let lengthPx: number;
    let angleDeg: number;
    let snap: WallSnap | null = positionSnap;
    let snappedGuideDeg: number | null = null;
    let align: AlignResult | undefined;

    if (positionSnap) {
      const dx = positionSnap.point.x - start.x;
      const dy = positionSnap.point.y - start.y;
      lengthPx = Math.hypot(dx, dy);
      angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    } else if (forwardFace) {
      const geometry = faceForwardGeometry(
        { x: rawPos.x - start.x, y: rawPos.y - start.y },
        forwardFace.normal,
        forwardFace.tangent,
        cmToPx(GUIDE_SNAP_TOLERANCE_CM),
        !(event.evt as MouseEvent).shiftKey,
      );
      lengthPx = geometry.lengthPx;
      angleDeg = geometry.angleDeg;
      snappedGuideDeg = geometry.snappedLineDeg;
    } else if (endSector) {
      const geometry = endSectorGeometry(
        { x: rawPos.x - start.x, y: rawPos.y - start.y },
        endSector.forward,
        endSector.side,
        cmToPx(GUIDE_SNAP_TOLERANCE_CM),
        !(event.evt as MouseEvent).shiftKey,
      );
      lengthPx = geometry.lengthPx;
      angleDeg = geometry.angleDeg;
      snappedGuideDeg = geometry.snappedLineDeg;
    } else {
      const geometry = this.computeWallGeometryPx(start, rawPos, event);
      lengthPx = geometry.lengthPx;
      angleDeg = geometry.angleDeg;
      snappedGuideDeg = geometry.snappedGuideDeg;
    }

    if (!positionSnap && !(event.evt as MouseEvent).shiftKey) {
      const hit = this.alignWallEnd(start, lengthPx, angleDeg, snappedGuideDeg !== null);
      const rel = hit ? { x: hit.point.x - start.x, y: hit.point.y - start.y } : null;
      // От грани/торца выровненный конец не должен вылезти из допустимого сектора.
      const allowed =
        rel !== null &&
        (!forwardFace || isInForwardSector(rel, forwardFace.normal, forwardFace.tangent)) &&
        (!endSector || isInSector(rel, endSector.forward, endSector.side, END_SECTOR_LIMIT_DEG));
      if (hit && rel && allowed) {
        align = hit;
        lengthPx = Math.hypot(rel.x, rel.y);
        if (snappedGuideDeg === null) {
          angleDeg = (Math.atan2(rel.y, rel.x) * 180) / Math.PI;
        }
      }
    }

    const rad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);

    if (positionSnap?.kind === 'axis') {
      // Проверку столкновений здесь пропускаем (см. выше), но нахлёст на
      // стену, из которой стартуем, — нет: иначе стена от конца назад по
      // самой себе привязывалась к собственной оси и ложилась поверх.
      if (this.isRayStartBlocked(start, dirX, dirY)) {
        return { lengthPx: 0, angleDeg, snap: null, snappedGuideDeg: null };
      }
      return { lengthPx, angleDeg, snap, snappedGuideDeg };
    }

    const collisionT = this.findFirstWallCollisionTPx(start, dirX, dirY, lengthPx);
    if (collisionT !== null) {
      const roughPoint = { x: start.x + dirX * collisionT, y: start.y + dirY * collisionT };
      const collisionSnap = snappedGuideDeg === null ? this.findWallSnapPx(roughPoint) : null;
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
      if (collisionSnap) {
        snappedGuideDeg = null;
      }
      align = undefined;
    }

    return { lengthPx, angleDeg, snap, snappedGuideDeg, align };
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.workspaces.get(id);
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  /**
   * У стены больше нет Transformer'а: полигон с уже посчитанным митром на
   * стыках нельзя осмысленно тянуть за анкер (растяжение просто исказило бы
   * готовые вершины, которые пересчитываются только из графа узлов) —
   * выделение стены подсвечивается сменой обводки (Wall.setSelected), а
   * толщину меняет поле толщины в тулбаре, пока стена выделена (см.
   * setWallThickness). У рабочего места Transformer остаётся как раньше.
   */
  private selectWorkspace(workspace: Workspace): void {
    this.clearWallSelectionHighlight();
    this.selectedId = workspace.id;
    this.selectedWallThicknessSnapshotTaken = false;
    this.deskSelection.attach(workspace);
    this.updateWallControls();
    this.emitSelectionChange();
  }

  private selectWall(wall: Wall): void {
    this.clearWallSelectionHighlight();
    this.selectedId = wall.id;
    this.selectedWallThicknessSnapshotTaken = false;
    this.deskSelection.detach();
    wall.setSelected(true);
    this.structureLayer.batchDraw();
    this.updateWallControls();
    this.emitSelectionChange();
  }

  private clearWallSelectionHighlight(): void {
    if (this.selectedId) {
      this.walls.get(this.selectedId)?.setSelected(false);
    }
  }

  private deselect(): void {
    this.clearWallSelectionHighlight();
    this.selectedId = null;
    this.selectedWallThicknessSnapshotTaken = false;
    this.deskSelection.detach();
    this.mainLayer.batchDraw();
    this.structureLayer.batchDraw();
    this.updateWallControls();
    this.emitSelectionChange();
  }

  /** Удаляет выделенный объект (стену или рабочее место). Ничего не делает, если ничего не выделено. */
  removeSelected(): void {
    if (!this.selectedId) {
      return;
    }
    this.pushUndoSnapshot();

    const wall = this.walls.get(this.selectedId);
    if (wall) {
      wall.destroy();
      this.walls.delete(this.selectedId);
      this.pruneOrphanNodes();
      this.rebuildWallGeometry();
    } else {
      const workspace = this.workspaces.get(this.selectedId);
      workspace?.group.destroy();
      this.workspaces.delete(this.selectedId);
      this.mainLayer.batchDraw();
    }

    this.deselect();
  }

  /** Убирает узлы, на которые не ссылается ни одна оставшаяся стена — иначе SceneData бесконечно копит хвосты после удаления. */
  private pruneOrphanNodes(): void {
    const referenced = new Set<string>();
    this.walls.forEach((wall) => {
      referenced.add(wall.startNodeId);
      referenced.add(wall.endNodeId);
    });
    Array.from(this.nodes.keys()).forEach((id) => {
      if (!referenced.has(id)) {
        this.nodes.delete(id);
      }
    });
  }

  /**
   * Меняет статус выделенного рабочего места. Ничего не делает, если
   * выделения нет или выделена стена (у стен статуса не бывает).
   */
  setSelectedWorkspaceStatus(status: WorkspaceStatus): void {
    if (!this.selectedId) {
      return;
    }
    const workspace = this.workspaces.get(this.selectedId);
    if (!workspace) {
      return;
    }
    this.pushUndoSnapshot();
    workspace.setStatus(status);
    this.mainLayer.batchDraw();
  }

  /** Снимок всей сцены — формат undo и сохранения на сервер (Т-03/Т-05), version 2 (Этап 5). */
  serialize(): SceneData {
    return {
      version: 2,
      nodes: Array.from(this.nodes.values()).map((node) => ({ ...node })),
      segments: Array.from(this.walls.values()).map((wall) => wall.toSegmentData()),
      workspaces: Array.from(this.workspaces.values()).map((workspace) => workspace.toData()),
    };
  }

  /**
   * Пересоздаёт сцену из снимка: сначала снимает выделение (иначе
   * Transformer останется со ссылками на уже уничтоженные узлы Konva и
   * упадёт при первом обращении), затем уничтожает текущие узлы/сегменты и
   * чистит карты, и только потом создаёт всё заново из массивов nodes/
   * segments/workspaces — граф не требует отдельного пересчёта стыков,
   * узлы и рёбра просто регистрируются как есть.
   */
  private restore(data: SceneData): void {
    this.isRestoring = true;

    this.deselect();
    this.walls.forEach((wall) => wall.destroy());
    this.walls.clear();
    this.nodes.clear();
    this.workspaces.forEach((workspace) => workspace.group.destroy());
    this.workspaces.clear();

    data.nodes.forEach((node) => this.registerWallNode(node));
    data.segments.forEach((segment) => this.registerWallSegment(segment));
    data.workspaces.forEach((workspaceData) => this.addWorkspace(workspaceData));

    this.isRestoring = false;
    // Undo посреди перетаскивания ручки заменил граф — связи узла пересчитать.
    if (this.handleDrag) {
      Object.assign(this.handleDrag, this.handleDragLinks(this.handleDrag.nodeId));
    }
    this.rebuildWallGeometry();
    this.mainLayer.batchDraw();
  }

  /** Кладёт снимок текущего состояния в стек undo перед изменяющим действием. */
  private pushUndoSnapshot(): void {
    if (this.isRestoring) {
      return;
    }
    this.undoStack.push(this.serialize());
    if (this.undoStack.length > UNDO_STACK_DEPTH) {
      this.undoStack.shift();
    }
  }

  /** Откатывает последнее изменяющее действие (создание/удаление/drag/transform). */
  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return;
    }
    this.restore(snapshot);
  }

  /**
   * Загружает сцену извне (открытие сохранённого плана, Т-03) — снимок
   * текущего состояния кладётся в undo перед заменой, так что "Открыть"
   * тоже можно откатить Ctrl+Z, как любое другое изменяющее действие.
   * Принимает и version 1 (старые планы) — migrateSceneData конвертирует
   * её в граф узлов/рёбер перед восстановлением.
   */
  loadScene(data: SceneData | SceneDataV1): void {
    this.pushUndoSnapshot();
    this.restore(migrateSceneData(data));
  }

  private handleWallDrawStart(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    // Слои со стенами/рабочими местами не слушают события в этом режиме
    // (см. setMode), поэтому event.target здесь всегда stage — отдельная
    // проверка не нужна. А вот кнопку мыши Konva не фильтрует сама —
    // mousedown прилетает и от средней/правой; средняя занята панорамой,
    // так что рисование должно реагировать только на левую (touch — не
    // MouseEvent, его не трогаем).
    if (this.mode !== 'draw-wall' || this.pinch) {
      return;
    }
    if (event.evt instanceof MouseEvent && event.evt.button !== 0) {
      return;
    }
    // getPointerPosition() отдаёт координаты в пикселях контейнера — верно
    // только пока у stage единичный масштаб и нулевое смещение. С зумом/
    // панорамированием нужна getRelativePointerPosition() — она уже учитывает
    // текущую трансформацию stage и возвращает координаты в системе сцены,
    // в которой лежат сами стены.
    const pointerPos = this.stage.getRelativePointerPosition();
    if (!pointerPos) {
      return;
    }
    const startHit = this.findWallStartSnapPx(pointerPos);
    const pos = startHit.snap?.point ?? pointerPos;
    this.wallDrawStartSnap = startHit.snap;
    this.wallDrawFace = startHit.face;
    this.wallDrawMode = 'none';
    // Призрак при нажатии не пропадает: на свободной точке и у конца другой
    // стены он остаётся на месте, пока курсор не вышел из его квадрата, и
    // только тогда уступает место вытягиваемой стене (см. handleWallDrawMove).
    // От грани его заменяет штырь ровно по его контуру.
    if (startHit.face) {
      this.updateWallGhost(null);
    }

    const thicknessPx = cmToPx(this.wallThicknessCm);
    const scale = this.stage.scaleX();

    this.wallDrawStart = pos;
    this.wallDrawAlignLines = null;

    this.guideHighlight = new Konva.Circle({
      x: pos.x,
      y: pos.y,
      radius: GUIDE_HIGHLIGHT_RADIUS_PX / scale,
      fill: withAlpha(palette().accent, 0.15),
      listening: false,
    });
    this.wallDrawEndSector = startHit.endSector;
    this.guideAnglesDeg = startHit.face
      ? faceGuideLinesDeg(startHit.face.normal, startHit.face.tangent)
      : startHit.endSector
        ? endGuideLinesDeg(startHit.endSector.forward)
        : GUIDE_LINE_ANGLES_DEG;
    if (startHit.endSector) {
      // Запретный сектор позади торца (90° вдоль самой стены) — красным, как у RemPlanner.
      const { forward } = startHit.endSector;
      const baseDeg = (Math.atan2(forward.y, forward.x) * 180) / Math.PI;
      this.forbiddenWedge = new Konva.Wedge({
        x: pos.x,
        y: pos.y,
        radius: (GUIDE_HIGHLIGHT_RADIUS_PX * 1.4) / scale,
        angle: 360 - 2 * END_SECTOR_LIMIT_DEG,
        rotation: baseDeg + END_SECTOR_LIMIT_DEG,
        fill: withAlpha(palette()['status-occupied'], 0.22),
        listening: false,
      });
      this.structureLayer.add(this.forbiddenWedge);
    }
    this.guideLines = this.guideAnglesDeg.map((angleDeg) => {
      const rad = (angleDeg * Math.PI) / 180;
      const guideLength = GUIDE_LINE_LENGTH_PX / scale;
      const dx = Math.cos(rad) * guideLength;
      const dy = Math.sin(rad) * guideLength;
      return new Konva.Line({
        points: [pos.x - dx, pos.y - dy, pos.x + dx, pos.y + dy],
        stroke: palette().accent,
        strokeWidth: 1,
        dash: [6, 6],
        opacity: 0.4,
        listening: false,
      });
    });
    this.structureLayer.add(this.guideHighlight, ...this.guideLines);

    // От грани стена появляется сразу — штырём по контуру призрака (как у
    // RemPlanner), и тянется за курсором внутри квадрата.
    const stubAngleDeg = startHit.face
      ? (Math.atan2(startHit.face.normal.y, startHit.face.normal.x) * 180) / Math.PI
      : 0;
    this.wallPreview = new Konva.Rect({
      x: pos.x,
      y: pos.y,
      width: 0,
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: stubAngleDeg,
      fillPatternImage: getWallHatchPattern(),
      fillPatternRepeat: 'repeat',
      stroke: palette().ink,
      strokeWidth: 1,
      listening: false,
    });
    this.wallLengthLabel = new Konva.Text({
      text: '0',
      fontSize: 13,
      fontStyle: 'bold',
      fill: palette().ink,
      fontFamily: palette().fontSans,
      listening: false,
    });
    this.wallThicknessLabel = new Konva.Text({
      text: `${this.wallThicknessCm}`,
      fontSize: 13,
      fill: palette().ink,
      fontFamily: palette().fontSans,
      listening: false,
    });
    this.structureLayer.add(this.wallPreview, this.wallLengthLabel, this.wallThicknessLabel);
    if (startHit.face) {
      // Штырь: от грани, длиной в толщину — ровно квадрат призрака.
      this.renderWallPreview(thicknessPx, stubAngleDeg);
      this.updateWallDimensionLabels(pos, thicknessPx, stubAngleDeg, thicknessPx);
    } else {
      this.renderWallPreview(0, 0);
    }
    this.structureLayer.batchDraw();
  }

  /**
   * Превью — прямоугольник от узла начала по оси на заданные длину и угол,
   * без выступов за узлы: стена заканчивается там, где её начали и закончили,
   * и после отпускания не "дорастает". Заодно запоминает ось — конец стены
   * берётся из неё.
   */
  private renderWallPreview(axisLengthPx: number, angleDeg: number): void {
    if (!this.wallPreview || !this.wallDrawStart) {
      return;
    }
    const thicknessPx = cmToPx(this.wallThicknessCm);
    this.wallPreview.setAttrs({
      x: this.wallDrawStart.x,
      y: this.wallDrawStart.y,
      width: axisLengthPx,
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: angleDeg,
    });
    this.wallDrawAxis = { lengthPx: axisLengthPx, angleDeg };
  }

  private handleWallDrawMove(event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void {
    // См. комментарий в handleWallDrawStart — с зумом/панорамированием
    // getPointerPosition() больше не координата сцены.
    const pos = this.pinch ? null : this.stage.getRelativePointerPosition();
    if (!pos) {
      return;
    }

    // Ещё не рисуем стену — под курсором "призрак" (квадрат сечения стены)
    // и подсветка точки, к которой притянется клик, если она рядом (угол
    // или середина существующей стены).
    if (!this.wallDrawStart || !this.wallPreview) {
      if (this.mode === 'draw-wall') {
        const hit = this.findWallStartSnapPx(pos);
        this.updateWallGhost({ center: hit.ghostCenter, rotationDeg: hit.ghostRotationDeg });
        this.updateWallSnapIndicator(hit.snap);
        this.structureLayer.batchDraw();
      }
      return;
    }

    const thicknessPx = cmToPx(this.wallThicknessCm);

    // Старт от грани чужой стены (правила RemPlanner, см. nextDrawMode):
    //  - внутри квадрата призрака — штырь по нормали, тянется за курсором;
    //  - вышли за его полосу — "вперёд" под углом не положе 45° к нормали;
    //  - вышли вбок по полосе — "вдоль грани": стена параллельна хозяину и
    //    прижата к нему, её начало сдвигается с точки контакта на центр призрака.
    let forcedAngleDeg: number | undefined;
    let stub: WallEndResolution | null = null;
    const face = this.wallDrawFace;
    if (face) {
      const relX = pos.x - face.contact.x;
      const relY = pos.y - face.contact.y;
      const outward = relX * face.normal.x + relY * face.normal.y;
      const alongFace = relX * face.tangent.x + relY * face.tangent.y;
      this.wallDrawMode = nextDrawMode(this.wallDrawMode, outward, alongFace, thicknessPx);
      const desiredStart = this.wallDrawMode === 'parallel' ? face.ghostCenter : face.contact;
      if (desiredStart.x !== this.wallDrawStart.x || desiredStart.y !== this.wallDrawStart.y) {
        this.moveWallDrawStart(desiredStart);
      }
      if (this.wallDrawMode === 'parallel') {
        const direction = alongFace >= 0 ? 1 : -1;
        forcedAngleDeg =
          (Math.atan2(face.tangent.y * direction, face.tangent.x * direction) * 180) / Math.PI;
      } else if (this.wallDrawMode === 'none') {
        stub = {
          lengthPx: Math.min(thicknessPx, Math.max(thicknessPx * FACE_STUB_MIN_FRACTION, outward)),
          angleDeg: (Math.atan2(face.normal.y, face.normal.x) * 180) / Math.PI,
          snap: null,
          snappedGuideDeg: null,
        };
      }
    }

    // Примагничивание к узлу/грани соседней стены и обрезка при столкновении
    // с уже существующей стеной — общая логика, см. resolveWallEnd. Делаем
    // это здесь же, во время протяжки, а не только при отпускании кнопки —
    // иначе пользователь не увидит, что стена уже уткнулась в препятствие.
    // Свободный старт и старт у конца стены: пока курсор не вышел из квадрата
    // призрака, превью так и остаётся квадратом — ни поворота к ближайшей
    // направляющей, ни привязок от лёгкого дрожания мыши сразу после нажатия.
    const halfPx = thicknessPx / 2;
    const insideStartSquare =
      !face &&
      Math.hypot(pos.x - this.wallDrawStart.x, pos.y - this.wallDrawStart.y) < halfPx;
    const resolved: WallEndResolution =
      stub ??
      (insideStartSquare
        ? {
            lengthPx: 0,
            angleDeg: this.wallDrawAxis.angleDeg,
            snap: null,
            snappedGuideDeg: null,
          }
        : this.resolveWallEnd(
            this.wallDrawStart,
            pos,
            event,
            forcedAngleDeg,
            this.wallDrawMode === 'forward' ? (face ?? undefined) : undefined,
            this.wallDrawEndSector,
          ));
    const { lengthPx, angleDeg, snap, snappedGuideDeg } = resolved;
    this.wallDrawEndSnap = snap;

    // Призрак не пропадает при нажатии: пока курсор внутри квадрата старта
    // (свободная точка или конец другой стены), он стоит на месте, а стена
    // нулевой длины ещё не видна; как только курсор вышел — призрак уступает
    // место вытягиваемой стене.
    if (!face && !insideStartSquare) {
      this.updateWallGhost(null);
    }
    this.renderWallPreview(lengthPx, angleDeg);

    this.updateWallDimensionLabels(this.wallDrawStart, lengthPx, angleDeg, thicknessPx);
    this.updateGuideHighlight(snappedGuideDeg);
    this.renderAlignGuides(resolved.align);
    this.updateWallSnapIndicator(snap);
    this.structureLayer.batchDraw();
  }

  /**
   * Переносит начало рисуемой стены (превью, подсветку и направляющие) — при
   * старте от грани оно переезжает между точкой контакта и центром призрака,
   * когда протяжка выбирает режим «вдоль грани» или возвращается к старту.
   */
  private moveWallDrawStart(pos: WallEndpoint): void {
    this.wallDrawStart = pos;
    const guideLength = GUIDE_LINE_LENGTH_PX / this.stage.scaleX();
    this.guideHighlight?.position(pos);
    this.guideAnglesDeg.forEach((angleDeg, index) => {
      const rad = (angleDeg * Math.PI) / 180;
      const dx = Math.cos(rad) * guideLength;
      const dy = Math.sin(rad) * guideLength;
      this.guideLines[index]?.points([pos.x - dx, pos.y - dy, pos.x + dx, pos.y + dy]);
    });
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
    this.forbiddenWedge?.destroy();
    this.forbiddenWedge = null;
    this.renderAlignGuides(undefined);
    this.wallDrawEndSector = null;
    this.updateWallSnapIndicator(null);
    this.wallDrawAxis = { lengthPx: 0, angleDeg: 0 };
    this.wallDrawStart = null;
    this.wallDrawAlignLines = null;
    this.wallDrawStartSnap = null;
    this.wallDrawEndSnap = null;
    this.wallDrawFace = null;
    this.wallDrawMode = 'none';
    this.guideAnglesDeg = GUIDE_LINE_ANGLES_DEG;
  }

  private handleWallDrawEnd(): void {
    if (!this.wallDrawStart || !this.wallPreview) {
      return;
    }

    const start = this.wallDrawStart;
    const { lengthPx, angleDeg: rotation } = this.wallDrawAxis;
    // Штырь, отпущенный внутри квадрата призрака, — законная короткая стена
    // (как у RemPlanner), для него порог минимальной длины не действует.
    const isFaceStub = this.wallDrawFace !== null && this.wallDrawMode === 'none';

    // Точка конца уже была примагничена вживую в handleWallDrawMove — здесь
    // просто забираем итоговый результат, чтобы не пересчитывать и не
    // рисковать разойтись с тем, что пользователь видел на превью.
    const startSnap = this.wallDrawStartSnap;
    const endSnap = this.wallDrawEndSnap;

    this.clearWallDrawingVisuals();

    if (!isFaceStub && pxToCm(lengthPx) < WALL_DRAW_MIN_LENGTH_CM) {
      this.structureLayer.batchDraw();
      return;
    }

    const rad = (rotation * Math.PI) / 180;
    const endPointPx = {
      x: start.x + Math.cos(rad) * lengthPx,
      y: start.y + Math.sin(rad) * lengthPx,
    };

    this.finishWallDraw(start, endPointPx, startSnap, endSnap, this.wallThicknessCm);
  }

  /** Линии-ориентиры от узлов и свободных концов уже нарисованных стен, кроме проходящих через саму точку старта. */
  private alignWallEnd(
    start: WallEndpoint,
    lengthPx: number,
    angleDeg: number,
    angleSnapped: boolean,
  ): AlignResult | undefined {
    // Ориентиры зависят только от уже нарисованных стен, а пока тянется новая,
    // граф не меняется — строим их один раз за протяжку, а не на каждый mousemove.
    let allLines = this.wallDrawStart ? this.wallDrawAlignLines : null;
    if (!allLines) {
      const nodes = [...this.nodes.values()].map((n) => ({ id: n.id, x: cmToPx(n.x), y: cmToPx(n.y) }));
      const edges = [...this.walls.values()].map((w) => ({ startNodeId: w.startNodeId, endNodeId: w.endNodeId }));
      allLines = alignmentLines(nodes, edges);
      if (this.wallDrawStart) {
        this.wallDrawAlignLines = allLines;
      }
    }
    const lines = allLines.filter(
      (line) => Math.hypot(line.origin.x - start.x, line.origin.y - start.y) > RAY_START_EPSILON_PX,
    );
    const rad = (angleDeg * Math.PI) / 180;
    const dir = { x: Math.cos(rad), y: Math.sin(rad) };
    const end = { x: start.x + dir.x * lengthPx, y: start.y + dir.y * lengthPx };
    return (
      snapToAlignment(end, lines, cmToPx(ALIGN_SNAP_TOLERANCE_CM), angleSnapped ? { origin: start, dir } : undefined) ??
      undefined
    );
  }

  /** Пунктир выравнивания: от узла-источника до притянутой точки конца. */
  private renderAlignGuides(align: AlignResult | undefined): void {
    this.alignGuideNodes.forEach((node) => node.destroy());
    this.alignGuideNodes = [];
    if (!align) {
      return;
    }
    const scale = this.stage.scaleX();
    for (const line of align.lines) {
      const along =
        (align.point.x - line.origin.x) * line.dir.x + (align.point.y - line.origin.y) * line.dir.y;
      const overshoot = (along >= 0 ? 1 : -1) * (12 / scale);
      this.alignGuideNodes.push(
        new Konva.Line({
          points: [
            line.origin.x,
            line.origin.y,
            align.point.x + line.dir.x * overshoot,
            align.point.y + line.dir.y * overshoot,
          ],
          stroke: palette().accent,
          strokeWidth: 1 / scale,
          dash: [6 / scale, 4 / scale],
          listening: false,
        }),
        new Konva.Circle({
          x: line.origin.x,
          y: line.origin.y,
          radius: 4 / scale,
          fill: palette().accent,
          listening: false,
        }),
      );
    }
    this.structureLayer.add(...this.alignGuideNodes);
  }

  /** Заливка и площадь замкнутых помещений (под стенами, по внутренним граням). */
  private renderRooms(scale: number): void {
    const nodes = [...this.nodes.values()].map((n) => ({ id: n.id, x: cmToPx(n.x), y: cmToPx(n.y) }));
    const edges = [...this.walls.values()].map((w) => ({
      startNodeId: w.startNodeId,
      endNodeId: w.endNodeId,
      thickness: cmToPx(w.thicknessCm),
    }));
    // findRooms попарно перебирает узлы и рёбра — при неизменном графе (зум,
    // смена выделения) берём прошлый результат и только масштабируем подписи.
    const rooms = this.roomsMemo(wallGraphKey(nodes, edges), () => findRooms(nodes, edges));
    if (rooms === this.renderedRooms) {
      this.roomLabels.forEach(({ label, centroid }) => this.placeRoomLabel(label, centroid, scale));
      this.backgroundLayer.batchDraw();
      return;
    }

    this.roomGroup.destroyChildren();
    this.roomLabels = [];
    this.renderedRooms = rooms;
    for (const room of rooms) {
      this.roomGroup.add(
        new Konva.Line({
          points: room.polygon.flatMap((p) => [p.x, p.y]),
          closed: true,
          fill: withAlpha(palette().surface, 0.7),
          listening: false,
        }),
      );
      const areaM2 = room.area / (PIXELS_PER_CM * PIXELS_PER_CM) / 10000;
      const label = new Konva.Text({
        text: `${areaM2.toFixed(2)} м²`,
        fill: palette()['ink-muted'],
        fontFamily: palette().fontSans,
        listening: false,
      });
      const centroid = polygonCentroid(room.polygon);
      this.placeRoomLabel(label, centroid, scale);
      this.roomGroup.add(label);
      this.roomLabels.push({ label, centroid });
    }
    this.backgroundLayer.batchDraw();
  }

  /** Подпись площади — постоянного экранного размера, по центру помещения. */
  private placeRoomLabel(label: Konva.Text, centroid: WallEndpoint, scale: number): void {
    label.fontSize(14 / scale);
    label.position({ x: centroid.x - label.width() / 2, y: centroid.y - label.height() / 2 });
  }

  /**
   * Длина (px) и угол линии от start до pos. Если курсор попадает в допуск
   * GUIDE_SNAP_TOLERANCE_CM (по перпендикулярному расстоянию до направляющей,
   * не по углу — см. findSnappedGuideLineDeg) от одной из направляющих
   * (0/45/90/135°), угол магнитится к ней — как обычная угловая привязка в
   * CAD-инструментах. Зажатый Shift отключает магнетизм для действительно
   * свободного угла.
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
    const magnetismEnabled = this.snapEnabled && !nativeEvent.shiftKey;
    const snappedGuideDeg = magnetismEnabled
      ? findSnappedGuideLineDeg(dx, dy, cmToPx(GUIDE_SNAP_TOLERANCE_CM))
      : null;

    if (snappedGuideDeg !== null) {
      // Направляющая — это ПРЯМАЯ (0° и 180° одна и та же линия), стена
      // должна указывать туда, где сейчас курсор, — берём то из двух
      // противоположных направлений этой линии, что ближе к исходному углу.
      const opposite = snappedGuideDeg + 180;
      angleDeg =
        Math.abs(angleDiffDeg(rawAngleDeg, snappedGuideDeg)) <=
        Math.abs(angleDiffDeg(rawAngleDeg, opposite))
          ? snappedGuideDeg
          : opposite;
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
      withAlpha(palette().accent, snappedGuideDeg !== null ? 0.28 : 0.15),
    );

    this.guideAnglesDeg.forEach((guideAngle, index) => {
      const line = this.guideLines[index];
      if (!line) {
        return;
      }
      // Направляющая — прямая, 0° и 180° одна и та же линия.
      const difference = (((snappedGuideDeg ?? 0) - guideAngle) % 180 + 180) % 180;
      const isActive = snappedGuideDeg !== null && (difference < 1e-6 || 180 - difference < 1e-6);
      line.stroke(palette().accent);
      line.strokeWidth(isActive ? 1.5 : 1);
      line.opacity(isActive ? 0.9 : 0.4);
    });
  }

  /** Кружок-индикатор точки примагничивания (узел/середина стены) — отдельно от угловых направляющих. */
  private updateWallSnapIndicator(snap: WallSnap | null): void {
    if (!snap) {
      this.wallSnapIndicator?.destroy();
      this.wallSnapIndicator = null;
      return;
    }

    if (!this.wallSnapIndicator) {
      this.wallSnapIndicator = new Konva.Circle({
        stroke: palette().accent,
        strokeWidth: 2,
        fill: palette().surface,
        listening: false,
      });
      this.structureLayer.add(this.wallSnapIndicator);
    }

    // Радиус выставляем на каждый вызов, а не только при создании — зум
    // мог измениться, пока курсор просто висит над точкой примагничивания.
    this.wallSnapIndicator.radius(this.snapIndicatorRadiusPx);
    this.wallSnapIndicator.position(snap.point);
    this.wallSnapIndicator.moveToTop();
  }

  /**
   * "Призрак" — квадрат сечения стены (толщина × толщина) в режиме рисования
   * до начала протяжки. Показывает, с какой толщиной и где начнётся стена,
   * если кликнуть прямо сейчас: у узла — по центру узла, у стены — вплотную
   * к её грани снаружи и повёрнутым вдоль грани (в тело стены призрак не
   * заходит, см. findWallStartSnapPx).
   */
  private updateWallGhost(ghost: { center: WallEndpoint; rotationDeg: number } | null): void {
    if (!ghost) {
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
        stroke: palette().ink,
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
      x: ghost.center.x,
      y: ghost.center.y,
      rotation: ghost.rotationDeg,
    });
    this.wallGhost.moveToTop();
  }

  /**
   * Подпись длины — по центру линии стены, вдоль её направления (с
   * коррекцией "вверх ногами" для углов больше 90°). Подпись толщины — у
   * конца стены, всегда горизонтальная. Обе смещены перпендикулярно линии,
   * чтобы не перекрывать саму штриховку, и масштабированы обратно текущему
   * зуму (1 / stage.scaleX()) — иначе на масштабе 0.2 их не прочитать, а на
   * масштабе 4 они займут пол-экрана.
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

    const scale = this.stage.scaleX();
    const inverseScale = 1 / scale;
    const gapPx = this.dimensionLabelGapPx;

    const angleRad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(angleRad);
    const dirY = Math.sin(angleRad);
    const perpX = -Math.sin(angleRad);
    const perpY = Math.cos(angleRad);
    const labelOffset = thicknessPx / 2 + gapPx;

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
      scaleX: inverseScale,
      scaleY: inverseScale,
    });

    const endX = start.x + dirX * lengthPx - perpX * labelOffset;
    const endY = start.y + dirY * lengthPx - perpY * labelOffset;

    this.wallThicknessLabel.setAttrs({
      x: endX + dirX * gapPx,
      y: endY + dirY * gapPx,
      scaleX: inverseScale,
      scaleY: inverseScale,
    });
  }
}
