import Konva from 'konva';
import { FIXTURE_NAMES, type FixtureData } from '../types/fixture';
import { cmToPx, pxToCm } from '../utils/scale';
import { centeredRectCorners, type Point } from '../utils/deskCollision';
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
  private colliding = false;
  private rect!: Konva.Rect;

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

  /** Пунктирная обводка, пока лестница/лифт упирается в стену или соседа. */
  setColliding(colliding: boolean): void {
    if (this.colliding === colliding) return;
    this.colliding = colliding;
    this.applyStroke();
  }

  /** Углы прямоугольника объекта на сцене, px — для проверки столкновений. */
  cornersPx(): Point[] {
    return centeredRectCorners(
      { x: this.group.x(), y: this.group.y() },
      cmToPx(this.data.width),
      cmToPx(this.data.height),
      this.group.rotation(),
    );
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

  /** Обводка габарита: у лестницы это рамка выбора, у лифта — контур шахты. */
  private applyStroke(): void {
    const p = palette();
    this.rect.stroke(
      this.colliding ? p['status-occupied'] : this.selected ? p.accent : this.data.kind === 'stairs' ? p.line : p.ink,
    );
    this.rect.strokeWidth(this.colliding ? 2 : this.selected ? 3 : 1.5);
    this.rect.dash(this.colliding ? [6, 4] : []);
  }

  render(): void {
    const p = palette();
    const w = cmToPx(this.data.width);
    const h = cmToPx(this.data.height);
    this.group.setAttrs({ x: cmToPx(this.data.x), y: cmToPx(this.data.y), rotation: this.data.rotation });
    this.group.destroyChildren();
    this.rect = new Konva.Rect({
      x: -w / 2,
      y: -h / 2,
      width: w,
      height: h,
      fill: p.surface,
    });
    this.group.add(this.rect);
    this.applyStroke();
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
