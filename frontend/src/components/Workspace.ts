import Konva from 'konva';
import type { WorkspaceData, WorkspaceStatus } from '../types/workspace';
import { cmToPx, pxToCm } from '../utils/scale';

const STATUS_COLORS: Record<WorkspaceStatus, string> = {
  free: '#4caf50',
  occupied: '#e53935',
  reserved: '#fb8c00',
};

const WORKSPACE_MIN_SIZE_PX = 20;

/**
 * Одно интерактивное рабочее место на плане этажа: прямоугольник с подписью,
 * который можно перетаскивать. Выделение и Transformer управляются снаружи
 * (в FloorPlanCanvas), т.к. на сцене должен быть один общий Transformer.
 * Все размеры в WorkspaceData — сантиметры; в px переводятся только при
 * создании/чтении Konva-узла (как и Wall).
 */
export class Workspace {
  readonly id: string;
  readonly group: Konva.Group;

  private rect: Konva.Rect;
  private label: Konva.Text;
  private status: WorkspaceStatus;

  constructor(data: WorkspaceData, onSelect: (workspace: Workspace) => void) {
    this.id = data.id;
    this.status = data.status;

    const widthPx = cmToPx(data.width);
    const heightPx = cmToPx(data.height);

    this.group = new Konva.Group({
      id: data.id,
      x: cmToPx(data.x),
      y: cmToPx(data.y),
      rotation: data.rotation,
      draggable: true,
    });

    this.rect = new Konva.Rect({
      width: widthPx,
      height: heightPx,
      fill: STATUS_COLORS[data.status],
      stroke: '#2b2b2b',
      strokeWidth: 1,
      cornerRadius: 4,
    });

    this.label = new Konva.Text({
      width: widthPx,
      height: heightPx,
      text: data.label,
      fontSize: 14,
      fill: '#ffffff',
      align: 'center',
      verticalAlign: 'middle',
      listening: false,
    });

    this.group.add(this.rect, this.label);

    this.group.on('click tap', (event) => {
      event.cancelBubble = true;
      onSelect(this);
    });

    // Transformer масштабирует Group (scaleX/scaleY), а не width/height.
    // Переносим масштаб в реальные размеры прямоугольника и текста, иначе
    // при повороте/следующем ресайзе обводка и шрифт визуально исказятся.
    this.group.on('transformend', () => {
      const newWidth = Math.max(WORKSPACE_MIN_SIZE_PX, this.rect.width() * this.group.scaleX());
      const newHeight = Math.max(WORKSPACE_MIN_SIZE_PX, this.rect.height() * this.group.scaleY());

      this.rect.width(newWidth);
      this.rect.height(newHeight);
      this.label.width(newWidth);
      this.label.height(newHeight);

      this.group.scaleX(1);
      this.group.scaleY(1);
    });
  }

  setDraggable(draggable: boolean): void {
    this.group.draggable(draggable);
  }

  setStatus(status: WorkspaceStatus): void {
    this.status = status;
    this.rect.fill(STATUS_COLORS[status]);
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
