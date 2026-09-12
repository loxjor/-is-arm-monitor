import Konva from 'konva';
import type { WallSegment } from '../types/wall';
import type { Cm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import type { WallEndpoint } from '../utils/geometry';

const WALL_STROKE = '#2b2b2b';
const WALL_SELECTED_STROKE = '#1976d2';

/**
 * View одного ребра графа стен (см. types/wall.ts): полигон (Konva.Line,
 * closed: true), вершины которого считает FloorPlanCanvas
 * (utils/wallPolygon.ts) из координат обоих узлов и их соседей по графу —
 * Wall сам ничего не пересекает и не хранит своей позиции. render() просто
 * применяет уже готовые точки; вызывается заново, когда сдвинулся любой из
 * двух узлов (свой либо чужой, если он общий с соседней стеной) или
 * изменилась толщина где-то по соседству. Это и заменяет удалённый
 * rebuildJoints — угол не "чинится" отдельным проходом, а всегда
 * соответствует текущей геометрии графа, потому что полигон целиком
 * пересчитывается из неё же.
 *
 * Толщина — единственное, что Wall хранит сам (thicknessCm), потому что это
 * атрибут ребра, а не производная от узлов величина. Transformer на стены
 * больше не навешивается (полигон с митром нельзя осмысленно тянуть за
 * анкер — растяжение исказило бы уже посчитанные вершины стыков): выбор
 * подсвечивается сменой обводки (setSelected), а толщину меняет поле
 * толщины в тулбаре, когда стена выделена (см. FloorPlanCanvas.setWallThickness).
 */
export class Wall {
  readonly id: string;
  readonly line: Konva.Line;
  readonly startNodeId: string;
  readonly endNodeId: string;
  thicknessCm: Cm;

  constructor(segment: WallSegment, onSelect: (wall: Wall) => void) {
    this.id = segment.id;
    this.startNodeId = segment.startNodeId;
    this.endNodeId = segment.endNodeId;
    this.thicknessCm = segment.thickness;

    this.line = new Konva.Line({
      id: segment.id,
      points: [],
      closed: true,
      fillPatternImage: getWallHatchPattern(),
      fillPatternRepeat: 'repeat',
      stroke: WALL_STROKE,
      strokeWidth: 1,
      draggable: true,
    });

    this.line.on('click tap', (event) => {
      event.cancelBubble = true;
      onSelect(this);
    });
  }

  /**
   * Применяет уже посчитанные вершины полигона (см. utils/wallPolygon.ts) —
   * сам Wall не знает ни про узлы, ни про соседей, только рисует то, что
   * ему передали.
   */
  render(polygonPoints: readonly WallEndpoint[]): void {
    const flat: number[] = [];
    polygonPoints.forEach((point) => {
      flat.push(point.x, point.y);
    });
    this.line.points(flat);
  }

  setDraggable(draggable: boolean): void {
    this.line.draggable(draggable);
  }

  setSelected(selected: boolean): void {
    this.line.stroke(selected ? WALL_SELECTED_STROKE : WALL_STROKE);
    this.line.strokeWidth(selected ? 2 : 1);
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
