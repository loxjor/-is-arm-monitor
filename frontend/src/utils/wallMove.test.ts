import { describe, expect, it } from 'vitest';
import { wallShiftRange, type MoveNode, type MoveWall } from './wallMove';

function graph(points: Record<string, [number, number]>, edges: [string, string, string][], thickness = 10) {
  const nodes = new Map<string, MoveNode>(
    Object.entries(points).map(([id, [x, y]]) => [id, { id, x, y }]),
  );
  const walls: MoveWall[] = edges.map(([id, startNodeId, endNodeId]) => ({ id, startNodeId, endNodeId, thickness }));
  return { nodes, walls };
}

// Комната 400×300: a(0,0) b(400,0) c(400,300) d(0,300).
const room = graph(
  { a: [0, 0], b: [400, 0], c: [400, 300], d: [0, 300] },
  [
    ['top', 'a', 'b'],
    ['right', 'b', 'c'],
    ['bottom', 'c', 'd'],
    ['left', 'd', 'a'],
  ],
);

describe('wallShiftRange', () => {
  it('сдвиг только по нормали; верхняя стена не проходит сквозь нижнюю и не схлопывает боковые', () => {
    const range = wallShiftRange(room.nodes, room.walls, 'top', 20)!;
    // Нормаль верхней стены (0,0)→(400,0) — +y, внутрь комнаты.
    expect(range.normal).toEqual({ x: -0, y: 1 });
    expect(range.nodeIds.sort()).toEqual(['a', 'b']);
    // Боковые стены не короче 20 → не дальше 280; нижняя не мешает раньше (300 − 10).
    expect(range.max).toBe(280);
    // Наружу ничего не держит.
    expect(range.min).toBe(-Infinity);
  });

  it('параллельная стена напротив останавливает вплотную грань к грани', () => {
    // Свободная стена y=100 внутри комнаты, без связей.
    const g = graph(
      { a: [0, 0], b: [400, 0], p: [50, 100], q: [350, 100] },
      [
        ['top', 'a', 'b'],
        ['inner', 'p', 'q'],
      ],
    );
    const range = wallShiftRange(g.nodes, g.walls, 'top', 20)!;
    expect(range.max).toBe(90);
  });

  it('стена у T-стыка не съезжает с грани основной стены', () => {
    // Основная стена a—t—b по y=0 разбита узлом t (100,0), от t вниз — перегородка t—s.
    const g = graph(
      { a: [0, 0], t: [100, 0], b: [400, 0], s: [100, 200] },
      [
        ['left', 'a', 't'],
        ['right', 't', 'b'],
        ['stub', 't', 's'],
      ],
    );
    const range = wallShiftRange(g.nodes, g.walls, 'stub', 20)!;
    // Нормаль перегородки (0,1) → (-1,0): влево до a (100 − 20), вправо до b (300 − 20).
    expect(range.normal).toEqual({ x: -1, y: 0 });
    expect(range.max).toBe(80);
    expect(range.min).toBe(-280);
  });

  it('участок разбитой стены едет вместе со всей прямой', () => {
    const g = graph(
      { a: [0, 0], t: [100, 0], b: [400, 0], s: [100, 200] },
      [
        ['left', 'a', 't'],
        ['right', 't', 'b'],
        ['stub', 't', 's'],
      ],
    );
    const range = wallShiftRange(g.nodes, g.walls, 'left', 20)!;
    expect(range.nodeIds.sort()).toEqual(['a', 'b', 't']);
    // Перегородка вниз не короче 20.
    expect(range.max).toBe(180);
  });

  it('уже нарушенный предел не запрещает стоять на месте', () => {
    const g = graph(
      { a: [0, 0], b: [400, 0], c: [400, 5] },
      [
        ['top', 'a', 'b'],
        ['tiny', 'b', 'c'],
      ],
    );
    const range = wallShiftRange(g.nodes, g.walls, 'top', 20)!;
    expect(range.max).toBe(0);
  });
});
