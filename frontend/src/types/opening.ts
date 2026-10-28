import type { Cm } from '../utils/scale';

export type OpeningKind = 'doorway' | 'door' | 'door_double' | 'windowway' | 'window';

export interface WallOpening {
  id: string;
  segmentId: string;
  kind: OpeningKind;
  /** Центр проёма вдоль оси сегмента, от startNode */
  offset: Cm;
  width: Cm;
  height: Cm;
  /** Высота подоконника от пола; 0 для дверей */
  sillHeight: Cm;
  /** У какого конца сегмента петли */
  hinge: 'start' | 'end';
  /** В какую сторону стены открывается полотно; 'left' — сторона +perp, как в utils/wallEdit.ts */
  swing: 'left' | 'right';
}

export interface OpeningDefaults {
  width: Cm;
  height: Cm;
  sillHeight: Cm;
  minWidth: Cm;
  maxWidth: Cm;
  minHeight: Cm;
  maxHeight: Cm;
}

const c = (value: number): Cm => value as Cm;

// Значения RemPlanner. Для дверей высота фиксирована, поэтому min == max.
export const OPENING_DEFAULTS: Record<OpeningKind, OpeningDefaults> = {
  doorway: { width: c(80), height: c(210), sillHeight: c(0), minWidth: c(50), maxWidth: c(120), minHeight: c(210), maxHeight: c(210) },
  door: { width: c(80), height: c(210), sillHeight: c(0), minWidth: c(50), maxWidth: c(120), minHeight: c(210), maxHeight: c(210) },
  door_double: { width: c(120), height: c(210), sillHeight: c(0), minWidth: c(100), maxWidth: c(600), minHeight: c(210), maxHeight: c(210) },
  windowway: { width: c(120), height: c(150), sillHeight: c(85), minWidth: c(30), maxWidth: c(600), minHeight: c(30), maxHeight: c(200) },
  window: { width: c(120), height: c(150), sillHeight: c(85), minWidth: c(30), maxWidth: c(600), minHeight: c(30), maxHeight: c(200) },
};

// Ходовые размеры, см: дверные полотна 60–90 (+ коробка — это и есть ширина
// проёма на плане), двустворчатые — от 120; окна — типовые ширины блоков
// по ГОСТ 23166, округлённые до 10 см. Все внутри пределов OPENING_DEFAULTS.
export const OPENING_WIDTH_PRESETS: Record<OpeningKind, readonly number[]> = {
  door: [60, 70, 80, 90, 100],
  door_double: [120, 140, 150, 180],
  doorway: [70, 80, 90, 100, 120],
  window: [60, 90, 120, 150, 180],
  windowway: [60, 90, 120, 150, 180],
};
