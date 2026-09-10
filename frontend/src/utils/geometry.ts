/**
 * Чистые геометрические функции, используемые FloorPlanCanvas для
 * примагничивания, обрезки по столкновению и угловой магнитности. Вынесены
 * отдельно, т.к. не зависят от DOM/Konva и тестируются в несколько строк.
 */

export type WallEndpoint = { x: number; y: number };

const GUIDE_SNAP_TOLERANCE_DEG = 5;

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

/** Ближайшая к angleDeg направляющая линия из [0, 45, 90, 135] (0..135), либо null. */
export function findSnappedGuideLineDeg(angleDeg: number): number | null {
  const nearestMultiple = Math.round(angleDeg / 45) * 45;
  if (Math.abs(angleDiffDeg(angleDeg, nearestMultiple)) > GUIDE_SNAP_TOLERANCE_DEG) {
    return null;
  }
  return ((nearestMultiple % 180) + 180) % 180;
}
