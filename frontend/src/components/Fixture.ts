import Konva from 'konva';
import { FIXTURE_NAMES, type FixtureData } from '../types/fixture';
import { cmToPx, pxToCm } from '../utils/scale';
import { stairSymbol } from './stairSymbol';
import { palette } from '../theme';

/**
 * Лестница или лифт на плане — условный знак в прямоугольнике по размерам
 * объекта: у лестницы — линии ступеней и стрелка подъёма, у лифта — шахта
 * с диагоналями и подписью. Группа стоит в центре объекта и поворачивается
 * вокруг него, поэтому x/y группы — это и есть центр из FixtureData.
 */
export class Fixture {
  readonly group: Konva.Group;
  data: FixtureData;
  private selected = false;

  constructor(data: FixtureData, options: { ghost?: boolean; onSelect?: (fixture: Fixture) => void } = {}) {
    this.data = { ...data };
    this.group = new Konva.Group({ draggable: !options.ghost, listening: !options.ghost });
    if (options.ghost) this.group.opacity(0.55);
    const onSelect = options.onSelect;
    if (onSelect) {
      this.group.on('click tap', (event) => {
        event.cancelBubble = true;
        onSelect(this);
      });
    }
    this.render();
  }

  get id(): string {
    return this.data.id;
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.render();
  }

  setDraggable(draggable: boolean): void {
    this.group.draggable(draggable);
  }

  /** Новые данные (размер, поворот, место) — знак перерисовывается целиком. */
  update(data: FixtureData): void {
    this.data = { ...data };
    this.render();
  }

  /** Центр после перетаскивания — группа стоит в центре объекта. */
  toData(): FixtureData {
    return { ...this.data, x: pxToCm(this.group.x()), y: pxToCm(this.group.y()) };
  }

  render(): void {
    const p = palette();
    const w = cmToPx(this.data.width);
    const h = cmToPx(this.data.height);
    this.group.setAttrs({ x: cmToPx(this.data.x), y: cmToPx(this.data.y), rotation: this.data.rotation });
    this.group.destroyChildren();
    this.group.add(
      new Konva.Rect({
        x: -w / 2,
        y: -h / 2,
        width: w,
        height: h,
        fill: p.surface,
        // У лестницы габарит — только рамка выбора: контур рисует сам знак вида.
        stroke: this.selected ? p.accent : this.data.kind === 'stairs' ? p.line : p.ink,
        strokeWidth: this.selected ? 3 : 1.5,
      }),
    );
    const line = (points: number[]): Konva.Line =>
      new Konva.Line({ points, stroke: p['ink-muted'], strokeWidth: 1, listening: false });

    if (this.data.kind === 'stairs') {
      this.group.add(...stairSymbol(this.data.variant ?? 'straight', w, h, { ink: p.ink, muted: p['ink-muted'] }));
      return;
    }

    this.group.add(line([-w / 2, -h / 2, w / 2, h / 2]), line([w / 2, -h / 2, -w / 2, h / 2]));
    const label = new Konva.Text({
      text: FIXTURE_NAMES.elevator,
      fontSize: 13,
      fontStyle: 'bold',
      fontFamily: p.fontSans,
      fill: p.ink,
    });
    label.position({ x: -label.width() / 2, y: -label.height() / 2 });
    const background = new Konva.Rect({
      x: -label.width() / 2 - 3,
      y: -label.height() / 2 - 1,
      width: label.width() + 6,
      height: label.height() + 2,
      fill: p.surface,
    });
    // Подпись не крутится вместе с шахтой — всегда читается горизонтально.
    const caption = new Konva.Group({ rotation: -this.data.rotation, listening: false });
    caption.add(background, label);
    this.group.add(caption);
  }
}
