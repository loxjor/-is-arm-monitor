import type { WallEndpoint } from './geometry';
import type { WallSide } from './wallEdit';

/**
 * Старт новой стены от грани существующей — по образцу RemPlanner (WallCursor):
 * призрак (квадрат сечения новой стены) не входит в тело чужой стены, а
 * прилегает к её грани снаружи; стена начинается в точке контакта на грани;
 * если протяжка идёт вдоль грани, новая стена ложится параллельно, вплотную.
 * Функции чистые, без Konva — единицы те, что переданы.
 */

/** Стена как тело для привязки: ось, полутолщина и готовый полигон (с митром и торцами). */
export interface WallBody {
  id: string;
  start: WallEndpoint;
  end: WallEndpoint;
  halfThickness: number;
  /** [левая-у-начала, левая-у-конца, правая-у-конца, правая-у-начала] — порядок buildSegmentPolygon. */
  polygon: readonly WallEndpoint[];
}

export interface FaceHug {
  wallId: string;
  side: WallSide;
  /** Точка на грани, где начнётся стена. */
  contact: WallEndpoint;
  /** Центр квадрата-призрака: вплотную к грани снаружи. */
  ghostCenter: WallEndpoint;
  /** Единичная нормаль грани наружу. */
  normal: WallEndpoint;
  /** Единичное направление вдоль грани (как у оси стены). */
  tangent: WallEndpoint;
}

const EPS = 1e-6;

interface Interval {
  lo: number;
  hi: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function polygonArea(polygon: readonly WallEndpoint[]): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/**
 * Часть отрезка origin + dir·s, s ∈ [sLo, sHi], лежащая внутри выпуклого
 * полигона (включая границу — линия, идущая по ребру, считается внутри:
 * именно так выглядит стена, приставленная к грани). Метод Сайруса—Бека.
 */
function clipSegmentToPolygon(
  origin: WallEndpoint,
  dir: WallEndpoint,
  sLo: number,
  sHi: number,
  polygon: readonly WallEndpoint[],
): Interval | null {
  const area = polygonArea(polygon);
  if (Math.abs(area) < EPS) {
    return null;
  }
  const orientation = area > 0 ? 1 : -1;
  let lo = sLo;
  let hi = sHi;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    const tolerance = EPS * Math.hypot(ex, ey);
    // Внутри — слева от ребра (при положительной ориентации): cross(e, X − p) ≥ 0.
    const c0 = orientation * (ex * (origin.y - p.y) - ey * (origin.x - p.x));
    const c1 = orientation * (ex * dir.y - ey * dir.x);
    if (Math.abs(c1) < 1e-12) {
      if (c0 < -tolerance) {
        return null;
      }
      continue;
    }
    const bound = (-tolerance - c0) / c1;
    if (c1 > 0) {
      lo = Math.max(lo, bound);
    } else {
      hi = Math.min(hi, bound);
    }
    if (lo > hi) {
      return null;
    }
  }
  return { lo, hi };
}

/**
 * Где вдоль грани можно поставить центр призрака: участки, занятые телами
 * других стен (приставленных к этой грани), исключаются, а квадрат
 * целиком — шириной 2·ghostHalf — должен умещаться на свободном участке и не
 * выступать за торец. Берётся ближайшая к курсору допустимая точка.
 */
function pickAlongFace(
  origin: WallEndpoint,
  dir: WallEndpoint,
  faceLo: number,
  faceHi: number,
  cursorS: number,
  ghostHalf: number,
  walls: readonly WallBody[],
  hostId: string,
): number | null {
  const blocked: Interval[] = [];
  // Хозяин грани пропускается здесь, а не отфильтрованной копией массива:
  // findFaceHug зовётся на каждый mousemove, и копия на каждую стену — O(W²) аллокаций.
  for (const other of walls) {
    if (other.id === hostId || other.polygon.length !== 4) {
      continue;
    }
    const interval = clipSegmentToPolygon(origin, dir, faceLo, faceHi, other.polygon);
    if (interval && interval.hi - interval.lo > EPS) {
      blocked.push(interval);
    }
  }
  blocked.sort((a, b) => a.lo - b.lo);

  const free: Interval[] = [];
  let cursor = faceLo;
  for (const interval of blocked) {
    if (interval.lo > cursor + EPS) {
      free.push({ lo: cursor, hi: interval.lo });
    }
    cursor = Math.max(cursor, interval.hi);
  }
  if (faceHi > cursor + EPS) {
    free.push({ lo: cursor, hi: faceHi });
  }

  let best: number | null = null;
  let bestDistance = Infinity;
  for (const interval of free) {
    let s: number;
    if (interval.hi - interval.lo >= 2 * ghostHalf - EPS) {
      s = clamp(cursorS, interval.lo + ghostHalf, interval.hi - ghostHalf);
    } else if (blocked.length === 0) {
      // Грань короче призрака, и её ничто не занимает — центр посередине.
      s = (interval.lo + interval.hi) / 2;
    } else {
      continue;
    }
    const distance = Math.abs(s - cursorS);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = s;
    }
  }
  return best;
}

/**
 * Грань, к которой прилегает призрак, когда курсор у стены или над её телом.
 * Курсор внутри тела выбирает ближайшую грань (на оси — левую), снаружи —
 * грань, обращённую к курсору, если до неё не дальше hugRadius. Призрак
 * (квадрат со стороной 2·newHalf) встаёт вплотную к грани снаружи, не
 * заходит в тело и не выступает за торец; участки грани, занятые другими
 * стенами, обходятся. Побеждает ближайшая грань; null — привязки нет.
 */
export function findFaceHug(
  cursor: WallEndpoint,
  walls: readonly WallBody[],
  newHalf: number,
  hugRadius: number,
): FaceHug | null {
  let best: { hug: FaceHug; score: number } | null = null;

  for (const wall of walls) {
    if (wall.polygon.length !== 4) {
      continue;
    }
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (length === 0) {
      continue;
    }
    const u = { x: (wall.end.x - wall.start.x) / length, y: (wall.end.y - wall.start.y) / length };
    const perp = { x: -u.y, y: u.x };
    const relX = cursor.x - wall.start.x;
    const relY = cursor.y - wall.start.y;
    const cursorS = relX * u.x + relY * u.y;
    const cursorD = relX * perp.x + relY * perp.y;

    for (const side of ['left', 'right'] as const) {
      const sigma = side === 'left' ? 1 : -1;
      const [f0, f1] =
        side === 'left' ? [wall.polygon[0], wall.polygon[1]] : [wall.polygon[3], wall.polygon[2]];
      const s0 = (f0.x - wall.start.x) * u.x + (f0.y - wall.start.y) * u.y;
      const s1 = (f1.x - wall.start.x) * u.x + (f1.y - wall.start.y) * u.y;
      const faceLo = Math.min(s0, s1);
      const faceHi = Math.max(s0, s1);

      // Расстояние от курсора до линии грани: > 0 — снаружи, < 0 — внутри тела.
      const faceDistance = sigma * cursorD - wall.halfThickness;
      const insideBody =
        Math.abs(cursorD) <= wall.halfThickness && cursorS >= faceLo && cursorS <= faceHi;

      let score: number;
      if (insideBody) {
        score = Math.abs(faceDistance);
      } else if (faceDistance >= -EPS) {
        // Как у RemPlanner: грань притягивает, только пока курсор лежит
        // напротив неё (в пределах её торцов) — за торцом призрак
        // отпускается, а не прыгает назад к углу.
        if (cursorS < faceLo || cursorS > faceHi || faceDistance > hugRadius) {
          continue;
        }
        score = faceDistance;
      } else {
        continue;
      }
      if (best && score >= best.score) {
        continue;
      }

      const origin = {
        x: wall.start.x + perp.x * wall.halfThickness * sigma,
        y: wall.start.y + perp.y * wall.halfThickness * sigma,
      };
      const s = pickAlongFace(origin, u, faceLo, faceHi, cursorS, newHalf, walls, wall.id);
      if (s === null) {
        continue;
      }
      const normal = { x: perp.x * sigma, y: perp.y * sigma };
      const contact = { x: origin.x + u.x * s, y: origin.y + u.y * s };
      best = {
        score,
        hug: {
          wallId: wall.id,
          side,
          contact,
          ghostCenter: { x: contact.x + normal.x * newHalf, y: contact.y + normal.y * newHalf },
          normal,
          tangent: u,
        },
      };
    }
  }

  return best?.hug ?? null;
}

/**
 * Режим протяжки от грани (RemPlanner: direction none / f / pl·pr). «Нулевая
 * зона» — сам квадрат призрака: |b| ≤ толщина/2 и 0 ≤ a ≤ толщина (a — от
 * точки контакта вдоль нормали грани наружу, b — вдоль грани):
 *  - "none" — курсор внутри квадрата: стена — штырь, который тянется за
 *    курсором (создаётся, даже если так отпустить кнопку);
 *  - "forward" — курсор вышел за полосу квадрата (или ушёл в хозяина):
 *    стена вперёд, угол не положе 45° к нормали (см. faceForwardGeometry);
 *  - "parallel" — курсор вышел вбок, оставаясь в полосе: стена параллельна
 *    хозяину и прижата к его грани.
 * Выбранный режим липкий: пока курсор не вернулся в квадрат, он не меняется.
 */
export type DrawMode = 'none' | 'forward' | 'parallel';

export function nextDrawMode(prev: DrawMode, a: number, b: number, thickness: number): DrawMode {
  if (a >= 0 && a <= thickness && Math.abs(b) <= thickness / 2) {
    return 'none';
  }
  if (prev !== 'none') {
    return prev;
  }
  return a < 0 || a > thickness ? 'forward' : 'parallel';
}

/** Предел отклонения режима «вперёд» от нормали к грани — как у RemPlanner (радиус 90 у WallReflines). */
const FORWARD_LIMIT_DEG = 45;
/** Направляющие режима «вперёд» относительно нормали: сама нормаль и ±45°. */
const FORWARD_GUIDES_DEG = [-45, 0, 45];
/**
 * Построение от торца (продолжение свободного конца стены): допустимы 180°
 * вперёд плюс по 45° с каждой стороны, то есть ±135° от направления
 * продолжения; запрещён сектор в 90° назад вдоль самой стены (RemPlanner,
 * WallReflines radius 270: зелёный −135…135, красный 135…225).
 */
const END_LIMIT_DEG = 135;
/** Направляющие от торца: продолжение, ±45°, ±90°, ±135°. */
const END_GUIDES_DEG = [-135, -90, -45, 0, 45, 90, 135];

export interface FaceForward {
  lengthPx: number;
  /** Мировой угол направления стены, градусы. */
  angleDeg: number;
  /** Мировой угол направляющей (прямой, mod 180), к которой примагнитились, или null. */
  snappedLineDeg: number | null;
  /** Курсор вышел за допустимый сектор — направление прижато к его границе. */
  clamped: boolean;
}

function worldAngleDeg(forward: WallEndpoint, side: WallEndpoint, phiDeg: number): number {
  const rad = (phiDeg * Math.PI) / 180;
  const dx = forward.x * Math.cos(rad) + side.x * Math.sin(rad);
  const dy = forward.y * Math.cos(rad) + side.y * Math.sin(rad);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

function lineAngleDeg(angleDeg: number): number {
  return ((angleDeg % 180) + 180) % 180;
}

/**
 * Направление и длина новой стены внутри сектора ±limitDeg от направления
 * forward (side — перпендикуляр к нему, знак задаёт, какая сторона
 * положительная). Курсор за пределами сектора не даёт стену за границей — он
 * проецируется на линию границы (длина — проекция курсора на неё); внутри
 * направление берётся по курсору и магнитится к направляющим guidesDeg
 * (углы относительно forward), если курсор ближе snapTolerance (по
 * перпендикуляру) к лучу такой направляющей — к самому лучу, а не к его
 * продолжению в обратную сторону. rel — вектор от точки старта до курсора.
 */
export function sectorGeometry(
  rel: WallEndpoint,
  forward: WallEndpoint,
  side: WallEndpoint,
  limitDeg: number,
  guidesDeg: readonly number[],
  snapTolerance: number,
  snapEnabled: boolean,
): FaceForward {
  const a = rel.x * forward.x + rel.y * forward.y;
  const b = rel.x * side.x + rel.y * side.y;
  const along = (phiDeg: number): number => {
    const rad = (phiDeg * Math.PI) / 180;
    return Math.max(0, a * Math.cos(rad) + b * Math.sin(rad));
  };

  const rawPhi = (Math.atan2(b, a) * 180) / Math.PI;
  if (Math.abs(rawPhi) > limitDeg) {
    const phi = b >= 0 ? limitDeg : -limitDeg;
    return {
      lengthPx: along(phi),
      angleDeg: worldAngleDeg(forward, side, phi),
      snappedLineDeg: null,
      clamped: true,
    };
  }

  let phi = rawPhi;
  let lengthPx = Math.hypot(a, b);
  let snappedLineDeg: number | null = null;
  if (snapEnabled) {
    let bestDistance = snapTolerance;
    for (const guide of guidesDeg) {
      const rad = (guide * Math.PI) / 180;
      if (a * Math.cos(rad) + b * Math.sin(rad) <= 0) {
        continue;
      }
      const distance = Math.abs(a * Math.sin(rad) - b * Math.cos(rad));
      if (distance <= bestDistance) {
        bestDistance = distance;
        phi = guide;
        lengthPx = along(guide);
        snappedLineDeg = lineAngleDeg(worldAngleDeg(forward, side, guide));
      }
    }
  }
  return { lengthPx, angleDeg: worldAngleDeg(forward, side, phi), snappedLineDeg, clamped: false };
}

/**
 * Режим «вперёд» от грани — по правилам RemPlanner: направление ограничено
 * сектором ±45° от нормали грани, магнит к нормали и линиям ±45°.
 * Направляющие считаются от нормали хозяина, а не от мировых осей, так что у
 * косой стены они косые.
 */
export function faceForwardGeometry(
  rel: WallEndpoint,
  normal: WallEndpoint,
  tangent: WallEndpoint,
  snapTolerance: number,
  snapEnabled: boolean,
): FaceForward {
  return sectorGeometry(rel, normal, tangent, FORWARD_LIMIT_DEG, FORWARD_GUIDES_DEG, snapTolerance, snapEnabled);
}

/** Построение от торца: сектор ±135° от продолжения стены (см. END_LIMIT_DEG). */
export function endSectorGeometry(
  rel: WallEndpoint,
  forward: WallEndpoint,
  side: WallEndpoint,
  snapTolerance: number,
  snapEnabled: boolean,
): FaceForward {
  return sectorGeometry(rel, forward, side, END_LIMIT_DEG, END_GUIDES_DEG, snapTolerance, snapEnabled);
}

/** Мировые углы линий-направляющих режима «вперёд» (нормаль и ±45°) — для отрисовки. */
export function faceGuideLinesDeg(normal: WallEndpoint, tangent: WallEndpoint): number[] {
  return FORWARD_GUIDES_DEG.map((guide) => lineAngleDeg(worldAngleDeg(normal, tangent, guide)));
}

/** Мировые углы линий-направляющих от торца: четыре прямые через 45° от продолжения стены. */
export function endGuideLinesDeg(forward: WallEndpoint): number[] {
  const base = (Math.atan2(forward.y, forward.x) * 180) / Math.PI;
  return [0, 45, 90, 135].map((guide) => lineAngleDeg(base + guide));
}

/** Лежит ли вектор от точки старта в секторе ±limitDeg от направления forward. */
export function isInSector(
  rel: WallEndpoint,
  forward: WallEndpoint,
  side: WallEndpoint,
  limitDeg: number,
): boolean {
  const a = rel.x * forward.x + rel.y * forward.y;
  const b = rel.x * side.x + rel.y * side.y;
  return Math.abs((Math.atan2(b, a) * 180) / Math.PI) <= limitDeg;
}

/** Попадает ли вектор от точки контакта в сектор ±45° от нормали (куда допустима привязка конца). */
export function isInForwardSector(rel: WallEndpoint, normal: WallEndpoint, tangent: WallEndpoint): boolean {
  return rel.x * normal.x + rel.y * normal.y > 0 && isInSector(rel, normal, tangent, FORWARD_LIMIT_DEG);
}

/** Предел и направляющие сектора от торца — для привязок конца и отрисовки запретной зоны. */
export const END_SECTOR_LIMIT_DEG = END_LIMIT_DEG;
