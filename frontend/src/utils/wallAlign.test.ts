import { describe, expect, it } from 'vitest';
import { alignmentLines, snapToAlignment } from './wallAlign';

const nodes = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 100, y: 50 },
];
const edges = [{ startNodeId: 'a', endNodeId: 'b' }];

describe('alignmentLines', () => {
  it('у свободного конца: горизонталь, вертикаль, продолжение и перпендикуляр', () => {
    const lines = alignmentLines(nodes, edges).filter((l) => l.origin.x === 100);
    expect(lines).toHaveLength(4);
  });

  it('ось стены вдоль горизонтали не дублирует линии', () => {
    const lines = alignmentLines(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 100, y: 0 },
      ],
      [{ startNodeId: 'a', endNodeId: 'b' }],
    ).filter((l) => l.origin.x === 100);
    expect(lines).toHaveLength(2);
  });

  it('узел с двумя стенами — только горизонталь и вертикаль', () => {
    const lines = alignmentLines(
      [...nodes, { id: 'c', x: 0, y: 100 }],
      [...edges, { startNodeId: 'a', endNodeId: 'c' }],
    ).filter((l) => l.origin.x === 0 && l.origin.y === 0);
    expect(lines).toHaveLength(2);
  });
});

describe('snapToAlignment: совпадающие линии', () => {
  it('из двух линий на одной прямой берётся та, чей узел ближе', () => {
    const lines = alignmentLines(
      [
        { id: 'a', x: 100, y: 0 },
        { id: 'b', x: 100, y: 500 },
        { id: 'c', x: 0, y: 0 },
      ],
      [
        { startNodeId: 'a', endNodeId: 'c' },
        { startNodeId: 'b', endNodeId: 'c' },
      ],
    );
    const r = snapToAlignment({ x: 101, y: 40 }, lines, 5)!;
    expect(r.lines[0].origin.y).toBe(0);
  });
});

describe('snapToAlignment', () => {
  const lines = alignmentLines(nodes, edges);

  it('вне допуска — null', () => {
    expect(snapToAlignment({ x: 500, y: 500 }, lines, 5)).toBeNull();
  });

  it('рядом с вертикалью от конца — проекция на неё', () => {
    const r = snapToAlignment({ x: 103, y: 300 }, lines, 5)!;
    expect(r.point.x).toBeCloseTo(100);
    expect(r.point.y).toBeCloseTo(300);
    expect(r.lines).toHaveLength(1);
  });

  it('рядом с двумя линиями — пересечение', () => {
    const r = snapToAlignment({ x: 103, y: 52 }, lines, 5)!;
    expect(r.point.x).toBeCloseTo(100);
    expect(r.point.y).toBeCloseTo(50);
    expect(r.lines).toHaveLength(2);
  });

  it('с ограничивающим лучом садится на пересечение впереди', () => {
    const r = snapToAlignment({ x: 102, y: 4 }, lines, 5, {
      origin: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
    })!;
    expect(r.point.x).toBeCloseTo(100);
    expect(r.point.y).toBeCloseTo(0);
  });

  it('пересечение позади начала луча игнорируется', () => {
    const r = snapToAlignment({ x: -100, y: 1 }, lines, 5, {
      origin: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
    });
    expect(r).toBeNull();
  });
});
