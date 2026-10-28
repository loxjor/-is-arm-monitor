import Konva from 'konva';
import type { WallOpening } from '../types/opening';
import type { WallEndpoint } from '../utils/geometry';
import { cmToPx } from '../utils/scale';
import { doorLeafGeometry, openingCutPolygon, type LeafGeometry } from '../utils/wallOpening';
import { palette } from '../theme';

/** Ось и толщина стены в px сцены — всё, что проёму нужно знать о своей стене. */
export interface OpeningWallFrame {
  start: WallEndpoint;
  end: WallEndpoint;
  thickness: number;
}

/** Проём с offset/width уже в px сцены — в таких единицах считает utils/wallOpening. */
type PxOpening = Omit<WallOpening, 'offset' | 'width'> & { offset: number; width: number };

// Дверная коробка, см: насколько заходит в просвет, выступает за грани
// стены, заходит на саму стену и толщина её профиля.
const FRAME_DEPTH_CM = 6;
const FRAME_OVERHANG_CM = 3;
const FRAME_BACK_CM = 6;
const FRAME_PROFILE_CM = 2;
// Полотно рисуется приоткрытым — так видно и петли, и куда оно открывается.
const DOOR_OPEN_ANGLE_DEG = 45;

const isDoor = (kind: WallOpening['kind']): boolean => kind === 'door' || kind === 'door_double';

const flat = (points: readonly WallEndpoint[]): number[] => points.flatMap((point) => [point.x, point.y]);

/**
 * View проёма — двери или окна в стене. Данные (WallOpening) в см и
 * относительно оси своей стены, поэтому проём сам едет вместе со стеной:
 * render() получает текущую ось и заново строит условный знак.
 *
 * Стены рисуются единым телом (WallMass), вырезать из него проём дорого,
 * поэтому просвет просто закрывается заливкой цвета пола помещения, а торцы
 * стены по краям проёма дорисовываются отдельными линиями.
 */
export class Opening {
  readonly group = new Konva.Group();
  data: WallOpening;
  private selected = false;

  constructor(data: WallOpening, options: { ghost?: boolean; onSelect?: (opening: Opening) => void } = {}) {
    this.data = { ...data };
    if (options.ghost) {
      this.group.setAttrs({ listening: false, opacity: 0.55 });
    }
    const onSelect = options.onSelect;
    if (onSelect) {
      this.group.on('click tap', (event) => {
        event.cancelBubble = true;
        onSelect(this);
      });
    }
  }

  get id(): string {
    return this.data.id;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
  }

  render(frame: OpeningWallFrame): void {
    this.group.destroyChildren();
    const p = palette();
    const opening: PxOpening = { ...this.data, offset: cmToPx(this.data.offset), width: cmToPx(this.data.width) };
    const cut = openingCutPolygon(frame.start, frame.end, frame.thickness, opening);
    if (cut.length === 0) {
      return;
    }
    const [leftFrom, leftTo, rightTo, rightFrom] = cut;
    const line = (points: readonly WallEndpoint[], extra: Konva.LineConfig = {}): Konva.Line =>
      new Konva.Line({ points: flat(points), stroke: p.ink, strokeWidth: 1, ...extra });

    this.group.add(new Konva.Line({ points: flat(cut), closed: true, fill: p.surface }));

    if (isDoor(this.data.kind)) {
      this.renderDoor(frame, opening, line);
    } else {
      this.group.add(line([leftFrom, rightFrom]), line([leftTo, rightTo]));
    }

    if (this.data.kind === 'doorway') {
      // Проём без двери: торцы стены и пунктиром — перемычка над ним.
      const lintel = { stroke: p['line-strong'], dash: [6, 4], strokeScaleEnabled: false };
      this.group.add(line([leftFrom, leftTo], lintel), line([rightFrom, rightTo], lintel));
    }

    if (this.data.kind === 'windowway') {
      this.group.add(line([leftFrom, leftTo]), line([rightFrom, rightTo]));
    }

    if (this.data.kind === 'window') {
      const mid = (a: WallEndpoint, b: WallEndpoint): WallEndpoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      // Условный знак окна: обе грани стены и стекло по оси.
      this.group.add(
        line([leftFrom, leftTo]),
        line([rightFrom, rightTo]),
        line([mid(leftFrom, rightFrom), mid(leftTo, rightTo)]),
      );
    }

    if (this.selected) {
      this.group.add(line(cut, { closed: true, stroke: p.accent, strokeWidth: 2 }));
    }
  }

  /**
   * Дверь: на торцах стены — коробка (U-профиль, обнимающий торец снаружи
   * граней), в просвете — порог (светлые грани и пунктир по оси), полотно
   * приоткрыто на DOOR_OPEN_ANGLE_DEG и висит на внутреннем краю коробки,
   * дуга — путь его конца до закрытого положения.
   */
  private renderDoor(
    frame: OpeningWallFrame,
    opening: PxOpening,
    line: (points: readonly WallEndpoint[], extra?: Konva.LineConfig) => Konva.Line,
  ): void {
    const p = palette();
    const length = Math.hypot(frame.end.x - frame.start.x, frame.end.y - frame.start.y);
    const dir = { x: (frame.end.x - frame.start.x) / length, y: (frame.end.y - frame.start.y) / length };
    const perp = { x: -dir.y, y: dir.x };
    const at = (along: number, across: number): WallEndpoint => ({
      x: frame.start.x + dir.x * along + perp.x * across,
      y: frame.start.y + dir.y * along + perp.y * across,
    });
    const half = frame.thickness / 2;
    const depth = cmToPx(FRAME_DEPTH_CM);
    const overhang = cmToPx(FRAME_OVERHANG_CM);
    const back = cmToPx(FRAME_BACK_CM);
    const profile = cmToPx(FRAME_PROFILE_CM);
    const from = opening.offset - opening.width / 2;
    const to = opening.offset + opening.width / 2;

    // Порог между коробками.
    const sill = { stroke: p['line-strong'], strokeWidth: 1, strokeScaleEnabled: false };
    this.group.add(
      line([at(from + depth, half), at(to - depth, half)], sill),
      line([at(from + depth, -half), at(to - depth, -half)], sill),
      line([at(from + depth, 0), at(to - depth, 0)], { ...sill, dash: [6, 4] }),
    );

    // Коробка на каждом торце: origin — край проёма, sign — направление в просвет.
    [
      { origin: from, sign: 1 },
      { origin: to, sign: -1 },
    ].forEach(({ origin, sign }) => {
      const u = (along: number, across: number): WallEndpoint => at(origin + sign * along, across);
      const outer = half + overhang;
      const inner = outer - profile;
      this.group.add(
        line(
          [
            u(-back, outer),
            u(depth, outer),
            u(depth, -outer),
            u(-back, -outer),
            u(-back, -inner),
            u(depth - profile, -inner),
            u(depth - profile, inner),
            u(-back, inner),
          ],
          { closed: true, fill: p.surface },
        ),
      );
    });

    // Полотно — по чистому просвету между коробками.
    const clear: PxOpening = { ...opening, width: Math.max(opening.width - 2 * depth, 0) };
    this.leafGeometries(frame, clear).forEach((leaf) => {
      if (!leaf) return;
      this.group.add(
        new Konva.Shape({
          stroke: p.ink,
          strokeWidth: 1,
          strokeScaleEnabled: false,
          sceneFunc: (context, shape) => {
            const { center, radius, startAngle, endAngle } = leaf.arc;
            context.beginPath();
            context.arc(
              center.x,
              center.y,
              radius,
              (startAngle * Math.PI) / 180,
              (endAngle * Math.PI) / 180,
              endAngle < startAngle,
            );
            context.strokeShape(shape);
          },
        }),
        line(leaf.leaf, { closed: true, fill: p.surface }),
      );
    });
  }

  private leafGeometries(frame: OpeningWallFrame, opening: PxOpening): (LeafGeometry | null)[] {
    const { start, end, thickness } = frame;
    if (opening.kind === 'door') {
      return [doorLeafGeometry(start, end, thickness, opening, DOOR_OPEN_ANGLE_DEG)];
    }
    if (opening.kind === 'door_double') {
      const half = opening.width / 2;
      return [
        doorLeafGeometry(
          start,
          end,
          thickness,
          { ...opening, offset: opening.offset - half / 2, width: half, hinge: 'start' },
          DOOR_OPEN_ANGLE_DEG,
        ),
        doorLeafGeometry(
          start,
          end,
          thickness,
          { ...opening, offset: opening.offset + half / 2, width: half, hinge: 'end' },
          DOOR_OPEN_ANGLE_DEG,
        ),
      ];
    }
    return [];
  }
}
