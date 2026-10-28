import Konva from 'konva';
import type { StairVariant } from '../types/fixture';
import { cmToPx } from '../utils/scale';

// Проступь ступени и ширина марша по умолчанию — по ним делятся марши и площадки.
const TREAD_CM = 30;
const MARCH_CM = 100;

interface Colors {
  ink: string;
  muted: string;
}

type Flight = { x: number; y: number; w: number; h: number; axis: 'v' | 'h' };

/**
 * Условный знак лестницы по виду (как в RemPlanner) в прямоугольнике w × h,
 * начало координат — центр. Подъём — снизу вверх до поворота объекта:
 * стрелка идёт от нижней ступени через площадки и повороты к верхней.
 * Марши — линии ступеней через проступь, площадки — пустые, забежные углы
 * и закругления — лучи из внутреннего угла.
 */
export function stairSymbol(variant: StairVariant, w: number, h: number, colors: Colors): Konva.Shape[] {
  const L = -w / 2;
  const T = -h / 2;
  const R = w / 2;
  const B = h / 2;
  const tread = cmToPx(TREAD_CM);
  const nodes: Konva.Shape[] = [];
  const line = (points: number[], extra: Konva.LineConfig = {}): void => {
    nodes.push(new Konva.Line({ points, stroke: colors.muted, strokeWidth: 1, listening: false, ...extra }));
  };
  const outline = (x: number, y: number, rw: number, rh: number, dash?: number[]): void => {
    nodes.push(new Konva.Rect({ x, y, width: rw, height: rh, stroke: colors.muted, strokeWidth: 1, dash, listening: false }));
  };
  // Консольные — ступени отдельными брусками, а не линиями по сплошному маршу.
  const flight = ({ x, y, w: fw, h: fh, axis }: Flight, cantilever = false, dash?: number[]): void => {
    outline(x, y, fw, fh, cantilever ? [4, 3] : undefined);
    const length = axis === 'v' ? fh : fw;
    for (let t = tread; t < length - 1; t += tread) {
      const points = axis === 'v' ? [x, y + t, x + fw, y + t] : [x + t, y, x + t, y + fh];
      line(points, cantilever ? { strokeWidth: 4, stroke: colors.ink, opacity: 0.35 } : { dash });
    }
  };
  const rays = (cx: number, cy: number, targets: [number, number][]): void => {
    targets.forEach(([x, y]) => line([cx, cy, x, y]));
  };
  const arrow = (points: number[], dashed = false): void => {
    nodes.push(
      new Konva.Arrow({
        points,
        stroke: colors.ink,
        fill: colors.ink,
        strokeWidth: 1.5,
        dash: dashed ? [6, 4] : undefined,
        pointerLength: Math.min(12, w / 4, h / 4),
        pointerWidth: Math.min(10, w / 4, h / 4),
        listening: false,
      }),
    );
  };
  const arcPoints = (cx: number, cy: number, r: number, fromDeg: number, toDeg: number): number[] => {
    const points: number[] = [];
    const steps = Math.max(8, Math.round(Math.abs(toDeg - fromDeg) / 10));
    for (let i = 0; i <= steps; i += 1) {
      const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
      points.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    return points;
  };

  switch (variant) {
    case 'straight':
    case 'straight-cantilever':
      flight({ x: L, y: T, w, h, axis: 'v' }, variant === 'straight-cantilever');
      arrow([0, B - tread / 2, 0, T + tread / 2]);
      break;

    case 'descent':
      // Спуск — ступени уходят ниже пола: пунктиром, стрелка вниз.
      flight({ x: L, y: T, w, h, axis: 'v' }, false, [4, 3]);
      arrow([0, T + tread / 2, 0, B - tread / 2], true);
      break;

    case 'l-landing':
    case 'l-winder':
    case 'l-cantilever':
    case 'l-trapezoid':
    case 'l-rounded': {
      const m = Math.min(cmToPx(MARCH_CM), w * 0.45, h * 0.45);
      const cantilever = variant === 'l-cantilever';
      flight({ x: L, y: T + m, w: m, h: h - m, axis: 'v' }, cantilever);
      flight({ x: L + m, y: T, w: w - m, h: m, axis: 'h' }, cantilever);
      if (variant === 'l-winder') rays(L + m, T + m, [[L, T + m / 2], [L, T], [L + m / 2, T]]);
      if (variant === 'l-trapezoid') rays(L + m, T + m, [[L, T]]);
      if (variant === 'l-rounded') {
        line(arcPoints(L + m, T + m, m, 180, 270));
        rays(
          L + m,
          T + m,
          [202.5, 225, 247.5].map((deg): [number, number] => {
            const a = (deg * Math.PI) / 180;
            return [L + m + m * Math.cos(a), T + m + m * Math.sin(a)];
          }),
        );
      }
      arrow([L + m / 2, B - tread / 2, L + m / 2, T + m / 2, R - tread / 2, T + m / 2]);
      break;
    }

    case 'u-two':
    case 'u-two-winder': {
      const m = w / 2;
      const d = Math.min(m, h * 0.4);
      flight({ x: L, y: T + d, w: m, h: h - d, axis: 'v' });
      flight({ x: 0, y: T + d, w: m, h: h - d, axis: 'v' });
      outline(L, T, w, d);
      if (variant === 'u-two-winder') {
        rays(0, T + d, [[L, T + d / 2], [L + m / 2, T], [0, T], [R - m / 2, T], [R, T + d / 2]]);
      }
      arrow([L + m / 2, B - tread / 2, L + m / 2, T + d / 2, R - m / 2, T + d / 2, R - m / 2, B - tread / 2]);
      break;
    }

    case 'u-three':
    case 'u-three-winder': {
      const m = Math.min(cmToPx(MARCH_CM), w / 3, h / 2);
      flight({ x: L, y: T + m, w: m, h: h - m, axis: 'v' });
      flight({ x: L + m, y: T, w: w - 2 * m, h: m, axis: 'h' });
      flight({ x: R - m, y: T + m, w: m, h: h - m, axis: 'v' });
      if (variant === 'u-three-winder') {
        rays(L + m, T + m, [[L, T + m / 2], [L, T], [L + m / 2, T]]);
        rays(R - m, T + m, [[R, T + m / 2], [R, T], [R - m / 2, T]]);
      }
      arrow([L + m / 2, B - tread / 2, L + m / 2, T + m / 2, R - m / 2, T + m / 2, R - m / 2, B - tread / 2]);
      break;
    }

    case 'spiral-180': {
      // Полукольцо над нижней кромкой: ступени — лучи, подъём по дуге слева направо.
      const r = Math.min(w / 2, h);
      const inner = r * 0.35;
      line([...arcPoints(0, B, r, 180, 360), ...arcPoints(0, B, inner, 360, 180)], { closed: true });
      for (let deg = 195; deg < 360; deg += 15) {
        const a = (deg * Math.PI) / 180;
        line([inner * Math.cos(a), B + inner * Math.sin(a), r * Math.cos(a), B + r * Math.sin(a)]);
      }
      arrow(arcPoints(0, B, (r + inner) / 2, 190, 350));
      break;
    }

    case 'spiral': {
      // Винтовая: круг, стойка в центре, ступени-лучи; подъём по кругу почти на полный оборот.
      const r = Math.min(w, h) / 2;
      const pole = r * 0.12;
      nodes.push(new Konva.Circle({ radius: r, stroke: colors.muted, strokeWidth: 1, listening: false }));
      nodes.push(new Konva.Circle({ radius: pole, stroke: colors.ink, strokeWidth: 1.5, listening: false }));
      for (let deg = 90; deg < 90 + 315; deg += 22.5) {
        const a = (deg * Math.PI) / 180;
        line([pole * Math.cos(a), pole * Math.sin(a), r * Math.cos(a), r * Math.sin(a)]);
      }
      arrow(arcPoints(0, 0, r * 0.6, 100, 390));
      break;
    }

    case 'porch': {
      // Крыльцо: три широкие ступени снизу, над ними площадка у входа.
      const steps = 3;
      const stairsTop = B - steps * tread;
      for (let k = 0; k < steps; k += 1) line([L, B - k * tread, R, B - k * tread]);
      line([L, stairsTop, R, stairsTop], { stroke: colors.ink });
      arrow([0, B - tread / 2, 0, Math.max(T + tread / 2, stairsTop - tread)]);
      break;
    }

    case 'attic':
    case 'ladder': {
      // Чердачная — в люке (пунктир); приставная — только тетивы и перекладины.
      if (variant === 'attic') outline(L + 3, T + 3, w - 6, h - 6, [6, 4]);
      const rail = variant === 'attic' ? w * 0.3 : w * 0.4;
      line([-rail, T, -rail, B], { stroke: colors.ink });
      line([rail, T, rail, B], { stroke: colors.ink });
      for (let y = T + tread / 2; y < B; y += tread) line([-rail, y, rail, y]);
      arrow([0, B - tread / 4, 0, T + tread / 4]);
      break;
    }
  }
  return nodes;
}
