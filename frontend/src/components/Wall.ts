import Konva from 'konva';
import type { WallData } from '../types/wall';
import { cmToPx, pxToCm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';

const WALL_STROKE = '#2b2b2b';
const WALL_MIN_LENGTH_CM = 2;
const WALL_MIN_THICKNESS_CM = 2;

/**
 * Сегмент стены: прямоугольник заданной толщины, растянутый вдоль линии,
 * которую рисует пользователь. Все размеры в WallData — сантиметры; в px
 * переводятся только при создании/чтении Konva-узла. Толщина центрируется
 * на линии через offsetY, поэтому линия, проведённая мышью, — осевая линия
 * стены, а не её край.
 *
 * Когда в точке начала/конца стены оказывается другая стена (стык), вызов
 * extendStartOnce/extendEndOnce удлиняет отрисованный прямоугольник на
 * половину толщины за пределы этой точки — приём "квадратного торца"
 * (как stroke-linecap: square), который закрывает щель/нахлёст на стыке
 * без построения точного полигона объединения. startExtensionCm/
 * endExtensionCm запоминают добавку, чтобы toData() могла вернуть исходную,
 * реально нарисованную пользователем длину, а не удлинённую для рендера.
 */
export class Wall {
  readonly id: string;
  readonly rect: Konva.Rect;
  readonly thicknessCm: number;

  private startExtensionCm = 0;
  private endExtensionCm = 0;

  constructor(data: WallData, onSelect: (wall: Wall) => void) {
    this.id = data.id;
    this.thicknessCm = data.thickness;
    const thicknessPx = cmToPx(data.thickness);

    this.rect = new Konva.Rect({
      id: data.id,
      x: cmToPx(data.x),
      y: cmToPx(data.y),
      width: cmToPx(data.length),
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: data.rotation,
      fillPatternImage: getWallHatchPattern(),
      fillPatternRepeat: 'repeat',
      stroke: WALL_STROKE,
      strokeWidth: 1,
      draggable: true,
    });

    this.rect.on('click tap', (event) => {
      event.cancelBubble = true;
      onSelect(this);
    });

    // Transformer растягивает толщину и длину через scaleX/scaleY —
    // переносим масштаб в реальные px-размеры и центрируем offsetY заново,
    // иначе следующий ресайз/поворот исказит форму.
    this.rect.on('transformend', () => {
      const newWidthPx = Math.max(
        cmToPx(WALL_MIN_LENGTH_CM),
        this.rect.width() * this.rect.scaleX(),
      );
      const newHeightPx = Math.max(
        cmToPx(WALL_MIN_THICKNESS_CM),
        this.rect.height() * this.rect.scaleY(),
      );

      this.rect.width(newWidthPx);
      this.rect.height(newHeightPx);
      this.rect.offsetY(newHeightPx / 2);
      this.rect.scaleX(1);
      this.rect.scaleY(1);
    });
  }

  setDraggable(draggable: boolean): void {
    this.rect.draggable(draggable);
  }

  /** Удлиняет прямоугольник назад за точку начала (один раз за жизнь стены). */
  extendStartOnce(extraCm: number): void {
    if (this.startExtensionCm > 0 || extraCm <= 0) {
      return;
    }
    this.startExtensionCm = extraCm;

    const extraPx = cmToPx(extraCm);
    const rad = (this.rect.rotation() * Math.PI) / 180;
    this.rect.x(this.rect.x() - Math.cos(rad) * extraPx);
    this.rect.y(this.rect.y() - Math.sin(rad) * extraPx);
    this.rect.width(this.rect.width() + extraPx);
  }

  /** Удлиняет прямоугольник вперёд за точку конца (один раз за жизнь стены). */
  extendEndOnce(extraCm: number): void {
    if (this.endExtensionCm > 0 || extraCm <= 0) {
      return;
    }
    this.endExtensionCm = extraCm;
    this.rect.width(this.rect.width() + cmToPx(extraCm));
  }

  toData(): WallData {
    const rad = (this.rect.rotation() * Math.PI) / 180;
    const startExtensionPx = cmToPx(this.startExtensionCm);

    return {
      id: this.id,
      x: pxToCm(this.rect.x() + Math.cos(rad) * startExtensionPx),
      y: pxToCm(this.rect.y() + Math.sin(rad) * startExtensionPx),
      length: pxToCm(
        this.rect.width() - startExtensionPx - cmToPx(this.endExtensionCm),
      ),
      thickness: pxToCm(this.rect.height()),
      rotation: this.rect.rotation(),
    };
  }
}
