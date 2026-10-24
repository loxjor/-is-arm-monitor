import Konva from 'konva';
import type { WallEndpoint } from '../utils/geometry';

const LINE_COLOR = '#6b7280';
const TEXT_COLOR = '#1f2430';
const FONT_SIZE = 11;
// Экранные пиксели — делятся на масштаб сцены в update(), чтобы размерная
// линия выглядела одинаково при любом зуме.
const OFFSET_FROM_FACE_PX = 10;
const TICK_HALF_PX = 4;
const TEXT_GAP_PX = 8;

/**
 * Размерная линия вдоль грани стены: отрезок параллельно грани, вынесенный
 * наружу на OFFSET_FROM_FACE_PX, засечки под 45° на концах (архитектурная
 * нотация, как у RemPlanner) и подпись длины в сантиметрах посередине.
 */
export class DimensionLine {
  readonly group: Konva.Group;
  private readonly line: Konva.Line;
  private readonly tickStart: Konva.Line;
  private readonly tickEnd: Konva.Line;
  private readonly label: Konva.Text;

  constructor() {
    this.group = new Konva.Group({ listening: false });
    const lineAttrs = { stroke: LINE_COLOR, strokeWidth: 1, strokeScaleEnabled: false };
    this.line = new Konva.Line(lineAttrs);
    this.tickStart = new Konva.Line(lineAttrs);
    this.tickEnd = new Konva.Line(lineAttrs);
    this.label = new Konva.Text({ fontSize: FONT_SIZE, fill: TEXT_COLOR });
    this.group.add(this.line, this.tickStart, this.tickEnd, this.label);
  }

  /** from/to — концы грани (px сцены), outward — единичная нормаль наружу грани, text — подпись. */
  update(from: WallEndpoint, to: WallEndpoint, outward: WallEndpoint, text: string, scale: number): void {
    const offset = OFFSET_FROM_FACE_PX / scale;
    const a = { x: from.x + outward.x * offset, y: from.y + outward.y * offset };
    const b = { x: to.x + outward.x * offset, y: to.y + outward.y * offset };
    this.line.points([a.x, a.y, b.x, b.y]);

    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // Засечка — диагональ между направлением линии и нормалью.
    const tickHalf = TICK_HALF_PX / scale;
    const tick = { x: (dir.x + outward.x) * tickHalf, y: (dir.y + outward.y) * tickHalf };
    this.tickStart.points([a.x - tick.x, a.y - tick.y, a.x + tick.x, a.y + tick.y]);
    this.tickEnd.points([b.x - tick.x, b.y - tick.y, b.x + tick.x, b.y + tick.y]);

    let rotation = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
    if (rotation > 90 || rotation <= -90) {
      rotation += 180;
    }
    const textGap = TEXT_GAP_PX / scale;
    this.label.text(text);
    this.label.setAttrs({
      x: (a.x + b.x) / 2 + outward.x * textGap,
      y: (a.y + b.y) / 2 + outward.y * textGap,
      offsetX: this.label.width() / 2,
      offsetY: this.label.height() / 2,
      rotation,
      scaleX: 1 / scale,
      scaleY: 1 / scale,
    });
    this.group.visible(true);
  }

  hide(): void {
    this.group.visible(false);
  }
}
