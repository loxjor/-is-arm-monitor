import Konva from 'konva';
import type { WallData } from '../types/wall';
import { cmToPx, pxToCm, type Cm } from '../utils/scale';
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
 * setStartExtension/setEndExtension удлиняет отрисованный прямоугольник на
 * половину толщины за пределы этой точки — приём "квадратного торца"
 * (как stroke-linecap: square), который закрывает щель/нахлёст на стыке
 * без построения точного полигона объединения. startExtensionCm/
 * endExtensionCm запоминают текущую добавку (а не факт "уже применялась
 * ли она"), поэтому удлинение можно и снять, и пересчитать заново — это
 * нужно при удалении соседней стены (Т-05) и при пересчёте стыков (Т-09).
 * toData() всегда возвращает исходную, реально нарисованную пользователем
 * длину, а не удлинённую для рендера.
 */
export class Wall {
  readonly id: string;
  readonly rect: Konva.Rect;

  private startExtensionCm = 0;
  private endExtensionCm = 0;

  constructor(data: WallData, onSelect: (wall: Wall) => void) {
    this.id = data.id;
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

  /**
   * Вычисляется из текущей высоты прямоугольника, а не хранится отдельным
   * полем: transformend Transformer'ом меняет реальную высоту, и раньше
   * (readonly-поле, зафиксированное в конструкторе) rebuildJoints после
   * такого ресайза считал удлинение стыка по УЖЕ устаревшей толщине.
   */
  get thicknessCm(): Cm {
    return pxToCm(this.rect.height());
  }

  setDraggable(draggable: boolean): void {
    this.rect.draggable(draggable);
  }

  /**
   * Выставляет удлинение назад за точку начала на конкретное значение
   * (не "добавляет", а именно задаёт целевую величину) — к прямоугольнику
   * применяется только разница со старым значением, так что вызов
   * идемпотентен и обратим (setStartExtension(0) убирает удлинение).
   */
  setStartExtension(extraCm: number): void {
    const clampedCm = Math.max(0, extraCm);
    const deltaCm = clampedCm - this.startExtensionCm;
    if (deltaCm === 0) {
      return;
    }
    this.startExtensionCm = clampedCm;

    const deltaPx = cmToPx(deltaCm);
    const rad = (this.rect.rotation() * Math.PI) / 180;
    this.rect.x(this.rect.x() - Math.cos(rad) * deltaPx);
    this.rect.y(this.rect.y() - Math.sin(rad) * deltaPx);
    this.rect.width(this.rect.width() + deltaPx);
  }

  /** То же самое, но вперёд за точку конца. */
  setEndExtension(extraCm: number): void {
    const clampedCm = Math.max(0, extraCm);
    const deltaCm = clampedCm - this.endExtensionCm;
    if (deltaCm === 0) {
      return;
    }
    this.endExtensionCm = clampedCm;
    this.rect.width(this.rect.width() + cmToPx(deltaCm));
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
