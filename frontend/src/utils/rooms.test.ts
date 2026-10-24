import { describe, expect, it } from 'vitest';
import { findRooms, polygonCentroid } from './rooms';

const square = (size: number, ox = 0, oy = 0) => [
  { id: `a${ox}`, x: ox, y: oy },
  { id: `b${ox}`, x: ox + size, y: oy },
  { id: `c${ox}`, x: ox + size, y: oy + size },
  { id: `d${ox}`, x: ox, y: oy + size },
];
const ring = (ids: string[], t = 10) =>
  ids.map((id, i) => ({ startNodeId: id, endNodeId: ids[(i + 1) % ids.length], thickness: t }));

describe('findRooms', () => {
  it('замкнутый квадрат — одно помещение с внутренней площадью', () => {
    const rooms = findRooms(square(100), ring(['a0', 'b0', 'c0', 'd0']));
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(90 * 90);
    expect(rooms[0].nodeIds).toHaveLength(4);
  });

  it('незамкнутая цепочка — помещений нет', () => {
    const edges = ring(['a0', 'b0', 'c0', 'd0']).slice(0, 3);
    expect(findRooms(square(100), edges)).toEqual([]);
  });

  it('перегородка делит прямоугольник на два помещения', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 200, y: 0 },
      { id: 'c', x: 200, y: 100 },
      { id: 'd', x: 0, y: 100 },
      { id: 'm1', x: 100, y: 0 },
      { id: 'm2', x: 100, y: 100 },
    ];
    const t = 10;
    const edges = [
      { startNodeId: 'a', endNodeId: 'm1', thickness: t },
      { startNodeId: 'm1', endNodeId: 'b', thickness: t },
      { startNodeId: 'b', endNodeId: 'c', thickness: t },
      { startNodeId: 'c', endNodeId: 'm2', thickness: t },
      { startNodeId: 'm2', endNodeId: 'd', thickness: t },
      { startNodeId: 'd', endNodeId: 'a', thickness: t },
      { startNodeId: 'm1', endNodeId: 'm2', thickness: t },
    ];
    const rooms = findRooms(nodes, edges);
    expect(rooms).toHaveLength(2);
    rooms.forEach((r) => expect(r.area).toBeCloseTo(90 * 90));
  });

  it('висячая стена внутри помещения не ломает контур', () => {
    const nodes = [...square(100), { id: 'tip', x: 50, y: 50 }, { id: 'mid', x: 50, y: 0 }];
    const edges = [
      { startNodeId: 'a0', endNodeId: 'mid', thickness: 10 },
      { startNodeId: 'mid', endNodeId: 'b0', thickness: 10 },
      { startNodeId: 'b0', endNodeId: 'c0', thickness: 10 },
      { startNodeId: 'c0', endNodeId: 'd0', thickness: 10 },
      { startNodeId: 'd0', endNodeId: 'a0', thickness: 10 },
      { startNodeId: 'mid', endNodeId: 'tip', thickness: 10 },
    ];
    const rooms = findRooms(nodes, edges);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(90 * 90);
  });

  it('висячая стена снаружи не создаёт лишних помещений', () => {
    const nodes = [...square(100), { id: 'out', x: 200, y: 0 }];
    const edges = [...ring(['a0', 'b0', 'c0', 'd0']), { startNodeId: 'b0', endNodeId: 'out', thickness: 10 }];
    expect(findRooms(nodes, edges)).toHaveLength(1);
  });

  it('два отдельных квадрата — два помещения', () => {
    const nodes = [...square(100), ...square(100, 300)];
    const edges = [...ring(['a0', 'b0', 'c0', 'd0']), ...ring(['a300', 'b300', 'c300', 'd300'])];
    expect(findRooms(nodes, edges)).toHaveLength(2);
  });
});

describe('findRooms: стены, упёртые в грань', () => {
  it('перегородка упёрта концами в грани стен без общих узлов — два помещения', () => {
    const t = 10;
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 200, y: 0 },
      { id: 'c', x: 200, y: 100 },
      { id: 'd', x: 0, y: 100 },
      // концы перегородки лежат на внутренних гранях верхней и нижней стен
      { id: 'm1', x: 100, y: 5 },
      { id: 'm2', x: 100, y: 95 },
    ];
    const edges = [
      ...ring(['a', 'b', 'c', 'd'], t),
      { startNodeId: 'm1', endNodeId: 'm2', thickness: t },
    ];
    const rooms = findRooms(nodes, edges);
    expect(rooms).toHaveLength(2);
    rooms.forEach((r) => expect(r.area).toBeCloseTo(90 * 90, 0));
  });

  it('близкие, но не касающиеся стены помещения не замыкают', () => {
    const nodes = [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 100, y: 0 },
      { id: 'c', x: 100, y: 100 },
      { id: 'd', x: 0, y: 100 },
    ];
    const edges = ring(['a', 'b', 'c', 'd'], 10).slice(0, 3);
    expect(findRooms(nodes, edges)).toEqual([]);
  });
});

describe('polygonCentroid', () => {
  it('центр прямоугольника', () => {
    const c = polygonCentroid([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]);
    expect(c.x).toBeCloseTo(50);
    expect(c.y).toBeCloseTo(25);
  });
});
