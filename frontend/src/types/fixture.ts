import type { Cm } from '../utils/scale';

export type FixtureKind = 'stairs' | 'elevator';

/** Виды лестниц — как в меню RemPlanner. */
export type StairVariant =
  | 'straight'
  | 'straight-cantilever'
  | 'l-landing'
  | 'l-winder'
  | 'l-cantilever'
  | 'l-trapezoid'
  | 'l-rounded'
  | 'u-two'
  | 'u-two-winder'
  | 'u-three'
  | 'u-three-winder'
  | 'spiral-180'
  | 'descent'
  | 'spiral'
  | 'porch'
  | 'attic'
  | 'ladder';

const c = (value: number): Cm => value as Cm;

/** Название и габарит по умолчанию (ширина × длина, см) каждого вида лестницы. */
export const STAIR_VARIANTS: Record<StairVariant, { name: string; width: Cm; height: Cm }> = {
  straight: { name: 'Прямая маршевая лестница', width: c(120), height: c(300) },
  'straight-cantilever': { name: 'Прямая консольная лестница', width: c(100), height: c(300) },
  'l-landing': { name: 'Лестница с площадкой', width: c(250), height: c(250) },
  'l-winder': { name: 'Лестница с забежными углами', width: c(250), height: c(250) },
  'l-cantilever': { name: 'Консольная угловая лестница', width: c(250), height: c(250) },
  'l-trapezoid': { name: 'Трапецевидная лестница', width: c(250), height: c(250) },
  'l-rounded': { name: 'Закругленная лестница', width: c(250), height: c(250) },
  'u-two': { name: '2х-маршевая лестница', width: c(240), height: c(300) },
  'u-two-winder': { name: '2х-маршевая с забежными углами', width: c(240), height: c(260) },
  'u-three': { name: '3х-маршевая лестница', width: c(300), height: c(250) },
  'u-three-winder': { name: '3х-маршевая с забежными углами', width: c(300), height: c(250) },
  'spiral-180': { name: 'Спиральная лестница', width: c(260), height: c(130) },
  descent: { name: 'Спуск лестницы', width: c(120), height: c(300) },
  spiral: { name: 'Винтовая лестница', width: c(160), height: c(160) },
  porch: { name: 'Лестница для крыльца', width: c(200), height: c(120) },
  attic: { name: 'Чердачная складная лестница', width: c(70), height: c(120) },
  ladder: { name: 'Приставная лестница', width: c(50), height: c(200) },
};

/** Меню инструмента «Лестница»: группы раскрываются, одиночные виды выбираются сразу. */
export const STAIR_MENU: { title: string; items: StairVariant[] }[] = [
  { title: 'Прямые лестницы', items: ['straight', 'straight-cantilever'] },
  { title: 'Угловые лестницы на 90°', items: ['l-landing', 'l-winder', 'l-cantilever', 'l-trapezoid', 'l-rounded'] },
  {
    title: 'Полуоборотные лестницы на 180°',
    items: ['u-two', 'u-two-winder', 'u-three', 'u-three-winder', 'spiral-180'],
  },
  { title: STAIR_VARIANTS.descent.name, items: ['descent'] },
  { title: STAIR_VARIANTS.spiral.name, items: ['spiral'] },
  { title: STAIR_VARIANTS.porch.name, items: ['porch'] },
  { title: STAIR_VARIANTS.attic.name, items: ['attic'] },
  { title: STAIR_VARIANTS.ladder.name, items: ['ladder'] },
];

/**
 * Лестница или лифт на этаже. x/y — центр (поворот — вокруг него), width —
 * поперёк (ширина марша, ширина шахты), height — вдоль (длина марша, глубина
 * шахты); у лестницы подъём идёт от y+height/2 к y−height/2 до поворота.
 */
export interface FixtureData {
  id: string;
  kind: FixtureKind;
  /** Только у лестницы; нет — прямой марш (планы до появления видов). */
  variant?: StairVariant;
  x: Cm;
  y: Cm;
  width: Cm;
  height: Cm;
  rotation: number;
}

// Типовые размеры: марш шириной 1,2 м на этаж высотой ~3 м (10 ступеней по
// 30 см), шахта лифта 1,6 × 1,6 м.
export const FIXTURE_DEFAULTS: Record<FixtureKind, { width: Cm; height: Cm }> = {
  stairs: { width: c(120), height: c(300) },
  elevator: { width: c(160), height: c(160) },
};

export const FIXTURE_NAMES: Record<FixtureKind, string> = {
  stairs: 'Лестница',
  elevator: 'Лифт',
};
