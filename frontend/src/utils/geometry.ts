/**
 * Чистые геометрические функции, используемые FloorPlanCanvas для
 * примагничивания, обрезки по столкновению и угловой магнитности. Вынесены
 * отдельно, т.к. не зависят от DOM/Konva и тестируются в несколько строк.
 */

export type WallEndpoint = { x: number; y: number };

/** Четыре направляющие линии магнетизма угла — 0° и 180° (и т.д.) одна и та же прямая. */
export const GUIDE_LINE_ANGLES_DEG = [0, 45, 90, 135];

/** Разница углов a-b, приведённая к диапазону (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

/** Ближайшая к p точка отрезка [a, b] (все координаты — px). */
export function nearestPointOnSegment(p: WallEndpoint, a: WallEndpoint, b: WallEndpoint): WallEndpoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return a;
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/**
 * Пересечение луча (origin, направление dirX/dirY, единичный вектор) с
 * отрезком [a, b]. Возвращает расстояние t вдоль луча и точку пересечения,
 * либо null, если луч не пересекает отрезок (t может быть отрицательным —
 * проверка допустимого диапазона делается на стороне вызова).
 */
export function intersectRaySegment(
  origin: WallEndpoint,
  dirX: number,
  dirY: number,
  a: WallEndpoint,
  b: WallEndpoint,
): { t: number; point: WallEndpoint } | null {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = dirX * sy - dirY * sx;
  if (Math.abs(denom) < 1e-9) {
    return null;
  }
  const t = ((a.x - origin.x) * sy - (a.y - origin.y) * sx) / denom;
  const u = ((a.x - origin.x) * dirY - (a.y - origin.y) * dirX) / denom;
  if (u < 0 || u > 1) {
    return null;
  }
  return { t, point: { x: origin.x + dirX * t, y: origin.y + dirY * t } };
}

/**
 * Направляющая линия из GUIDE_LINE_ANGLES_DEG, к которой примагничивается
 * вектор (dx, dy) от точки начала стены, — по ПЕРПЕНДИКУЛЯРНОМУ РАССТОЯНИЮ
 * от курсора до линии, а не по разнице углов. Угловой допуск на длинной
 * стене давал огромное отклонение в единицах длины (5° на отрезке в 1000
 * единиц — это уже ~87 единиц бокового смещения), а допуск, заданный
 * расстоянием, от длины стены не зависит: стена 100 с отклонением 4
 * примагнитится, стена 550 с отклонением 7 — нет, хотя её угловое
 * отклонение (0.73°) вчетверо меньше, чем у первой (2.29°) (проверено в
 * geometry.test.ts на числах из эталона). toleranceDistance — порог в тех
 * же единицах, что dx/dy (домен вызывающего кода — обычно px).
 *
 * Каждая из четырёх линий проходит через начало вектора (dx, dy) — то есть
 * через точку старта стены — и не привязана к направлению (0° и 180° это
 * одна и та же прямая), поэтому расстояние считается до прямой, а не до
 * луча: |dx·sin(θ) − dy·cos(θ)| — стандартная формула расстояния от точки
 * до прямой, заданной направлением (cos θ, sin θ) через начало координат.
 */
export function findSnappedGuideLineDeg(
  dx: number,
  dy: number,
  toleranceDistance: number,
): number | null {
  let bestAngle: number | null = null;
  let bestDist = toleranceDistance;

  for (const angleDeg of GUIDE_LINE_ANGLES_DEG) {
    const rad = (angleDeg * Math.PI) / 180;
    const dist = Math.abs(dx * Math.sin(rad) - dy * Math.cos(rad));
    if (dist <= bestDist) {
      bestDist = dist;
      bestAngle = angleDeg;
    }
  }

  return bestAngle;
}
