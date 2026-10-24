/**
 * Столкновения рабочих мест со стенами и друг с другом — логика из
 * workplace-map (checkDeskCollision): стол нельзя поставить или дотащить
 * туда, где он перекрывает стену или другой стол. Там это SAT, но SAT
 * верен только для выпуклых фигур, а полигон стены с подрезкой на стыке
 * бывает невыпуклым — поэтому здесь общая проверка: пересечение рёбер
 * или вложенность одного многоугольника в другой.
 */

export interface Point {
  x: number;
  y: number;
}

/** Углы прямоугольника, повёрнутого вокруг левого верхнего угла (как Konva.Group стола). */
export function rectCorners(topLeft: Point, width: number, height: number, rotationDeg: number): Point[] {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const at = (dx: number, dy: number): Point => ({
    x: topLeft.x + dx * cos - dy * sin,
    y: topLeft.y + dx * sin + dy * cos,
  });
  return [at(0, 0), at(width, 0), at(width, height), at(0, height)];
}

/** Тот же прямоугольник, ужатый на inset со всех сторон: касание вплотную — не столкновение. */
export function shrinkRect(corners: readonly Point[], inset: number): Point[] {
  const cx = corners.reduce((sum, p) => sum + p.x, 0) / corners.length;
  const cy = corners.reduce((sum, p) => sum + p.y, 0) / corners.length;
  return corners.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const length = Math.hypot(dx, dy);
    // Угол прямоугольника лежит на диагонали — сдвиг на inset·√2 вдоль неё
    // отодвигает обе грани ровно на inset.
    const k = length === 0 ? 0 : Math.max(0, length - inset * Math.SQRT2) / length;
    return { x: cx + dx * k, y: cy + dy * k };
  });
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Перекрываются ли два многоугольника (любые, не обязательно выпуклые). */
export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return pointInPolygon(a[0]!, b) || pointInPolygon(b[0]!, a);
}
