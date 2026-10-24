import { describe, expect, it } from 'vitest';
import {
  endGuideLinesDeg,
  endSectorGeometry,
  faceForwardGeometry,
  findFaceHug,
  isInSector,
  nextDrawMode,
  type WallBody,
} from './wallStart';

type P = { x: number; y: number };

/**
 * Прямая стена как тело для findFaceHug. Полигон — в порядке buildSegmentPolygon:
 * [левая-у-начала, левая-у-конца, правая-у-конца, правая-у-начала], левая грань —
 * сторона +perp, perp = (−dir.y, dir.x). cap — на сколько торец выступает за ось.
 */
function body(id: string, start: P, end: P, half: number, cap = 0): WallBody {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  const px = -uy;
  const py = ux;
  const at = (along: number, side: number): P => ({
    x: start.x + ux * along + px * half * side,
    y: start.y + uy * along + py * half * side,
  });
  return {
    id,
    start,
    end,
    halfThickness: half,
    polygon: [at(-cap, 1), at(length + cap, 1), at(length + cap, -1), at(-cap, -1)],
  };
}

const RADIUS = 12;
const NEW_HALF = 5;

// Горизонтальная стена (0,0)→(100,0) толщиной 10, торцы выступают на 5: левая грань (+y) — y=5, правая — y=−5.
const horizontal = body('a', { x: 0, y: 0 }, { x: 100, y: 0 }, 5, 5);

describe('findFaceHug — призрак прилегает к грани снаружи', () => {
  it('курсор над стеной — правая грань, квадрат вплотную снаружи', () => {
    const hug = findFaceHug({ x: 50, y: -10 }, [horizontal], NEW_HALF, RADIUS)!;
    expect(hug.wallId).toBe('a');
    expect(hug.side).toBe('right');
    expect(hug.contact.x).toBeCloseTo(50);
    expect(hug.contact.y).toBeCloseTo(-5);
    expect(hug.ghostCenter.x).toBeCloseTo(50);
    expect(hug.ghostCenter.y).toBeCloseTo(-10);
    expect(hug.normal.x).toBeCloseTo(0);
    expect(hug.normal.y).toBeCloseTo(-1);
    expect(hug.tangent.x).toBeCloseTo(1);
  });

  it('курсор внутри тела — ближайшая грань, а не центр стены', () => {
    const hug = findFaceHug({ x: 50, y: 2 }, [horizontal], NEW_HALF, RADIUS)!;
    expect(hug.side).toBe('left');
    expect(hug.contact.y).toBeCloseTo(5);
    expect(hug.ghostCenter.y).toBeCloseTo(10);
  });

  it('курсор ровно на оси — левая грань, призрак не остаётся на оси', () => {
    const hug = findFaceHug({ x: 50, y: 0 }, [horizontal], NEW_HALF, RADIUS)!;
    expect(hug.side).toBe('left');
    expect(hug.ghostCenter.y).toBeCloseTo(10);
  });

  it('курсор далеко от грани — привязки нет', () => {
    expect(findFaceHug({ x: 50, y: -30 }, [horizontal], NEW_HALF, RADIUS)).toBeNull();
  });

  it('радиус отсчитывается от грани: 11 — внутри, 13 — снаружи', () => {
    expect(findFaceHug({ x: 50, y: -16 }, [horizontal], NEW_HALF, RADIUS)).not.toBeNull();
    expect(findFaceHug({ x: 50, y: -18 }, [horizontal], NEW_HALF, RADIUS)).toBeNull();
  });

  it('у торца призрак встаёт заподлицо и не свешивается за него', () => {
    const atStart = findFaceHug({ x: -3, y: -10 }, [horizontal], NEW_HALF, RADIUS)!;
    // Грань идёт от x=−5; центр квадрата шириной 10 — не левее x=0.
    expect(atStart.ghostCenter.x).toBeCloseTo(0);
    expect(atStart.contact.x).toBeCloseTo(0);

    const atEnd = findFaceHug({ x: 104, y: -10 }, [horizontal], NEW_HALF, RADIUS)!;
    expect(atEnd.ghostCenter.x).toBeCloseTo(100);
  });

  it('курсор за торцом (не над гранью) — призрак отпускается, а не прыгает назад (как у RemPlanner)', () => {
    expect(findFaceHug({ x: 112, y: -8 }, [horizontal], NEW_HALF, RADIUS)).toBeNull();
    expect(findFaceHug({ x: 108, y: -10 }, [horizontal], NEW_HALF, RADIUS)).toBeNull();
  });

  it('грань короче призрака — центр посередине грани', () => {
    const short = body('s', { x: 0, y: 0 }, { x: 4, y: 0 }, 5, 5);
    // Грань x ∈ [−5, 9], длина 14 < 20 (толщина призрака 20).
    const hug = findFaceHug({ x: 2, y: -10 }, [short], 10, RADIUS + 10)!;
    expect(hug.ghostCenter.x).toBeCloseTo(2);
  });

  it('косая стена — нормаль и касательная повёрнуты, призрак вплотную к косой грани', () => {
    const diagonal = body('d', { x: 0, y: 0 }, { x: 100, y: 100 }, 5);
    const k = Math.SQRT1_2;
    // Точка оси (50,50) и сдвиг на 8 в сторону +perp = (−k, k).
    const cursor = { x: 50 - 8 * k, y: 50 + 8 * k };
    const hug = findFaceHug(cursor, [diagonal], NEW_HALF, RADIUS)!;
    expect(hug.side).toBe('left');
    expect(hug.normal.x).toBeCloseTo(-k);
    expect(hug.normal.y).toBeCloseTo(k);
    expect(hug.tangent.x).toBeCloseTo(k);
    expect(hug.contact.x).toBeCloseTo(50 - 5 * k);
    expect(hug.contact.y).toBeCloseTo(50 + 5 * k);
    expect(hug.ghostCenter.x).toBeCloseTo(50 - 10 * k);
    expect(hug.ghostCenter.y).toBeCloseTo(50 + 10 * k);
  });

  it('участок грани, занятый приставленной стеной, обходится — призрак сдвигается на свободное место', () => {
    // Стена b приставлена к левой грани (y=5) в x=50, ширина 10: занимает x ∈ [45, 55].
    const attached = body('b', { x: 50, y: 5 }, { x: 50, y: 100 }, 5);
    const hug = findFaceHug({ x: 50, y: 5.5 }, [horizontal, attached], NEW_HALF, RADIUS)!;
    expect(hug.wallId).toBe('a');
    expect(hug.contact.y).toBeCloseTo(5);
    // Свободно x ∈ [−5, 45] и [55, 105]; квадрат шириной 10 — центр не ближе 10 от x=50.
    expect(Math.abs(hug.contact.x - 50)).toBeGreaterThanOrEqual(10 - 1e-6);
  });

  it('курсор внутри приставленной стены — ближняя грань приставленной, а не чужая', () => {
    const attached = body('b', { x: 50, y: 5 }, { x: 50, y: 100 }, 5);
    const hug = findFaceHug({ x: 47, y: 40 }, [horizontal, attached], NEW_HALF, RADIUS)!;
    expect(hug.wallId).toBe('b');
    expect(hug.contact.x).toBeCloseTo(45);
    expect(hug.contact.y).toBeCloseTo(40);
    expect(hug.ghostCenter.x).toBeCloseTo(40);
  });

  it('стен нет — привязки нет', () => {
    expect(findFaceHug({ x: 0, y: 0 }, [], NEW_HALF, RADIUS)).toBeNull();
  });
});

describe('nextDrawMode — куда пошла протяжка от грани (правила RemPlanner)', () => {
  // t = 10: квадрат призрака — |b| ≤ 5 и 0 ≤ a ≤ 10 (a — от грани наружу, b — вдоль грани).
  const t = 10;

  it('внутри квадрата призрака режим не выбран', () => {
    expect(nextDrawMode('none', 2, 3, t)).toBe('none');
    expect(nextDrawMode('none', 9, 4, t)).toBe('none');
    expect(nextDrawMode('none', 10, 5, t)).toBe('none');
    expect(nextDrawMode('none', 0, 0, t)).toBe('none');
  });

  it('вышли за полосу квадрата (a > толщины) — вперёд', () => {
    expect(nextDrawMode('none', 11, 0, t)).toBe('forward');
    expect(nextDrawMode('none', 11, 3, t)).toBe('forward');
    expect(nextDrawMode('none', 25, 90, t)).toBe('forward');
  });

  it('вышли вбок, оставаясь в полосе, — параллельно грани уже с b > полутолщины', () => {
    expect(nextDrawMode('none', 9, 6, t)).toBe('parallel');
    expect(nextDrawMode('none', 8, 12, t)).toBe('parallel');
    expect(nextDrawMode('none', 3, -7, t)).toBe('parallel');
  });

  it('курсор в стене-хозяине (a < 0) — вперёд, дальше его остановит столкновение', () => {
    expect(nextDrawMode('none', -1, 0, t)).toBe('forward');
    expect(nextDrawMode('none', -8, 3, t)).toBe('forward');
  });

  it('выбранный режим липкий, пока курсор не вернулся в квадрат', () => {
    expect(nextDrawMode('forward', 9, 30, t)).toBe('forward');
    expect(nextDrawMode('parallel', 40, 30, t)).toBe('parallel');
    expect(nextDrawMode('parallel', 40, 2, t)).toBe('parallel');
  });

  it('возврат в квадрат сбрасывает режим', () => {
    expect(nextDrawMode('parallel', 8, 2, t)).toBe('none');
    expect(nextDrawMode('forward', 6, -3, t)).toBe('none');
  });
});

describe('faceForwardGeometry — режим «вперёд» от грани: ±45° от нормали', () => {
  // Хозяин горизонтален, нормаль наружу — вверх (−y), вдоль грани — вправо (+x).
  const normal = { x: 0, y: -1 };
  const tangent = { x: 1, y: 0 };
  const TOLERANCE = 5;
  const up = (a: number, b: number) => faceForwardGeometry({ x: b, y: -a }, normal, tangent, TOLERANCE, true);

  it('курсор прямо над стартом — вдоль нормали, длина по курсору', () => {
    const g = up(50, 0);
    expect(g.lengthPx).toBeCloseTo(50);
    expect(g.angleDeg).toBeCloseTo(-90);
    expect(g.clamped).toBe(false);
  });

  it('внутри сектора и вдали от направляющих — точно по курсору', () => {
    // a=45, b=30: 33.7° от нормали, до линий 0° и 45° далеко.
    const g = up(45, 30);
    expect(g.lengthPx).toBeCloseTo(Math.hypot(45, 30));
    expect(g.angleDeg).toBeCloseTo((Math.atan2(-45, 30) * 180) / Math.PI);
    expect(g.snappedLineDeg).toBeNull();
  });

  it('пологий курсор (15° над гранью) прижимается к линии 45° — длина проекции, как у RemPlanner', () => {
    // RemPlanner: старт (−80,−25), курсор (10,−50) → стена под −45° длиной 81.32.
    const g = up(25, 90);
    expect(g.clamped).toBe(true);
    expect(g.angleDeg).toBeCloseTo(-45);
    expect(g.lengthPx).toBeCloseTo(81.32, 1);
  });

  it('пологий курсор влево — 45° с другой стороны (−135°)', () => {
    const g = up(52.5, -52.5 - 20);
    expect(g.clamped).toBe(true);
    expect(g.angleDeg).toBeCloseTo(-135);
  });

  it('рядом с направляющей 45° (в пределах 5) — магнитится к ней', () => {
    // a=47, b=45: 43.7° от нормали, до линии 45° расстояние ≈ 1.4.
    const g = up(47, 45);
    expect(g.angleDeg).toBeCloseTo(-45);
    expect(g.snappedLineDeg).not.toBeNull();
  });

  it('рядом с нормалью магнитится к ней; Shift (без магнетизма) оставляет курсор', () => {
    const snapped = up(60, 3);
    expect(snapped.angleDeg).toBeCloseTo(-90);
    expect(snapped.lengthPx).toBeCloseTo(60);

    const free = faceForwardGeometry({ x: 3, y: -60 }, normal, tangent, TOLERANCE, false);
    expect(free.angleDeg).toBeCloseTo((Math.atan2(-60, 3) * 180) / Math.PI);
    expect(free.lengthPx).toBeCloseTo(Math.hypot(3, 60));
  });

  it('косая стена: сектор считается от её нормали, а не от мировых осей', () => {
    // Хозяин под 45°: касательная (k, k), нормаль наружу (k, −k) — вправо-вверх.
    const k = Math.SQRT1_2;
    const g = faceForwardGeometry({ x: 50 * k, y: -50 * k }, { x: k, y: -k }, { x: k, y: k }, TOLERANCE, true);
    expect(g.lengthPx).toBeCloseTo(50);
    expect(g.angleDeg).toBeCloseTo(-45);
    expect(g.clamped).toBe(false);
  });

  it('курсор «под» гранью (внутри хозяина) не даёт стену внутрь — луч уходит на линию 45° наружу', () => {
    const g = up(-8, 30);
    expect(g.clamped).toBe(true);
    expect(g.angleDeg).toBeCloseTo(-45);
  });
});

describe('endSectorGeometry — построение от торца: 180° + по 45° с каждой стороны (±135°)', () => {
  // Торец стены, продолжение идёт вправо (+x), «сторона» — вниз (+y), тело стены — слева.
  const forward = { x: 1, y: 0 };
  const side = { x: 0, y: 1 };
  const TOLERANCE = 5;
  const geometry = (x: number, y: number, snap = true) =>
    endSectorGeometry({ x, y }, forward, side, TOLERANCE, snap);

  it('прямо вперёд — продолжение стены, длина по курсору', () => {
    const g = geometry(50, 0);
    expect(g.angleDeg).toBeCloseTo(0);
    expect(g.lengthPx).toBeCloseTo(50);
    expect(g.clamped).toBe(false);
  });

  it('под прямым углом в обе стороны — без ограничений', () => {
    expect(geometry(0, 40).angleDeg).toBeCloseTo(90);
    expect(geometry(0, -40).angleDeg).toBeCloseTo(-90);
    expect(geometry(0, 40).clamped).toBe(false);
  });

  it('назад на 120° (в пределах ±135°) — разрешено, направление по курсору', () => {
    // (−30, 52) — 120° от продолжения; до линий 90° и 135° дальше допуска.
    const g = geometry(-30, 52);
    expect(g.clamped).toBe(false);
    expect(g.angleDeg).toBeCloseTo((Math.atan2(52, -30) * 180) / Math.PI);
    expect(g.lengthPx).toBeCloseTo(Math.hypot(30, 52));
  });

  it('в запретном секторе (150° назад) курсор прижимается к границе 135°, длина — проекция', () => {
    const g = geometry(-52, 30);
    expect(g.clamped).toBe(true);
    expect(g.angleDeg).toBeCloseTo(135);
    expect(g.lengthPx).toBeCloseTo(-52 * Math.cos((135 * Math.PI) / 180) + 30 * Math.sin((135 * Math.PI) / 180));
  });

  it('то же с другой стороны: граница −135°', () => {
    const g = geometry(-46, -39);
    expect(g.clamped).toBe(true);
    expect(g.angleDeg).toBeCloseTo(-135);
  });

  it('прямо назад вдоль стены — на границу, а не поверх стены', () => {
    const g = geometry(-60, 0);
    expect(g.clamped).toBe(true);
    expect(Math.abs(g.angleDeg)).toBeCloseTo(135);
  });

  it('рядом с направляющей 45° магнитится к ней', () => {
    const g = geometry(50, 48);
    expect(g.angleDeg).toBeCloseTo(45);
    expect(g.snappedLineDeg).not.toBeNull();
  });

  it('направляющая 135° есть и работает только «вперёд» своим лучом, а не продолжением в обратную сторону', () => {
    // Курсор на −45° (вперёд-вверх) лежит на продолжении линии 135°, но к ней магнититься не должен.
    const g = geometry(50, -50);
    expect(g.angleDeg).toBeCloseTo(-45);
    const near135 = geometry(-48, 50);
    expect(near135.angleDeg).toBeCloseTo(135);
  });

  it('Shift отключает магнит — направление строго по курсору', () => {
    const g = geometry(50, 48, false);
    expect(g.angleDeg).toBeCloseTo((Math.atan2(48, 50) * 180) / Math.PI);
    expect(g.snappedLineDeg).toBeNull();
  });

  it('косая стена: сектор считается от её направления', () => {
    const f = { x: 0.6, y: 0.8 };
    const s = { x: -0.8, y: 0.6 };
    const g = endSectorGeometry({ x: 30, y: 40 }, f, s, TOLERANCE, true);
    expect(g.angleDeg).toBeCloseTo((Math.atan2(0.8, 0.6) * 180) / Math.PI);
    expect(g.lengthPx).toBeCloseTo(50);
  });
});

describe('isInSector и endGuideLinesDeg', () => {
  const forward = { x: 1, y: 0 };
  const side = { x: 0, y: 1 };

  it('точка в запретном секторе позади торца не принадлежит допустимому', () => {
    expect(isInSector({ x: -10, y: 0 }, forward, side, 135)).toBe(false);
    expect(isInSector({ x: -52, y: 30 }, forward, side, 135)).toBe(false);
  });

  it('точки впереди и по бокам принадлежат', () => {
    expect(isInSector({ x: 10, y: 0 }, forward, side, 135)).toBe(true);
    expect(isInSector({ x: 0, y: 30 }, forward, side, 135)).toBe(true);
    expect(isInSector({ x: -30, y: 52 }, forward, side, 135)).toBe(true);
  });

  it('линии направляющих — четыре прямые через 45° от продолжения', () => {
    const lines = endGuideLinesDeg({ x: 1, y: 0 }).map((a) => Math.round(a)).sort((a, b) => a - b);
    expect(lines).toEqual([0, 45, 90, 135]);
  });
});
