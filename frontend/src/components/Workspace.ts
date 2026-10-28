import Konva from 'konva';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import { cmToPx, pxToCm } from '../utils/scale';
import { rectCorners, type Point } from '../utils/deskCollision';
import { palette, withAlpha } from '../theme';

// Вид стола — по дизайн-системе: радиус radius-md; свободный — обводка
// status-free на surface, занятый и бронь — заливка статусным цветом с
// подписью on-accent. Цвета читаются из токенов (theme.ts) при каждой смене темы.
function statusStyle(status: WorkspaceStatus): { fill: string; stroke: string; text: string } {
  const p = palette();
  if (status === 'free') return { fill: p.surface, stroke: p['status-free'], text: p.ink };
  const color = status === 'occupied' ? p['status-occupied'] : p['status-reserved'];
  return { fill: color, stroke: color, text: p['on-accent'] };
}

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
  private colliding = false;
  private highlighted = false;
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
    });
    this.monitor = new Konva.Rect({ height: MONITOR_HEIGHT_PX, cornerRadius: 2, listening: false });
    this.label = new Konva.Text({
      text: data.label,
      fontSize: 13,
      fontStyle: '500',
      align: 'center',
      verticalAlign: 'middle',
      listening: false,
    });

    this.group.add(this.rect, this.monitor, this.label);
    this.applyTheme();
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

  }

  /** Перечитать цвета и шрифт из токенов — при создании и при смене темы. */
  applyTheme(): void {
    const p = palette();
    const style = statusStyle(this.status);
    this.rect.fill(style.fill);
    this.rect.cornerRadius(p.radiusMd);
    this.monitor.fill(withAlpha(style.text, 0.35));
    this.label.fill(style.text);
    this.label.fontFamily(p.fontSans);
    this.applyStroke();
  }

  private applyStroke(): void {
    const p = palette();
    const style = statusStyle(this.status);
    // У занятого стола обводка того же цвета, что «столкновение», — тогда пунктир цвета ink.
    const collisionColor = this.status === 'occupied' ? p.ink : p['status-occupied'];
    this.rect.stroke(this.colliding ? collisionColor : this.highlighted ? p.accent : style.stroke);
    this.rect.strokeWidth(this.highlighted ? 3 : 2);
    this.rect.dash(this.colliding ? [6, 4] : []);
  }

  /** Обводка accent — стол в групповом выделении (одиночное рисует DeskSelection). */
  setHighlighted(highlighted: boolean): void {
    this.highlighted = highlighted;
    this.applyStroke();
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

  /** Пунктирная обводка, пока стол упирается в стену или соседа. */
  setColliding(colliding: boolean): void {
    this.colliding = colliding;
    this.applyStroke();
  }

  setDraggable(draggable: boolean): void {
    this.group.draggable(draggable);
  }

  setStatus(status: WorkspaceStatus): void {
    this.status = status;
    this.applyTheme();
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
