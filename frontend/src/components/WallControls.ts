import Konva from 'konva';
import type { WallEndpoint } from '../utils/geometry';
import type { WallSide } from '../utils/wallEdit';

export type WallEnd = 'start' | 'end';

export interface WallControlsCallbacks {
  onHandleDragStart(end: WallEnd): void;
  /** Возвращает итоговую (примагниченную) точку — ручка встаёт туда, а не под курсор. */
  onHandleDragMove(end: WallEnd, pos: WallEndpoint, shiftKey: boolean): WallEndpoint;
  onHandleDragEnd(end: WallEnd): void;
  onThicknessStep(side: WallSide, direction: 1 | -1, shiftKey: boolean): void;
}

// Всё в экранных пикселях: группы масштабируются на 1/scale, чтобы
// элементы управления не росли и не съёживались вместе с зумом.
const HANDLE_RADIUS_PX = 6;
const BUTTON_RADIUS_PX = 7;
// Кнопки толщины дальше от грани, чем подпись размерной линии (см.
// DimensionLine), и разнесены вдоль стены — иначе они её перекрывают.
const BUTTON_OFFSET_FROM_FACE_PX = 34;
const BUTTON_SPACING_ALONG_PX = 10;
const ACCENT = '#e48423';

interface ButtonLayout {
  start: WallEndpoint;
  end: WallEndpoint;
  thicknessPx: number;
  scale: number;
}

/**
 * Элементы управления выделенной стеной (как WallController и
 * WallDepthController у RemPlanner): ручки на обоих концах тянут узел графа
 * — вместе с ним и все стены, которые его делят, — а пары кнопок −/+ с
 * каждой стороны меняют толщину только с этой стороны.
 */
export class WallControls {
  readonly group = new Konva.Group({ visible: false });
  private readonly handles: Record<WallEnd, Konva.Circle>;
  private readonly buttons: Array<{ group: Konva.Group; side: WallSide; direction: 1 | -1 }> = [];
  // Каждый клик по −/+ сдвигает грань, а с ней и кнопки — серия кликов
  // уходила бы мимо. Пока курсор над кнопкой, кнопки стоят на месте и
  // догоняют стену при уходе курсора.
  private buttonsFrozen = false;
  private lastLayout: ButtonLayout | null = null;

  constructor(callbacks: WallControlsCallbacks) {
    this.handles = {
      start: this.createHandle('start', callbacks),
      end: this.createHandle('end', callbacks),
    };
    const sides: WallSide[] = ['left', 'right'];
    sides.forEach((side) => {
      ([-1, 1] as const).forEach((direction) => {
        const group = this.createButton(direction);
        group.on('mouseenter', () => {
          this.buttonsFrozen = true;
        });
        group.on('mouseleave', () => {
          this.buttonsFrozen = false;
          if (this.lastLayout) {
            this.placeButtons(this.lastLayout);
            this.group.getLayer()?.batchDraw();
          }
        });
        group.on('click tap', (event) => {
          event.cancelBubble = true;
          const shiftKey = event.evt instanceof MouseEvent && event.evt.shiftKey;
          callbacks.onThicknessStep(side, direction, shiftKey);
        });
        this.buttons.push({ group, side, direction });
        this.group.add(group);
      });
    });
    this.group.add(this.handles.start, this.handles.end);
  }

  private createHandle(end: WallEnd, callbacks: WallControlsCallbacks): Konva.Circle {
    const handle = new Konva.Circle({
      radius: HANDLE_RADIUS_PX,
      fill: '#ffffff',
      stroke: '#dc143c',
      strokeWidth: 2,
      strokeScaleEnabled: false,
      draggable: true,
    });
    handle.on('mouseenter', () => {
      const container = handle.getStage()?.container();
      if (container) container.style.cursor = 'move';
    });
    handle.on('mouseleave', () => {
      const container = handle.getStage()?.container();
      if (container) container.style.cursor = 'default';
    });
    handle.on('click tap', (event) => {
      event.cancelBubble = true;
    });
    handle.on('dragstart', () => callbacks.onHandleDragStart(end));
    handle.on('dragmove', (event) => {
      const shiftKey = event.evt instanceof MouseEvent && event.evt.shiftKey;
      handle.position(callbacks.onHandleDragMove(end, handle.position(), shiftKey));
    });
    handle.on('dragend', () => callbacks.onHandleDragEnd(end));
    return handle;
  }

  private createButton(direction: 1 | -1): Konva.Group {
    const group = new Konva.Group();
    const r = BUTTON_RADIUS_PX;
    const lineAttrs = { stroke: ACCENT, strokeWidth: 2, lineCap: 'round' as const };
    group.add(new Konva.Circle({ radius: r, fill: '#ffffff', stroke: ACCENT, strokeWidth: 2 }));
    group.add(new Konva.Line({ points: [-r / 2, 0, r / 2, 0], ...lineAttrs }));
    if (direction > 0) {
      group.add(new Konva.Line({ points: [0, -r / 2, 0, r / 2], ...lineAttrs }));
    }
    return group;
  }

  /** Ставит элементы управления на стену с осью start→end (px сцены) и толщиной thicknessPx. */
  show(start: WallEndpoint, end: WallEndpoint, thicknessPx: number, scale: number): void {
    const inverse = 1 / scale;
    this.handles.start.setAttrs({ ...start, scaleX: inverse, scaleY: inverse });
    this.handles.end.setAttrs({ ...end, scaleX: inverse, scaleY: inverse });

    this.lastLayout = { start, end, thicknessPx, scale };
    if (!this.buttonsFrozen) {
      this.placeButtons(this.lastLayout);
    }
    this.group.visible(true);
  }

  private placeButtons({ start, end, thicknessPx, scale }: ButtonLayout): void {
    const inverse = 1 / scale;
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const dir = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const perp = { x: -dir.y, y: dir.x };
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const outward = thicknessPx / 2 + BUTTON_OFFSET_FROM_FACE_PX * inverse;
    const along = BUTTON_SPACING_ALONG_PX * inverse;

    this.buttons.forEach(({ group, side, direction }) => {
      const sign = side === 'left' ? 1 : -1;
      group.setAttrs({
        x: mid.x + perp.x * outward * sign + dir.x * along * direction,
        y: mid.y + perp.y * outward * sign + dir.y * along * direction,
        scaleX: inverse,
        scaleY: inverse,
      });
    });
  }

  hide(): void {
    this.group.visible(false);
    this.buttonsFrozen = false;
  }

  isDraggingHandle(): boolean {
    return this.handles.start.isDragging() || this.handles.end.isDragging();
  }
}
