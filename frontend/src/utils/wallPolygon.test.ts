import { describe, expect, it } from 'vitest';
import { buildSegmentPolygon, computeNodeFaceVertices, type NodeRay } from './wallPolygon';

function ray(key: string, dir: { x: number; y: number }, halfThickness: number): NodeRay {
  const len = Math.hypot(dir.x, dir.y);
  return { key, dir: { x: dir.x / len, y: dir.y / len }, halfThickness };
}

describe('computeNodeFaceVertices — вырожденный случай: свободный конец', () => {
  it('один луч — плоский торец ровно в узле, без выступа (как у RemPlanner)', () => {
    const node = { x: 100, y: 100 };
    const faces = computeNodeFaceVertices(node, [ray('a', { x: 1, y: 0 }, 10)]);

    const face = faces.get('a')!;
    // Направление (1,0), perp = (0,1): вершины торца лежат на перпендикуляре к
    // оси, проходящем через сам узел.
    expect(face.left).toEqual({ x: 100, y: 110 });
    expect(face.right).toEqual({ x: 100, y: 90 });
  });

  it('торец перпендикулярен оси при любом направлении стены', () => {
    const node = { x: 0, y: 0 };
    const face = computeNodeFaceVertices(node, [ray('a', { x: 3, y: 4 }, 5)]).get('a')!;
    // Ось (0.6, 0.8): торец — отрезок длиной 10, перпендикулярный оси, середина в узле.
    expect((face.left.x + face.right.x) / 2).toBeCloseTo(0);
    expect((face.left.y + face.right.y) / 2).toBeCloseTo(0);
    expect(Math.hypot(face.left.x - face.right.x, face.left.y - face.right.y)).toBeCloseTo(10);
    const along = (face.left.x - face.right.x) * 0.6 + (face.left.y - face.right.y) * 0.8;
    expect(along).toBeCloseTo(0);
  });
});

describe('computeNodeFaceVertices — свободный конец упирается в грань другой стены', () => {
  it('перпендикулярно — торец ровно по грани, без выступа', () => {
    // Стена идёт вверх (−y) от узла (100,100), лежащего на грани y=100 горизонтальной стены.
    const node = { x: 100, y: 100 };
    const faces = computeNodeFaceVertices(node, [ray('a', { x: 0, y: -1 }, 5)], {
      point: { x: 0, y: 100 },
      dir: { x: 1, y: 0 },
    });
    const face = faces.get('a')!;
    expect(face.left.y).toBeCloseTo(100);
    expect(face.right.y).toBeCloseTo(100);
    expect(Math.abs(face.left.x - face.right.x)).toBeCloseTo(10);
  });

  it('под углом — обе вершины на линии грани, торец скошен', () => {
    const node = { x: 100, y: 100 };
    const faces = computeNodeFaceVertices(node, [ray('a', { x: 1, y: -1 }, 5)], {
      point: { x: 0, y: 100 },
      dir: { x: 1, y: 0 },
    });
    const face = faces.get('a')!;
    expect(face.left.y).toBeCloseTo(100);
    expect(face.right.y).toBeCloseTo(100);
    // Сечение 10 под 45° к грани — по грани оно растягивается до 10·√2.
    expect(Math.abs(face.left.x - face.right.x)).toBeCloseTo(10 * Math.SQRT2);
  });

  it('стена параллельна грани — упора нет, обычный плоский торец', () => {
    const node = { x: 100, y: 100 };
    const faces = computeNodeFaceVertices(node, [ray('a', { x: 1, y: 0 }, 10)], {
      point: { x: 0, y: 100 },
      dir: { x: 1, y: 0 },
    });
    expect(faces.get('a')!.left).toEqual({ x: 100, y: 110 });
  });
});

describe('computeNodeFaceVertices — вырожденный случай: коллинеарные рёбра', () => {
  it('прямое продолжение стены (180° друг от друга, одна толщина) — вершины совпадают у обоих лучей', () => {
    const node = { x: 0, y: 0 };
    const faces = computeNodeFaceVertices(node, [
      ray('a', { x: 1, y: 0 }, 10),
      ray('b', { x: -1, y: 0 }, 10),
    ]);

    const a = faces.get('a')!;
    const b = faces.get('b')!;
    // Одна толщина — левая грань одного луча это и есть правая грань другого:
    // прямая линия без излома, ровно две вершины на весь узел.
    expect(a.left).toEqual(b.right);
    expect(a.right).toEqual(b.left);
  });

  it('разная толщина на прямом стыке — вершины не совпадают (ступенька), но не падает', () => {
    const node = { x: 0, y: 0 };
    const faces = computeNodeFaceVertices(node, [
      ray('a', { x: 1, y: 0 }, 10),
      ray('b', { x: -1, y: 0 }, 5),
    ]);

    const a = faces.get('a')!;
    const b = faces.get('b')!;
    expect(a.left).not.toEqual(b.right);
    expect(Number.isFinite(a.left.x)).toBe(true);
    expect(Number.isFinite(b.right.x)).toBe(true);
  });
});

describe('computeNodeFaceVertices — прямой угол (90°)', () => {
  it('делит обе вершины угла между двумя стенами — совпадение до 0.01', () => {
    // Горизонтальная стена входит в узел (100,0) как конец (луч смотрит
    // назад, на запад); вертикальная выходит из узла как начало (луч
    // смотрит вниз, на юг). Толщина обеих 20 (h=10). Вручную выведено и
    // проверено: внешняя вершина (110,-10), внутренняя (90,10).
    const node = { x: 100, y: 0 };
    const faces = computeNodeFaceVertices(node, [
      ray('horizontal:end', { x: -1, y: 0 }, 10),
      ray('vertical:start', { x: 0, y: 1 }, 10),
    ]);

    const horizontal = faces.get('horizontal:end')!;
    const vertical = faces.get('vertical:start')!;

    // canonical-left горизонтальной стены на конце = right-луча (см. swap
    // в buildSegmentPolygon) — но здесь напрямую сверяем сырые вершины
    // граней луча, поэтому используем left/right как посчитано для самого
    // луча (не канонические стороны сегмента).
    const points = [horizontal.left, horizontal.right, vertical.left, vertical.right];
    const outer = points.find((p) => Math.abs(p.x - 110) < 0.01 && Math.abs(p.y - -10) < 0.01);
    const inner = points.find((p) => Math.abs(p.x - 90) < 0.01 && Math.abs(p.y - 10) < 0.01);
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();

    // Обе стены используют РОВНО ОДНИ И ТЕ ЖЕ ДВЕ точки в этом узле —
    // это и есть "делят вершину", а не совпадают по координатам.
    expect([horizontal.left, horizontal.right]).toEqual(
      expect.arrayContaining([outer, inner]),
    );
    expect([vertical.left, vertical.right]).toEqual(
      expect.arrayContaining([outer, inner]),
    );
  });

  it('работает не только для 90°, но и для произвольного угла (91.9°, как в эталоне TASKS.md)', () => {
    const node = { x: 0, y: 0 };
    const angleDeg = 91.9;
    const rad = (angleDeg * Math.PI) / 180;
    const faces = computeNodeFaceVertices(node, [
      ray('a', { x: -1, y: 0 }, 10),
      ray('b', { x: Math.cos(rad), y: Math.sin(rad) }, 10),
    ]);

    const a = faces.get('a')!;
    const b = faces.get('b')!;
    // Обе стены снова должны делить одну и ту же пару вершин.
    const aPoints = [a.left, a.right].sort((p, q) => p.x - q.x);
    const bPoints = [b.left, b.right].sort((p, q) => p.x - q.x);
    expect(aPoints[0].x).toBeCloseTo(bPoints[0].x, 6);
    expect(aPoints[0].y).toBeCloseTo(bPoints[0].y, 6);
    expect(aPoints[1].x).toBeCloseTo(bPoints[1].x, 6);
    expect(aPoints[1].y).toBeCloseTo(bPoints[1].y, 6);
  });
});

describe('computeNodeFaceVertices — вырожденный случай: очень острый угол (miter limit)', () => {
  it('угол настолько острый, что "ус" ушёл бы очень далеко — переходит на срез рядом с узлом', () => {
    const node = { x: 0, y: 0 };
    const halfThickness = 5;
    const rad = (10 * Math.PI) / 180; // 10° между лучами — очень острый клин
    const faces = computeNodeFaceVertices(node, [
      ray('a', { x: 1, y: 0 }, halfThickness),
      ray('b', { x: Math.cos(rad), y: Math.sin(rad) }, halfThickness),
    ]);

    for (const face of [faces.get('a')!, faces.get('b')!]) {
      const distLeft = Math.hypot(face.left.x - node.x, face.left.y - node.y);
      const distRight = Math.hypot(face.right.x - node.x, face.right.y - node.y);
      // Без ограничения "ус" пересечения был бы ~h/sin(5°) ≈ 57 — стена
      // "улетела" бы далеко за пределы разумного. Со срезом вершины лежат
      // у самого узла (на расстоянии половины толщины), а не в 50+ px.
      expect(distLeft).toBeLessThan(halfThickness * 2);
      expect(distRight).toBeLessThan(halfThickness * 2);
    }
  });

  it('умеренный угол не задевает ограничение — обычный митр (одна вершина, а не срез)', () => {
    const node = { x: 0, y: 0 };
    const halfThickness = 5;
    const rad = (60 * Math.PI) / 180;
    const faces = computeNodeFaceVertices(node, [
      ray('a', { x: 1, y: 0 }, halfThickness),
      ray('b', { x: Math.cos(rad), y: Math.sin(rad) }, halfThickness),
    ]);
    const a = faces.get('a')!;
    const b = faces.get('b')!;
    // При обычном митре одна из вершин общая для обеих стен (а не у самого узла).
    const shared =
      (Math.abs(a.left.x - b.right.x) < 1e-6 && Math.abs(a.left.y - b.right.y) < 1e-6) ||
      (Math.abs(a.right.x - b.left.x) < 1e-6 && Math.abs(a.right.y - b.left.y) < 1e-6);
    expect(shared).toBe(true);
  });
});

describe('computeNodeFaceVertices — вырожденный случай: три и более рёбер (T-стык)', () => {
  it('три ребра дают три различные вершины, каждое ребро использует две из них', () => {
    const node = { x: 0, y: 0 };
    const faces = computeNodeFaceVertices(node, [
      ray('west', { x: -1, y: 0 }, 10),
      ray('east', { x: 1, y: 0 }, 10),
      ray('south', { x: 0, y: 1 }, 10),
    ]);

    expect(faces.size).toBe(3);
    const west = faces.get('west')!;
    const east = faces.get('east')!;
    const south = faces.get('south')!;

    const allPoints = [west.left, west.right, east.left, east.right, south.left, south.right];
    const distinct = new Set(allPoints.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    // Три клина вокруг узла -> три вершины, каждая используется двумя
    // соседними лучами -> 6 упоминаний, но ровно 3 различных точки.
    expect(distinct.size).toBe(3);
  });
});

describe('buildSegmentPolygon', () => {
  it('собирает четырёхугольник рядового ребра в порядке обхода без самопересечений', () => {
    // Прямая стена без стыков (два свободных конца) — прямоугольник ровно от
    // узла до узла, торцы не выступают.
    const startNode = { x: 0, y: 0 };
    const endNode = { x: 100, y: 0 };
    const startFaces = computeNodeFaceVertices(startNode, [ray('s', { x: 1, y: 0 }, 10)]);
    const endFaces = computeNodeFaceVertices(endNode, [ray('s', { x: -1, y: 0 }, 10)]);

    const polygon = buildSegmentPolygon(startFaces.get('s')!, endFaces.get('s')!);

    expect(polygon).toEqual([
      { x: 0, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: -10 },
      { x: 0, y: -10 },
    ]);
  });
});
