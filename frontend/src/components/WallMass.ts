import Konva from 'konva';
import type { WallEndpoint } from '../utils/geometry';
import { getWallHatchPattern } from '../utils/hatchPattern';
import { palette } from '../theme';

/**
 * Все стены плана как одно тело: полигоны стен и сердцевин узлов (см.
 * buildNodeHub) рисуются одним путём, поэтому
 * штриховка идёт непрерывно через стыки, а контур есть только снаружи.
 * Отдельные Konva.Line стен (см. Wall) остаются для клика и перетаскивания,
 * но сами по себе невидимы.
 *
 * Контур рисуется ДО заливки двойной ширины: заливка перекрывает внутреннюю
 * половину обводки и все рёбра на стыках соседних полигонов, снаружи
 * остаётся ровно strokeWidth / 2 — сплошная линия по периметру объединения.
 * Полигоны приводятся к одному направлению обхода, иначе при правиле
 * nonzero наложившиеся участки (торец, упёртый в грань) вычитались бы.
 */
export class WallMass {
  readonly shape: Konva.Shape;
  private polygons: WallEndpoint[][] = [];

  constructor() {
    this.shape = new Konva.Shape({
      listening: false,
      strokeWidth: 2,
      fillPatternRepeat: 'repeat',
      sceneFunc: (context, shape) => {
        context.beginPath();
        this.polygons.forEach((polygon) => {
          polygon.forEach((point, index) => {
            if (index === 0) {
              context.moveTo(point.x, point.y);
            } else {
              context.lineTo(point.x, point.y);
            }
          });
          context.closePath();
        });
        context.strokeShape(shape);
        context.fillShape(shape);
      },
    });
    this.applyTheme();
  }

  setPolygons(polygons: readonly (readonly WallEndpoint[])[]): void {
    this.polygons = polygons.filter((polygon) => polygon.length >= 3).map(toCounterClockwise);
  }

  applyTheme(): void {
    this.shape.fillPatternImage(getWallHatchPattern());
    this.shape.stroke(palette().ink);
  }
}

function toCounterClockwise(polygon: readonly WallEndpoint[]): WallEndpoint[] {
  let doubledArea = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    doubledArea += point.x * next.y - next.x * point.y;
  });
  return doubledArea < 0 ? [...polygon].reverse() : [...polygon];
}
