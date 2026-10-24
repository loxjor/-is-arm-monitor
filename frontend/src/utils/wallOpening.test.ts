import { describe, expect, it } from 'vitest';
import type { WallOpening } from '../types/opening';
import { OPENING_DEFAULTS } from '../types/opening';
import { cm } from './scale';
import {
  clampOpeningOffset,
  doorLeafGeometry,
  openingAxisRange,
  openingCutPolygon,
  projectPointToSegmentOffset,
  redistributeOpeningsOnSplit,
} from './wallOpening';

function make(over: Partial<WallOpening> = {}): WallOpening {
  return {
    id: 'o1',
    segmentId: 's1',
    kind: 'door',
    offset: cm(50),
    width: cm(20),
    height: cm(210),
    sillHeight: cm(0),
    hinge: 'start',
    swing: 'left',
    ...over,
  };
}

describe('OPENING_DEFAULTS', () => {
  it('значения RemPlanner', () => {
    expect(OPENING_DEFAULTS.door.width).toBe(80);
    expect(OPENING_DEFAULTS.door_double.minWidth).toBe(100);
    expect(OPENING_DEFAULTS.window.sillHeight).toBe(85);
    expect(OPENING_DEFAULTS.windowway.maxHeight).toBe(200);
    expect(OPENING_DEFAULTS.doorway.sillHeight).toBe(0);
  });
});

describe('clampOpeningOffset', () => {
  it('внутри сегмента без соседей — без изменений', () => {
    expect(clampOpeningOffset(50, 20, 100, [])).toBe(50);
  });

  it('прижимает к началу и к концу', () => {
    expect(clampOpeningOffset(-5, 20, 100, [])).toBe(10);
    expect(clampOpeningOffset(500, 20, 100, [])).toBe(90);
  });

  it('проём ровно во всю длину — единственная позиция по центру', () => {
    expect(clampOpeningOffset(0, 100, 100, [])).toBe(50);
  });

  it('не помещается в сегмент — null', () => {
    expect(clampOpeningOffset(50, 120, 100, [])).toBeNull();
  });

  it('сдвигается к ближайшему краю соседа', () => {
    // сосед занимает [40, 60]; новый шириной 20 -> центр <=30 или >=70
    expect(clampOpeningOffset(45, 20, 200, [{ offset: 50, width: 20 }])).toBe(30);
    expect(clampOpeningOffset(55, 20, 200, [{ offset: 50, width: 20 }])).toBe(70);
  });

  it('касание краями допустимо', () => {
    expect(clampOpeningOffset(70, 20, 200, [{ offset: 50, width: 20 }])).toBe(70);
  });

  it('перепрыгивает через соседа, если с этой стороны нет места', () => {
    // сосед [0,30] у начала; желаемый центр 20 -> ближайший валидный 40
    expect(clampOpeningOffset(20, 20, 200, [{ offset: 15, width: 30 }])).toBe(40);
    // сосед у конца
    expect(clampOpeningOffset(180, 20, 200, [{ offset: 185, width: 30 }])).toBe(160);
  });

  it('между двумя соседями выбирает ближайший зазор', () => {
    const others = [
      { offset: 30, width: 20 }, // [20,40]
      { offset: 100, width: 20 }, // [90,110]
    ];
    // зазор между ними 50 -> центр в [50,80]
    expect(clampOpeningOffset(95, 20, 200, others)).toBe(80);
    expect(clampOpeningOffset(35, 20, 200, others)).toBe(50);
  });

  it('нет свободного места из-за соседей — null', () => {
    const others = [
      { offset: 25, width: 50 },
      { offset: 75, width: 50 },
    ];
    expect(clampOpeningOffset(50, 20, 100, others)).toBeNull();
  });

  it('нулевая и отрицательная длина сегмента — null', () => {
    expect(clampOpeningOffset(0, 10, 0, [])).toBeNull();
    expect(clampOpeningOffset(0, 10, -5, [])).toBeNull();
  });

  it('несуществующая длина (Infinity) — только нижняя граница', () => {
    expect(clampOpeningOffset(0, 20, Infinity, [])).toBe(10);
    expect(clampOpeningOffset(500, 20, Infinity, [])).toBe(500);
  });
});

describe('projectPointToSegmentOffset', () => {
  it('точка над серединой горизонтального сегмента', () => {
    const r = projectPointToSegmentOffset({ x: 30, y: 7 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(r.offset).toBeCloseTo(30);
    expect(r.distance).toBeCloseTo(7);
  });

  it('зажимает за пределы сегмента', () => {
    const a = projectPointToSegmentOffset({ x: -20, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    const b = projectPointToSegmentOffset({ x: 150, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(a.offset).toBe(0);
    expect(b.offset).toBe(100);
  });

  it('диагональный сегмент 3-4-5', () => {
    const r = projectPointToSegmentOffset({ x: 0, y: 5 }, { x: 0, y: 0 }, { x: 30, y: 40 });
    expect(r.offset).toBeCloseTo(4 * 1); // (0,5)·(0.6,0.8)=4
    expect(r.distance).toBeCloseTo(3);
  });

  it('сторона: +perp (y вниз для оси вправо) — left', () => {
    const left = projectPointToSegmentOffset({ x: 10, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    const right = projectPointToSegmentOffset({ x: 10, y: -4 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(left.side).toBe('left');
    expect(right.side).toBe('right');
  });

  it('вырожденный сегмент — offset 0', () => {
    const r = projectPointToSegmentOffset({ x: 3, y: 4 }, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(r.offset).toBe(0);
    expect(r.distance).toBeCloseTo(Math.hypot(2, 3));
  });

  it('расстояние — до проекции, а не до зажатой точки', () => {
    const r = projectPointToSegmentOffset({ x: 130, y: 5 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(r.distance).toBeCloseTo(5);
  });
});

describe('openingAxisRange', () => {
  it('центр ± половина ширины', () => {
    expect(openingAxisRange(make({ offset: cm(50), width: cm(20) }))).toEqual([40, 60]);
  });
});

describe('openingCutPolygon', () => {
  it('горизонтальная стена: прямоугольник на всю толщину, порядок left-start, left-end, right-end, right-start', () => {
    const poly = openingCutPolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, make());
    const expected = [
      { x: 40, y: 5 },
      { x: 60, y: 5 },
      { x: 60, y: -5 },
      { x: 40, y: -5 },
    ];
    poly.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i].x);
      expect(p.y).toBeCloseTo(expected[i].y);
    });
  });

  it('вертикальная стена', () => {
    const poly = openingCutPolygon({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, make());
    // dir=(0,1), perp=(-1,0)
    expect(poly[0].x).toBeCloseTo(-5);
    expect(poly[0].y).toBeCloseTo(40);
    expect(poly[2].x).toBeCloseTo(5);
    expect(poly[2].y).toBeCloseTo(60);
  });

  it('вырожденный сегмент — пустой массив', () => {
    expect(openingCutPolygon({ x: 1, y: 1 }, { x: 1, y: 1 }, 10, make())).toEqual([]);
  });
});

describe('doorLeafGeometry', () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 0 };

  it('петли у начала, открывание влево (+perp): петля на левой грани у левого края проёма', () => {
    const g = doorLeafGeometry(start, end, 10, make())!;
    expect(g.hinge.x).toBeCloseTo(40);
    expect(g.hinge.y).toBeCloseTo(5);
    // полотно перпендикулярно стене, длина = ширине, толщина 4
    const [p0, p1, p2, p3] = g.leaf;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeCloseTo(20);
    expect(p1.x).toBeCloseTo(40);
    expect(p1.y).toBeCloseTo(25);
    expect(Math.hypot(p3.x - p0.x, p3.y - p0.y)).toBeCloseTo(4);
    expect(p2.x).toBeCloseTo(44);
    expect(p2.y).toBeCloseTo(25);
  });

  it('дуга: центр в петле, радиус = ширина, 90 градусов от закрытого положения к открытому', () => {
    const g = doorLeafGeometry(start, end, 10, make())!;
    expect(g.arc.center).toEqual(g.hinge);
    expect(g.arc.radius).toBe(20);
    expect(g.arc.startAngle).toBeCloseTo(0); // вдоль оси к проёму
    expect(g.arc.endAngle).toBeCloseTo(90); // вдоль +perp (0,1)
  });

  it('петли у конца: петля у правого края, закрытое положение смотрит к началу', () => {
    const g = doorLeafGeometry(start, end, 10, make({ hinge: 'end' }))!;
    expect(g.hinge.x).toBeCloseTo(60);
    expect(g.hinge.y).toBeCloseTo(5);
    expect(g.arc.startAngle).toBeCloseTo(180);
    expect(g.arc.endAngle).toBeCloseTo(90);
    expect(g.leaf[3].x).toBeCloseTo(56);
  });

  it('открывание вправо: петля и полотно на стороне -perp', () => {
    const g = doorLeafGeometry(start, end, 10, make({ swing: 'right' }))!;
    expect(g.hinge.y).toBeCloseTo(-5);
    expect(g.leaf[1].y).toBeCloseTo(-25);
    expect(g.arc.startAngle).toBeCloseTo(0);
    expect(g.arc.endAngle).toBeCloseTo(-90);
  });

  it('повёрнутая стена: полотно остаётся перпендикулярным оси', () => {
    const g = doorLeafGeometry({ x: 0, y: 0 }, { x: 0, y: 100 }, 10, make())!;
    // dir=(0,1), perp=(-1,0): петля на (-5,40)
    expect(g.hinge.x).toBeCloseTo(-5);
    expect(g.hinge.y).toBeCloseTo(40);
    expect(g.leaf[1].x).toBeCloseTo(-25);
    expect(g.leaf[1].y).toBeCloseTo(40);
  });

  it('вырожденный сегмент — null', () => {
    expect(doorLeafGeometry(start, start, 10, make())).toBeNull();
  });
});

describe('redistributeOpeningsOnSplit', () => {
  const a = make({ id: 'a', offset: cm(20), width: cm(20) });
  const b = make({ id: 'b', offset: cm(80), width: cm(20) });
  const other = make({ id: 'x', segmentId: 'other', offset: cm(5) });

  it('проёмы уходят в свою половину, смещение пересчитывается для второй', () => {
    const r = redistributeOpeningsOnSplit([a, b, other], 's1', 50, 'n1', 'n2', 50);
    const ra = r.find((o) => o.id === 'a')!;
    const rb = r.find((o) => o.id === 'b')!;
    expect(ra.segmentId).toBe('n1');
    expect(ra.offset).toBe(20);
    expect(rb.segmentId).toBe('n2');
    expect(rb.offset).toBe(30);
  });

  it('проёмы других сегментов не затрагиваются, порядок сохраняется', () => {
    const r = redistributeOpeningsOnSplit([a, other, b], 's1', 50, 'n1', 'n2', 50);
    expect(r.map((o) => o.id)).toEqual(['a', 'x', 'b']);
    expect(r[1]).toBe(other);
  });

  it('не мутирует вход', () => {
    redistributeOpeningsOnSplit([a], 's1', 50, 'n1', 'n2', 50);
    expect(a.segmentId).toBe('s1');
    expect(a.offset).toBe(20);
  });

  it('центр ровно в точке разбиения уходит во вторую половину', () => {
    const c = make({ id: 'c', offset: cm(50), width: cm(20) });
    const r = redistributeOpeningsOnSplit([c], 's1', 50, 'n1', 'n2', 50);
    expect(r[0].segmentId).toBe('n2');
    expect(r[0].offset).toBe(10);
  });

  it('проём, вылезающий за узел в первой половине, прижимается', () => {
    const c = make({ id: 'c', offset: cm(45), width: cm(20) }); // [35,55], центр в первой
    const r = redistributeOpeningsOnSplit([c], 's1', 50, 'n1', 'n2', 50);
    expect(r[0].segmentId).toBe('n1');
    expect(r[0].offset).toBe(40);
  });

  it('проём, вылезающий за узел во второй половине, прижимается', () => {
    const c = make({ id: 'c', offset: cm(55), width: cm(20) }); // [45,65], центр во второй
    const r = redistributeOpeningsOnSplit([c], 's1', 50, 'n1', 'n2', 50);
    expect(r[0].segmentId).toBe('n2');
    expect(r[0].offset).toBe(10);
  });

  it('проём шире первой половины — удаляется', () => {
    const c = make({ id: 'c', offset: cm(10), width: cm(60) });
    const r = redistributeOpeningsOnSplit([c], 's1', 50, 'n1', 'n2', 50);
    expect(r).toEqual([]);
  });

  it('два проёма, после прижатия не помещающиеся вместе, — второй удаляется', () => {
    const p = make({ id: 'p', offset: cm(20), width: cm(40) }); // [0,40]
    const q = make({ id: 'q', offset: cm(40), width: cm(30) }); // [25,55], центр в первой
    const r = redistributeOpeningsOnSplit([p, q], 's1', 50, 'n1', 'n2', 50);
    expect(r.map((o) => o.id)).toEqual(['p']);
  });

  it('пустой список', () => {
    expect(redistributeOpeningsOnSplit([], 's1', 50, 'n1', 'n2', 50)).toEqual([]);
  });
});
