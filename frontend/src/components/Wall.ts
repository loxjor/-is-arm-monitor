import Konva from 'konva';
import type { WallSegment } from '../types/wall';
import { pxToCm, type Cm } from '../utils/scale';
import { getWallHatchPattern } from '../utils/hatchPattern';
import type { WallEndpoint } from '../utils/geometry';
import { faceDimensions } from '../utils/wallEdit';
import { DimensionLine } from './DimensionLine';
import { palette } from '../theme';

// Грань короче сантиметра — это срез острого угла или вырожденный стык,
// подпись "0" или "1" на ней только засоряет чертёж.
const MIN_DIMENSION_CM = 1;

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
 * подсвечивается сменой обводки (setSelected), а толщину меняют поле
 * толщины в тулбаре (симметрично от оси, см. FloorPlanCanvas.setWallThickness)
 * и кнопки −/+ у граней (с одной стороны, см. WallControls).
 */
export class Wall {
  readonly id: string;
  readonly line: Konva.Line;
  readonly startNodeId: string;
  readonly endNodeId: string;
  thicknessCm: Cm;
  /** Размерные линии по левой и правой грани — лежат в отдельном слое над стенами (см. FloorPlanCanvas). */
  readonly dimensionGroup = new Konva.Group({ listening: false });
  private readonly faceDimensionLines = [new DimensionLine(), new DimensionLine()];
  private polygon: WallEndpoint[] = [];
  private axisStart: WallEndpoint | null = null;
  private axisEnd: WallEndpoint | null = null;
  private selected = false;

  constructor(segment: WallSegment, onSelect: (wall: Wall) => void) {
    this.faceDimensionLines.forEach((dimension) => this.dimensionGroup.add(dimension.group));
    this.id = segment.id;
    this.startNodeId = segment.startNodeId;
    this.endNodeId = segment.endNodeId;
    this.thicknessCm = segment.thickness;

    this.line = new Konva.Line({
      id: segment.id,
      points: [],
      closed: true,
      fillPatternRepeat: 'repeat',
      strokeWidth: 1,
      draggable: true,
    });

    this.applyTheme();

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
  render(polygonPoints: readonly WallEndpoint[], axisStart: WallEndpoint, axisEnd: WallEndpoint): void {
    const flat: number[] = [];
    polygonPoints.forEach((point) => {
      flat.push(point.x, point.y);
    });
    this.line.points(flat);
    this.polygon = [...polygonPoints];
    this.axisStart = axisStart;
    this.axisEnd = axisEnd;
  }

  /** Полигон из последнего render() — по нему ищутся грани для привязки нового старта (см. utils/wallStart.ts). */
  getPolygon(): readonly WallEndpoint[] {
    return this.polygon;
  }

  /**
   * Размеры по обеим граням из последнего render(). Отдельно от render(),
   * потому что зависят ещё и от масштаба сцены — при зуме перерисовываются
   * только они, полигон остаётся прежним.
   */
  renderDimensions(scale: number): void {
    const faces = this.axisStart && this.axisEnd ? faceDimensions(this.polygon, this.axisStart, this.axisEnd) : [];
    this.faceDimensionLines.forEach((dimension, index) => {
      const face = faces[index];
      if (!face || pxToCm(face.length) < MIN_DIMENSION_CM) {
        dimension.hide();
        return;
      }
      dimension.update(face.from, face.to, face.outward, `${Math.round(pxToCm(face.length))}`, scale);
    });
  }

  /** Штриховка и обводка — из токенов текущей темы (стена — ink, выбранная — accent). */
  applyTheme(): void {
    this.line.fillPatternImage(getWallHatchPattern());
    this.line.stroke(this.selected ? palette().accent : palette().ink);
    this.faceDimensionLines.forEach((dimension) => dimension.applyTheme());
  }

  destroy(): void {
    this.line.destroy();
    this.dimensionGroup.destroy();
  }

  setDraggable(draggable: boolean): void {
    this.line.draggable(draggable);
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.line.stroke(selected ? palette().accent : palette().ink);
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
