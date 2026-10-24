import Konva from 'konva';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import { cmToPx, pxToCm } from '../utils/scale';
import { rectCorners, type Point } from '../utils/deskCollision';

// Вид стола — как в интерфейсе workplace-map (DeskTool.createDeskShape):
// столешница, полоска-монитор, подпись и точка статуса.
const STATUS_STYLE: Record<WorkspaceStatus, { fill: string; stroke: string; monitor: string; dot: string }> = {
  free: { fill: '#e8f5e9', stroke: '#4caf50', monitor: '#81c784', dot: '#4caf50' },
  occupied: { fill: '#ffebee', stroke: '#f44336', monitor: '#e57373', dot: '#f44336' },
  // В исходнике бронь отличалась только точкой — обводка тоже оранжевая,
  // чтобы бронь читалась на плане без приближения.
  reserved: { fill: '#fff3e0', stroke: '#fb8c00', monitor: '#ffb74d', dot: '#ff9800' },
};

const COLLISION_STROKE = '#d32f2f';
const MONITOR_WIDTH_PX = 40;
const MONITOR_HEIGHT_PX = 6;

/**
 * Одно интерактивное рабочее место на плане этажа, которое можно
 * перетаскивать. Выделение (рамка и ручка поворота, см. DeskSelection) — одно
 * на сцену и управляется снаружи, в FloorPlanCanvas.
 * Все размеры в WorkspaceData — сантиметры; в px переводятся только при
 * создании/чтении Konva-узла (как и Wall). Начало координат группы — левый
 * верхний угол стола, вокруг него же поворот (формат сохранённых планов).
 */
export class Workspace {
  readonly id: string;
  readonly group: Konva.Group;

  private rect: Konva.Rect;
  private monitor: Konva.Rect;
  private label: Konva.Text;
  private statusDot: Konva.Circle;
  private status: WorkspaceStatus;

  constructor(data: WorkspaceData, onSelect: (workspace: Workspace) => void) {
    this.id = data.id;
    this.status = data.status;

    this.group = new Konva.Group({
      id: data.id,
      x: cmToPx(data.x),
      y: cmToPx(data.y),
      rotation: data.rotation,
      draggable: true,
    });

    this.rect = new Konva.Rect({
      width: cmToPx(data.width),
      height: cmToPx(data.height),
      strokeWidth: 2,
      cornerRadius: 4,
    });
    this.monitor = new Konva.Rect({ height: MONITOR_HEIGHT_PX, cornerRadius: 2, listening: false });
    this.label = new Konva.Text({
      text: data.label,
      fontSize: 13,
      fontFamily: 'Calibri, Arial, sans-serif',
      fill: '#333333',
      align: 'center',
      verticalAlign: 'middle',
      listening: false,
    });
    this.statusDot = new Konva.Circle({ radius: 4, stroke: '#ffffff', strokeWidth: 1, listening: false });

    this.group.add(this.rect, this.monitor, this.label, this.statusDot);
    this.applyStatusStyle();
    this.layout();

    this.group.on('click tap', (event) => {
      event.cancelBubble = true;
      onSelect(this);
    });
  }

  /** Расставляет монитор, подпись и точку статуса по текущему размеру столешницы. */
  private layout(): void {
    const width = this.rect.width();
    const height = this.rect.height();
    const monitorWidth = Math.min(MONITOR_WIDTH_PX, width - 12);

    this.monitor.width(Math.max(0, monitorWidth));
    this.monitor.position({ x: (width - monitorWidth) / 2, y: 6 });
    this.monitor.visible(height >= 30 && monitorWidth > 0);

    // Подпись — под монитором, в оставшейся части столешницы.
    const labelTop = this.monitor.visible() ? 6 + MONITOR_HEIGHT_PX + 2 : 0;
    this.label.position({ x: 0, y: labelTop });
    this.label.width(width);
    this.label.height(Math.max(0, height - labelTop));

    this.statusDot.position({ x: width - 8, y: 8 });
  }

  private applyStatusStyle(): void {
    const style = STATUS_STYLE[this.status];
    this.rect.fill(style.fill);
    this.rect.stroke(style.stroke);
    this.monitor.fill(style.monitor);
    this.statusDot.fill(style.dot);
  }

  sizePx(): { width: number; height: number } {
    return { width: this.rect.width() * this.group.scaleX(), height: this.rect.height() * this.group.scaleY() };
  }

  /** Центр столешницы на сцене, px (группа повёрнута вокруг левого верхнего угла). */
  centerPx(): Point {
    const { width, height } = this.sizePx();
    const rad = (this.group.rotation() * Math.PI) / 180;
    return {
      x: this.group.x() + (width / 2) * Math.cos(rad) - (height / 2) * Math.sin(rad),
      y: this.group.y() + (width / 2) * Math.sin(rad) + (height / 2) * Math.cos(rad),
    };
  }

  /** Поворот вокруг центра стола (как в workplace-map) — сдвигаем угол группы так, чтобы центр остался на месте. */
  rotateAroundCenter(angleDeg: number): void {
    const center = this.centerPx();
    const { width, height } = this.sizePx();
    const rad = (angleDeg * Math.PI) / 180;
    this.group.rotation(angleDeg);
    this.group.position({
      x: center.x - ((width / 2) * Math.cos(rad) - (height / 2) * Math.sin(rad)),
      y: center.y - ((width / 2) * Math.sin(rad) + (height / 2) * Math.cos(rad)),
    });
  }

  /** Углы столешницы на сцене, px — для проверки столкновений. */
  cornersPx(): Point[] {
    return rectCorners(
      { x: this.group.x(), y: this.group.y() },
      this.rect.width() * this.group.scaleX(),
      this.rect.height() * this.group.scaleY(),
      this.group.rotation(),
    );
  }

  /** Красная обводка, пока стол тащат на занятое место (как призрак в workplace-map). */
  setColliding(colliding: boolean): void {
    this.rect.stroke(colliding ? COLLISION_STROKE : STATUS_STYLE[this.status].stroke);
  }

  setDraggable(draggable: boolean): void {
    this.group.draggable(draggable);
  }

  setStatus(status: WorkspaceStatus): void {
    this.status = status;
    this.applyStatusStyle();
  }

  toData(): WorkspaceData {
    return {
      id: this.id,
      x: pxToCm(this.group.x()),
      y: pxToCm(this.group.y()),
      width: pxToCm(this.rect.width() * this.group.scaleX()),
      height: pxToCm(this.rect.height() * this.group.scaleY()),
      rotation: this.group.rotation(),
      label: this.label.text(),
      status: this.status,
    };
  }
}
