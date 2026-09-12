import Konva from 'konva';
import { Workspace } from './Workspace';
import { Wall } from './Wall';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import type { WallNode, WallSegment } from '../types/wall';
import type { SceneData, SceneDataV1 } from '../types/scene';
import { migrateSceneData } from '../utils/wallGraph';
import { computeNodeFaceVertices, buildSegmentPolygon, type NodeRay } from '../utils/wallPolygon';
import { generateId } from '../utils/id';
import { cm, cmToPx, pxToCm, type Cm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import { GRID_MAJOR_EVERY, GRID_MINOR_SPACING_PX, getGridTilePattern } from '../utils/grid';
import {
  type WallEndpoint,
  GUIDE_LINE_ANGLES_DEG,
  angleDiffDeg,
  findSnappedGuideLineDeg,
  intersectRaySegment,
} from '../utils/geometry';

export type CanvasMode = 'select' | 'draw-wall';

const WALL_DRAW_MIN_LENGTH_CM = 3;
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
  private mainLayer: Konva.Layer;
  private transformer: Konva.Transformer;

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

    this.stage.on('mousedown touchstart', (event) => this.handleWallDrawStart(event));
    this.stage.on('mousemove touchmove', (event) => this.handleWallDrawMove(event));
    this.stage.on('wheel', (event) => this.handleWheelZoom(event));

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

    const resizeObserver = new ResizeObserver(() => {
      const container = this.stage.container();
      this.stage.width(container.clientWidth);
      this.stage.height(container.clientHeight);
      this.stage.batchDraw();
    });
    resizeObserver.observe(this.stage.container());

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

  /** Видимость мелкой сетки и колбэк масштаба — общий хвост zoom-логики (колесо/сброс вида). */
  private applyZoomVisuals(scale: number): void {
    this.gridMinorRect?.visible(scale > GRID_MINOR_VISIBLE_ABOVE_SCALE);
    this.gridLayer.batchDraw();
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
    for (let x = origin; x <= extent; x += majorSpacing) {
      this.gridLayer.add(
        new Konva.Line({
          points: [x, origin, x, extent],
          stroke: '#c3c6cd',
          strokeWidth: 1,
          listening: false,
        }),
      );
    }
    for (let y = origin; y <= extent; y += majorSpacing) {
      this.gridLayer.add(
        new Konva.Line({
          points: [origin, y, extent, y],
          stroke: '#c3c6cd',
          strokeWidth: 1,
          listening: false,
        }),
      );
    }

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
    // перерисовывает mainLayer (transformer.getLayer()), поэтому у
    // рабочих мест этот баг не проявлялся — только у стен.
    this.structureLayer.batchDraw();

    // Панорамирование левой кнопкой по пустому месту — только в select:
    // Konva сама не отдаст жест stage, если mousedown пришёлся на объект
    // с собственной draggable=true (тот перетащится сам, а не сцена).
    this.stage.draggable(mode === 'select');

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
    this.pushUndoSnapshot();

    const workspace = new Workspace(data, (selected) => this.selectWorkspace(selected));
    workspace.setDraggable(this.mode === 'select');
    workspace.group.on('dragstart transformstart', () => this.pushUndoSnapshot());
    this.mainLayer.add(workspace.group);
    this.workspaces.set(data.id, workspace);
    this.transformer.moveToTop();
    this.mainLayer.batchDraw();
    return workspace;
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
    wall.line.on('dragstart transformstart', () => this.pushUndoSnapshot());
    wall.line.on('dragend', () => this.handleWallDragEnd(wall));
    this.structureLayer.add(wall.line);
    this.walls.set(segment.id, wall);
    this.transformer.moveToTop();
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
    raysByNode.forEach((rays, nodeId) => {
      const node = this.nodes.get(nodeId);
      if (!node) {
        return;
      }
      const nodePx = { x: cmToPx(node.x), y: cmToPx(node.y) };
      computeNodeFaceVertices(nodePx, rays).forEach((face, key) => faceByRayKey.set(key, face));
    });

    this.walls.forEach((wall) => {
      const startFace = faceByRayKey.get(`${wall.id}:start`);
      const endFace = faceByRayKey.get(`${wall.id}:end`);
      if (!startFace || !endFace) {
        return;
      }
      wall.render(buildSegmentPolygon(startFace, endFace));
    });

    this.structureLayer.batchDraw();
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
    this.transformer.moveToTop();
    this.rebuildWallGeometry();
    return wall;
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

    wall.line.destroy();
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
  private findWallSnapPx(pos: WallEndpoint): WallSnap | null {
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
   * Кратчайшее расстояние (px) от start вдоль направления (dirX, dirY) до
   * границы любой уже существующей стены, не дальше maxLengthPx. Не даёт
   * новой стене пройти сквозь/поверх уже нарисованной — она физически
   * останавливается на первом препятствии, как и полагается прямоугольнику,
   * а не абстрактной линии. Столкновения у самого начала и у самого конца
   * отрезка (в пределах intended-длины) игнорируются — это, как правило,
   * стена, от которой мы уже оттолкнулись при старте, либо законная точка
   * примыкания в конце.
   *
   * Порог игнорирования локально увеличивается до половины толщины СВОЕЙ
   * стены для любого сегмента, чей узел (начальный или конечный) лежит
   * рядом с точкой start луча, — т.е. рядом с тем углом, от которого
   * оттолкнулась протяжка. В графовой модели в одном узле может сходиться
   * больше одной стены, поэтому это не завязано на конкретный экземпляр
   * стены, как раньше, а определяется по расстоянию до start.
   */
  private findFirstWallCollisionTPx(
    start: WallEndpoint,
    dirX: number,
    dirY: number,
    maxLengthPx: number,
  ): number | null {
    let bestT: number | null = null;

    for (const wall of this.walls.values()) {
      const { startPx, endPx, thicknessPx, rotation } = this.segmentGeometryPx(wall);
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

      const nearOwnStart = Math.hypot(start.x - startPx.x, start.y - startPx.y) <= this.snapRadiusPx;
      const nearOwnEnd = Math.hypot(start.x - endPx.x, start.y - endPx.y) <= this.snapRadiusPx;
      const ignoreT = nearOwnStart || nearOwnEnd ? halfPx + 1 : this.collisionIgnoreRadiusPx;

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

    if (positionSnap?.kind === 'axis') {
      return { lengthPx, angleDeg, snap, snappedGuideDeg };
    }

    const rad = (angleDeg * Math.PI) / 180;
    const dirX = Math.cos(rad);
    const dirY = Math.sin(rad);

    const collisionT = this.findFirstWallCollisionTPx(start, dirX, dirY, lengthPx);
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
    this.transformer.nodes([workspace.group]);
    this.transformer.getLayer()?.batchDraw();
  }

  private selectWall(wall: Wall): void {
    this.clearWallSelectionHighlight();
    this.selectedId = wall.id;
    this.selectedWallThicknessSnapshotTaken = false;
    this.transformer.nodes([]);
    wall.setSelected(true);
    this.transformer.getLayer()?.batchDraw();
    this.structureLayer.batchDraw();
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
    this.transformer.nodes([]);
    this.transformer.getLayer()?.batchDraw();
    this.structureLayer.batchDraw();
  }

  /** Удаляет выделенный объект (стену или рабочее место). Ничего не делает, если ничего не выделено. */
  removeSelected(): void {
    if (!this.selectedId) {
      return;
    }
    this.pushUndoSnapshot();

    const wall = this.walls.get(this.selectedId);
    if (wall) {
      wall.line.destroy();
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
    this.walls.forEach((wall) => wall.line.destroy());
    this.walls.clear();
    this.nodes.clear();
    this.workspaces.forEach((workspace) => workspace.group.destroy());
    this.workspaces.clear();

    data.nodes.forEach((node) => this.registerWallNode(node));
    data.segments.forEach((segment) => this.registerWallSegment(segment));
    data.workspaces.forEach((workspaceData) => this.addWorkspace(workspaceData));

    this.isRestoring = false;
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
    if (this.mode !== 'draw-wall') {
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
    const startSnap = this.findWallSnapPx(pointerPos);
    const pos = startSnap?.point ?? pointerPos;
    this.wallDrawStartSnap = startSnap;
    this.updateWallGhost(null);

    const thicknessPx = cmToPx(this.wallThicknessCm);
    const scale = this.stage.scaleX();

    this.wallDrawStart = pos;

    this.guideHighlight = new Konva.Circle({
      x: pos.x,
      y: pos.y,
      radius: GUIDE_HIGHLIGHT_RADIUS_PX / scale,
      fill: 'rgba(76, 175, 80, 0.15)',
      listening: false,
    });
    this.guideLines = GUIDE_LINE_ANGLES_DEG.map((angleDeg) => {
      const rad = (angleDeg * Math.PI) / 180;
      const guideLength = GUIDE_LINE_LENGTH_PX / scale;
      const dx = Math.cos(rad) * guideLength;
      const dy = Math.sin(rad) * guideLength;
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
    // См. комментарий в handleWallDrawStart — с зумом/панорамированием
    // getPointerPosition() больше не координата сцены.
    const pos = this.stage.getRelativePointerPosition();
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

    // Примагничивание к узлу/грани соседней стены и обрезка при столкновении
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

    if (pxToCm(lengthPx) < WALL_DRAW_MIN_LENGTH_CM) {
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
    const magnetismEnabled = !nativeEvent.shiftKey;
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

  /** Кружок-индикатор точки примагничивания (узел/середина стены) — отдельно от угловых направляющих. */
  private updateWallSnapIndicator(snap: WallSnap | null): void {
    if (!snap) {
      this.wallSnapIndicator?.destroy();
      this.wallSnapIndicator = null;
      return;
    }

    if (!this.wallSnapIndicator) {
      this.wallSnapIndicator = new Konva.Circle({
        stroke: '#1976d2',
        strokeWidth: 2,
        fill: '#ffffff',
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
