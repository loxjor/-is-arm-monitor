import Konva from 'konva';
import type { Workspace } from './Workspace';

const FRAME_PADDING_PX = 4;
const HANDLE_OFFSET_PX = 30;
const HANDLE_RADIUS_PX = 7;
const ACCENT = '#1976d2';

export interface DeskRotationCallbacks {
  /** Начало поворота ручкой — снимок для отмены. */
  onStart(workspace: Workspace): void;
  /** Желаемый угол под курсором; вернуть фактически применённый (при столкновении — прежний). */
  onRotate(workspace: Workspace, angleDeg: number): number;
  /** Ручку отпустили — доводка угла к шагу. */
  onEnd(workspace: Workspace): void;
}

/**
 * Выделение рабочего места как в инструменте «Курсор» workplace-map:
 * пунктирная рамка вокруг стола и круглая ручка поворота над ним (без
 * растягивания). Поворот — вокруг центра стола, с подписью текущего угла.
 * Размеры ручки компенсируют зум, чтобы её было удобно хватать на любом масштабе.
 */
export class DeskSelection {
  readonly group = new Konva.Group({ visible: false });
  private readonly body = new Konva.Group();
  private readonly frame = new Konva.Rect({ stroke: ACCENT, dash: [6, 3], listening: false });
  private readonly line = new Konva.Line({ stroke: ACCENT, dash: [4, 3], listening: false });
  private readonly handle = new Konva.Circle({ fill: ACCENT, stroke: '#ffffff' });
  private readonly angleLabel = new Konva.Label({ visible: false, listening: false });
  private workspace: Workspace | null = null;
  private scale = 1;
  private rotating = false;

  constructor(
    private readonly stage: Konva.Stage,
    private readonly callbacks: DeskRotationCallbacks,
  ) {
    this.body.add(this.frame, this.line, this.handle);
    this.angleLabel.add(
      new Konva.Tag({ fill: ACCENT, cornerRadius: 3 }),
      new Konva.Text({ fill: '#ffffff', padding: 4, fontFamily: 'Calibri, Arial, sans-serif' }),
    );
    this.group.add(this.body, this.angleLabel);

    this.handle.on('mouseenter', () => (this.stage.container().style.cursor = 'grab'));
    this.handle.on('mouseleave', () => {
      if (!this.rotating) this.stage.container().style.cursor = 'default';
    });
    this.handle.on('mousedown touchstart', (event) => {
      if (!this.workspace) return;
      event.cancelBubble = true;
      // Ручка тянется вручную, а не Konva-drag: иначе вместе с ней поехала бы сцена.
      this.stage.draggable(false);
      this.rotating = true;
      this.stage.container().style.cursor = 'grabbing';
      this.callbacks.onStart(this.workspace);
      this.stage.on('mousemove.deskrotate touchmove.deskrotate', () => this.handleRotateMove());
      window.addEventListener('mouseup', this.handleRotateEnd);
      window.addEventListener('touchend', this.handleRotateEnd);
    });
  }

  get selected(): Workspace | null {
    return this.workspace;
  }

  get isRotating(): boolean {
    return this.rotating;
  }

  attach(workspace: Workspace): void {
    this.workspace = workspace;
    this.group.visible(true);
    this.group.moveToTop();
    this.update();
  }

  detach(): void {
    this.workspace = null;
    this.group.visible(false);
    this.group.getLayer()?.batchDraw();
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.update();
  }

  /** Подтянуть рамку и ручку к текущему положению/углу стола. */
  update(): void {
    const workspace = this.workspace;
    if (!workspace) return;
    const { width, height } = workspace.sizePx();
    const k = 1 / this.scale;
    const pad = FRAME_PADDING_PX * k;
    const offset = HANDLE_OFFSET_PX * k;

    this.body.position(workspace.group.position());
    this.body.rotation(workspace.group.rotation());
    this.frame.setAttrs({ x: -pad, y: -pad, width: width + 2 * pad, height: height + 2 * pad, strokeWidth: 2 * k });
    this.line.setAttrs({ points: [width / 2, -pad, width / 2, -offset], strokeWidth: 1.5 * k });
    this.handle.setAttrs({ x: width / 2, y: -offset, radius: HANDLE_RADIUS_PX * k, strokeWidth: 2 * k });
    this.group.getLayer()?.batchDraw();
  }

  private handleRotateMove(): void {
    const workspace = this.workspace;
    const pointer = this.group.getLayer()?.getRelativePointerPosition();
    if (!workspace || !pointer) return;
    const center = workspace.centerPx();
    // 0° — ручка ровно над центром, угол растёт по часовой стрелке (как rotation в Konva).
    const raw = (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
    const applied = this.callbacks.onRotate(workspace, ((raw % 360) + 360) % 360);
    this.update();
    this.showAngle(applied, pointer);
  }

  private readonly handleRotateEnd = (): void => {
    this.stage.off('.deskrotate');
    window.removeEventListener('mouseup', this.handleRotateEnd);
    window.removeEventListener('touchend', this.handleRotateEnd);
    this.rotating = false;
    this.stage.container().style.cursor = 'default';
    this.stage.draggable(true);
    this.angleLabel.visible(false);
    if (this.workspace) this.callbacks.onEnd(this.workspace);
    this.update();
  };

  private showAngle(angleDeg: number, pointer: { x: number; y: number }): void {
    const k = 1 / this.scale;
    const text = this.angleLabel.getText() as Konva.Text;
    text.text(`${Math.round(angleDeg) % 360}°`);
    text.fontSize(12 * k);
    text.padding(4 * k);
    this.angleLabel.position({ x: pointer.x + 14 * k, y: pointer.y + 14 * k });
    this.angleLabel.visible(true);
    this.group.getLayer()?.batchDraw();
  }
}
