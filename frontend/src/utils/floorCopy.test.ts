import { describe, expect, it } from 'vitest';
import type { SceneData } from '../types/scene';
import { cm } from './scale';
import { copyFloorScene, floorInsertIndex, floorName, floorNumber, freeFloorNumbers } from './floorCopy';

const scene: SceneData = {
  version: 2,
  nodes: [
    { id: 'a', x: cm(0), y: cm(0) },
    { id: 'b', x: cm(300), y: cm(0) },
  ],
  segments: [{ id: 's', startNodeId: 'a', endNodeId: 'b', thickness: cm(10) }],
  openings: [
    {
      id: 'o',
      segmentId: 's',
      kind: 'door',
      offset: cm(150),
      width: cm(80),
      height: cm(210),
      sillHeight: cm(0),
      hinge: 'start',
      swing: 'left',
    },
  ],
  rooms: [{ id: 'r', x: cm(150), y: cm(100), title: 'каб. 1', note: '' }],
  workspaces: [
    { id: 'w', x: cm(10), y: cm(20), width: cm(120), height: cm(60), rotation: 0, label: 'АРМ 1', status: 'free' },
  ],
};

function counter(): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}-new-${++n}`;
}

describe('copyFloorScene', () => {
  it('исходный план: стены и проёмы с новыми id и пересвязанными ссылками, без кабинетов и столов', () => {
    const copy = copyFloorScene(scene, 'plan', counter());

    expect(copy.nodes.map((n) => n.id)).not.toContain('a');
    const [segment] = copy.segments;
    expect(copy.nodes.map((n) => n.id)).toEqual([segment.startNodeId, segment.endNodeId]);
    expect(copy.openings?.[0].segmentId).toBe(segment.id);
    expect(copy.openings?.[0].id).not.toBe('o');
    expect(copy.rooms).toEqual([]);
    expect(copy.workspaces).toEqual([]);
  });

  it('полная копия: кабинеты и столы тоже, с новыми id и прежними подписями', () => {
    const copy = copyFloorScene(scene, 'full', counter());

    expect(copy.rooms?.map((r) => [r.title, r.id === 'r'])).toEqual([['каб. 1', false]]);
    expect(copy.workspaces.map((w) => [w.label, w.id === 'w'])).toEqual([['АРМ 1', false]]);
  });

  it('исходная сцена не меняется', () => {
    copyFloorScene(scene, 'full', counter());
    expect(scene.nodes[0].id).toBe('a');
    expect(scene.workspaces[0].id).toBe('w');
  });
});

describe('номера этажей', () => {
  it('название и номер из названия', () => {
    expect(floorName(2)).toBe('2-й этаж');
    expect(floorNumber('2-й этаж')).toBe(2);
    expect(floorNumber('1 этаж')).toBe(1);
    expect(floorNumber('-1-й этаж')).toBe(-1);
    expect(floorNumber('Мансарда')).toBeNull();
  });

  it('свободные номера без занятых, по умолчанию — следующий над верхним', () => {
    const { numbers, suggested } = freeFloorNumbers(['1 этаж', '3-й этаж']);
    expect(numbers).not.toContain(1);
    expect(numbers).not.toContain(3);
    expect(numbers).toContain(2);
    expect(numbers).toContain(-1);
    expect(suggested).toBe(4);
    expect(freeFloorNumbers([]).suggested).toBe(1);
  });

  it('этаж встаёт по порядку номеров, безымянные — в конце', () => {
    const names = ['-1-й этаж', '1-й этаж', '3-й этаж', 'Мансарда'];
    expect(floorInsertIndex(names, 2)).toBe(2);
    expect(floorInsertIndex(names, -2)).toBe(0);
    expect(floorInsertIndex(names, 5)).toBe(3);
  });
});
