import Konva from 'konva';
import type { WallSegment } from '../types/wall';
import { cmToPx, pxToCm, type Cm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import type { WallEndpoint } from '../utils/geometry';

const WALL_STROKE = '#2b2b2b';
const WALL_MIN_LENGTH_CM = 2;
const WALL_MIN_THICKNESS_CM = 2;

/**
 * View одного ребра графа стен (см. types/wall.ts): прямоугольник заданной
 * толщины, натянутый между двумя точками узлов, которые ему передаёт
 * FloorPlanCanvas. Wall НЕ хранит эти точки сам и не владеет позицией —
 * узлы (WallNode) единственный источник истины по координатам; render()
 * пересчитывает прямоугольник по актуальным точкам, и вызывается заново
 * каждый раз, когда сдвинулся любой из двух узлов (свой либо чужой, если
 * он общий с соседней стеной). Это и заменяет удалённый rebuildJoints —
 * угол не "чинится" отдельным проходом, а всегда соответствует текущим
 * координатам общего узла, потому что ничего другого прямоугольник не
 * помнит.
 *
 * Толщина — единственное, что Wall хранит сам (thicknessCm), потому что это
 * атрибут ребра, а не производная от узлов величина.
 */
export class Wall {
  readonly id: string;
  readonly rect: Konva.Rect;
  readonly startNodeId: string;
  readonly endNodeId: string;
  thicknessCm: Cm;

  constructor(
    segment: WallSegment,
    startPx: WallEndpoint,
    endPx: WallEndpoint,
    onSelect: (wall: Wall) => void,
    onThicknessChanged: (wall: Wall) => void,
  ) {
    this.id = segment.id;
    this.startNodeId = segment.startNodeId;
    this.endNodeId = segment.endNodeId;
    this.thicknessCm = segment.thickness;

    this.rect = new Konva.Rect({
      id: segment.id,
      fillPatternImage: getWallHatchPattern(),
      fillPatternRepeat: 'repeat',
      stroke: WALL_STROKE,
      strokeWidth: 1,
      draggable: true,
    });
    this.applyGeometry(startPx, endPx);

    this.rect.on('click tap', (event) => {
      event.cancelBubble = true;
      onSelect(this);
    });

    // Transformer в новой модели даёт стене только два анкера — top-center/
    // bottom-center (см. FloorPlanCanvas.select) — т.е. может изменить
    // ТОЛЬКО высоту прямоугольника (=толщину). Позицию/поворот Transformer
    // при таком ресайзе всё равно трогает (тянет второй край, чтобы держать
    // видимую грань на месте) — здесь мы забираем из этого жеста только
    // новую толщину, а x/y/rotation прямоугольника FloorPlanCanvas тут же
    // переустановит через render() из координат узлов. Поэтому толщина
    // больше не может сдвинуть ось стены (Д-05) — она физически не читается
    // ниоткуда, кроме узлов.
    this.rect.on('transformend', () => {
      const newHeightPx = Math.max(
        cmToPx(WALL_MIN_THICKNESS_CM),
        this.rect.height() * this.rect.scaleY(),
      );
      this.rect.scaleX(1);
      this.rect.scaleY(1);
      this.thicknessCm = pxToCm(newHeightPx);
      onThicknessChanged(this);
    });
  }

  private applyGeometry(startPx: WallEndpoint, endPx: WallEndpoint): void {
    const dx = endPx.x - startPx.x;
    const dy = endPx.y - startPx.y;
    const lengthPx = Math.max(cmToPx(WALL_MIN_LENGTH_CM), Math.hypot(dx, dy));
    const rotationDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const thicknessPx = cmToPx(this.thicknessCm);

    this.rect.setAttrs({
      x: startPx.x,
      y: startPx.y,
      width: lengthPx,
      height: thicknessPx,
      offsetY: thicknessPx / 2,
      rotation: rotationDeg,
    });
  }

  /** Пересчитывает прямоугольник по новым точкам узлов — толщина и id не меняются. */
  render(startPx: WallEndpoint, endPx: WallEndpoint): void {
    this.applyGeometry(startPx, endPx);
  }

  setDraggable(draggable: boolean): void {
    this.rect.draggable(draggable);
  }

  toSegmentData(): WallSegment {
    return {
      id: this.id,
      startNodeId: this.startNodeId,
      endNodeId: this.endNodeId,
      thickness: this.thicknessCm,
    };
  }
}
