import type { WallEndpoint } from './geometry';

/**
 * Геометрия полигона стены: у каждого ребра графа — две грани, смещённые от
 * оси на ±t/2, а вершина угла в узле — точка пересечения граней СМЕЖНЫХ
 * рёбер, а не отдельное состояние (как было с "квадратным торцом" до
 * Этапа 5). Функции здесь чистые и не знают ни про Konva, ни про см/px —
 * координаты те, что переданы (обычно px, см. FloorPlanCanvas).
 */

/** Луч из узла в сторону одного конца одного ребра — единица данных для computeNodeFaceVertices. */
export interface NodeRay {
  /** Идентификатор конца ребра (например, `${segmentId}:start`), по которому потом ищется результат. */
  key: string;
  /** Единичный вектор направления ОТ узла В сторону ребра. */
  dir: WallEndpoint;
  /** Половина толщины этого ребра. */
  halfThickness: number;
}

/** Две вершины полигона, которые ребро получает в этом узле на своей "левой"/"правой" грани (см. rotate90). */
export interface NodeFaceVertex {
  left: WallEndpoint;
  right: WallEndpoint;
}

// Аналог stroke-miterlimit: во сколько раз "ус" пересечения граней может
// быть длиннее половины толщины, прежде чем считать угол слишком острым и
// переходить на срез. 4 — типичное значение по умолчанию для этого приёма
// в 2D-графике (SVG использует его как стандарт).
const MITER_LIMIT = 4;

// Синус угла между направлениями меньше этого значения считаем нулём —
// лучи коллинеарны, грани параллельны, у пересечения прямых нет решения.
const COLLINEAR_SIN_EPS = 1e-6;

function rotate90(d: WallEndpoint): WallEndpoint {
  return { x: -d.y, y: d.x };
}

/**
 * Вершины на стыке двух УГЛОВО СМЕЖНЫХ (идущих подряд при сортировке по
 * углу вокруг узла) лучей rayA → rayB. Возвращает всегда пару точек:
 *  - обычный случай — обе точки совпадают (одна общая вершина угла,
 *    "ус" пересечения правой грани rayA и левой грани rayB);
 *  - вырожденные случаи (коллинеарные лучи, критично острый угол) —
 *    точки РАЗНЫЕ: каждый луч получает собственную вершину у самого узла,
 *    без вытягивания навстречу другому (см. комментарии внутри).
 */
function wedgeVertices(node: WallEndpoint, rayA: NodeRay, rayB: NodeRay): [WallEndpoint, WallEndpoint] {
  const perpA = rotate90(rayA.dir);
  const perpB = rotate90(rayB.dir);

  // "Правая" грань rayA (смещение -perp) и "левая" грань rayB (смещение
  // +perp) — это как раз та пара граней, что обращена друг к другу в
  // клине между rayA и следующим за ним по кругу rayB (выведено и
  // проверено на примере прямого угла — см. wallPolygon.test.ts).
  const rightA: WallEndpoint = {
    x: node.x - perpA.x * rayA.halfThickness,
    y: node.y - perpA.y * rayA.halfThickness,
  };
  const leftB: WallEndpoint = {
    x: node.x + perpB.x * rayB.halfThickness,
    y: node.y + perpB.y * rayB.halfThickness,
  };

  const cross = rayA.dir.x * rayB.dir.y - rayA.dir.y * rayB.dir.x;
  if (Math.abs(cross) < COLLINEAR_SIN_EPS) {
    // Вырожденный случай: коллинеарные рёбра (стена продолжается "напролёт"
    // без излома, либо ребро идёт назад само на себя). Грани параллельны —
    // пересечения нет. При одинаковой толщине с обеих сторон rightA и leftB
    // и так совпадают (одна и та же линия); при разной — каждое ребро
    // получает свою точку у узла, стык выглядит небольшой ступенькой,
    // что и ожидается при переходе толщины.
    return [rightA, leftB];
  }

  // Пересечение прямой (rightA, rayA.dir) и прямой (leftB, rayB.dir).
  const t =
    ((leftB.x - rightA.x) * rayB.dir.y - (leftB.y - rightA.y) * rayB.dir.x) / cross;
  const vertex: WallEndpoint = { x: rightA.x + rayA.dir.x * t, y: rightA.y + rayA.dir.y * t };

  const miterLength = Math.hypot(vertex.x - node.x, vertex.y - node.y);
  const limit = MITER_LIMIT * Math.max(rayA.halfThickness, rayB.halfThickness);
  if (miterLength > limit) {
    // Вырожденный случай: очень острый угол — точка пересечения граней
    // уходит на miterLength от узла, дальше разумного предела (аналог
    // stroke-miterlimit). Переходим на срез: вместо далёкого "уса" каждое
    // ребро получает свою вершину прямо у узла (как в коллинеарном
    // случае) — угол получает плоский срез вместо вылетающего шпиля.
    return [rightA, leftB];
  }

  return [vertex, vertex];
}

/**
 * Для всех рёбер, сходящихся в одном узле, считает вершины полигона на
 * "левой" и "правой" грани каждого — это и есть углы стыка, вычисленные
 * заново из текущей геометрии, а не накопленное состояние (ср. удалённый
 * rebuildJoints/setStartExtension). Вырожденные случаи:
 *  - ноль лучей — пустой результат;
 *  - один луч (свободный конец) — "квадратный" торец (как stroke-linecap:
 *    square): точка выступает на halfThickness НАРУЖУ, в сторону,
 *    противоположную направлению луча, и уже от неё берутся обе вершины
 *    по перпендикуляру — а не плоский срез ровно по узлу;
 *  - два и более лучей — сортируем по углу вокруг узла и для каждой пары
 *    угловых соседей (по кругу, включая пару "последний-первый") считаем
 *    одну вершину через wedgeVertices; у ребра с N соседями получается
 *    ровно две вершины — от соседа справа и от соседа слева по кругу.
 *    Обобщается на любое число рёбер в узле (T-, X-стыки и т.д.).
 */
export function computeNodeFaceVertices(
  node: WallEndpoint,
  rays: readonly NodeRay[],
): Map<string, NodeFaceVertex> {
  const result = new Map<string, NodeFaceVertex>();

  if (rays.length === 0) {
    return result;
  }

  if (rays.length === 1) {
    // "Квадратный" торец: центр грани выступает на halfThickness за узел, в
    // сторону, ОБРАТНУЮ направлению луча (луч смотрит от узла В сторону
    // ребра, наружу — противоположное направление). Без этого выступа
    // свободный конец стены при рисовании визуально "терял" ту половину
    // площади призрака (wallGhost), что показывалась позади точки старта
    // ещё до первого движения мыши.
    const ray = rays[0];
    const perp = rotate90(ray.dir);
    const capCenter: WallEndpoint = {
      x: node.x - ray.dir.x * ray.halfThickness,
      y: node.y - ray.dir.y * ray.halfThickness,
    };
    result.set(ray.key, {
      left: { x: capCenter.x + perp.x * ray.halfThickness, y: capCenter.y + perp.y * ray.halfThickness },
      right: { x: capCenter.x - perp.x * ray.halfThickness, y: capCenter.y - perp.y * ray.halfThickness },
    });
    return result;
  }

  const sorted = [...rays].sort(
    (a, b) => Math.atan2(a.dir.y, a.dir.x) - Math.atan2(b.dir.y, b.dir.x),
  );
  const n = sorted.length;

  const rightVertexByKey = new Map<string, WallEndpoint>();
  const leftVertexByKey = new Map<string, WallEndpoint>();

  for (let k = 0; k < n; k++) {
    const rayA = sorted[k];
    const rayB = sorted[(k + 1) % n];
    const [pA, pB] = wedgeVertices(node, rayA, rayB);
    rightVertexByKey.set(rayA.key, pA);
    leftVertexByKey.set(rayB.key, pB);
  }

  for (const ray of rays) {
    result.set(ray.key, {
      right: rightVertexByKey.get(ray.key)!,
      left: leftVertexByKey.get(ray.key)!,
    });
  }

  return result;
}

/**
 * Собирает полигон ребра из вершин, посчитанных в его начальном и конечном
 * узлах. У начального узла луч ребра направлен "как канонически" (start→
 * end), поэтому его левая/правая грань — без изменений; у конечного узла
 * луч этого же ребра направлен НАЗАД (end→start, см. rebuildWallGeometry),
 * поэтому left/right, посчитанные там, соответствуют каноническим правой/
 * левой граням ребра в обратном порядке — отсюда swap ниже. Порядок точек
 * на выходе — обычный обход четырёхугольника (для рядового ребра без
 * среза): left-у-начала → left-у-конца → right-у-конца → right-у-начала.
 */
export function buildSegmentPolygon(
  startFace: NodeFaceVertex,
  endFace: NodeFaceVertex,
): WallEndpoint[] {
  const leftAtEnd = endFace.right;
  const rightAtEnd = endFace.left;
  return [startFace.left, leftAtEnd, rightAtEnd, startFace.right];
}
