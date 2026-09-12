import { describe, expect, it } from 'vitest';
import { migrateSceneData, migrateWallsToGraph } from './wallGraph';
import type { WallData } from '../types/wall';
import type { SceneDataV1 } from '../types/scene';
import { cm } from './scale';

function wall(x: number, y: number, length: number, rotation: number, thickness = 10): WallData {
  return { id: `w-${x}-${y}-${rotation}`, x: cm(x), y: cm(y), length: cm(length), rotation, thickness: cm(thickness) };
}

describe('migrateWallsToGraph', () => {
  it('одна стена даёт два узла и одно ребро', () => {
    const { nodes, segments } = migrateWallsToGraph([wall(0, 0, 100, 0)]);

    expect(nodes).toHaveLength(2);
    expect(segments).toHaveLength(1);

    const start = nodes.find((n) => n.id === segments[0].startNodeId)!;
    const end = nodes.find((n) => n.id === segments[0].endNodeId)!;
    expect(start.x).toBeCloseTo(0);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(100);
    expect(end.y).toBeCloseTo(0);
    expect(segments[0].thickness).toBe(10);
  });

  it('совпадающие в пределах допуска концы двух стен склеиваются в общий узел', () => {
    // Горизонтальная стена 0,0 -> 100,0 и вертикальная, начинающаяся в 100.4,0.3
    // (в пределах JOINT_TOLERANCE_CM=1 от конца первой) — угол должен стать
    // ОДНИМ узлом, а не двумя совпадающими по координатам.
    const walls = [wall(0, 0, 100, 0), wall(100.4, 0.3, 80, 90)];
    const { nodes, segments } = migrateWallsToGraph(walls);

    expect(nodes).toHaveLength(3);
    expect(segments).toHaveLength(2);
    expect(segments[0].endNodeId).toBe(segments[1].startNodeId);
  });

  it('концы дальше допуска не склеиваются — остаются раздельными узлами', () => {
    const walls = [wall(0, 0, 100, 0), wall(105, 0, 80, 90)];
    const { nodes, segments } = migrateWallsToGraph(walls);

    expect(nodes).toHaveLength(4);
    expect(segments[0].endNodeId).not.toBe(segments[1].startNodeId);
  });

  it('замкнутый контур из четырёх стен даёт четыре узла (каждый угол общий для двух рёбер)', () => {
    const walls = [
      wall(0, 0, 100, 0),
      wall(100, 0, 100, 90),
      wall(100, 100, 100, 180),
      wall(0, 100, 100, 270),
    ];
    const { nodes, segments } = migrateWallsToGraph(walls);

    expect(nodes).toHaveLength(4);
    expect(segments).toHaveLength(4);
    // Каждый узел встречается ровно у двух рёбер (кроме случайных коллизий не бывает).
    const nodeUsage = new Map<string, number>();
    segments.forEach((s) => {
      nodeUsage.set(s.startNodeId, (nodeUsage.get(s.startNodeId) ?? 0) + 1);
      nodeUsage.set(s.endNodeId, (nodeUsage.get(s.endNodeId) ?? 0) + 1);
    });
    nodeUsage.forEach((count) => expect(count).toBe(2));
  });

  it('пустой список стен даёт пустой граф', () => {
    expect(migrateWallsToGraph([])).toEqual({ nodes: [], segments: [] });
  });
});

describe('migrateSceneData', () => {
  it('version 2 возвращается как есть (identity)', () => {
    const scene = { version: 2 as const, nodes: [], segments: [], workspaces: [] };
    expect(migrateSceneData(scene)).toBe(scene);
  });

  it('version 1 конвертируется в version 2 с сохранением рабочих мест', () => {
    const v1: SceneDataV1 = {
      version: 1,
      walls: [wall(0, 0, 100, 0)],
      workspaces: [
        { id: 'ws-1', x: cm(10), y: cm(10), width: cm(120), height: cm(80), rotation: 0, label: 'Стол', status: 'free' },
      ],
    };

    const migrated = migrateSceneData(v1);

    expect(migrated.version).toBe(2);
    expect(migrated.nodes).toHaveLength(2);
    expect(migrated.segments).toHaveLength(1);
    expect(migrated.workspaces).toBe(v1.workspaces);
  });
});
