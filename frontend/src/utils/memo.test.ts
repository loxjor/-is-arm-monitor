import { describe, expect, it, vi } from 'vitest';
import { changeGate, lastValueMemo, wallGraphKey } from './memo';
import { findRooms } from './rooms';

const square = {
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 400, y: 0 },
    { id: 'c', x: 400, y: 300 },
    { id: 'd', x: 0, y: 300 },
  ],
  edges: [
    { startNodeId: 'a', endNodeId: 'b', thickness: 20 },
    { startNodeId: 'b', endNodeId: 'c', thickness: 20 },
    { startNodeId: 'c', endNodeId: 'd', thickness: 20 },
    { startNodeId: 'd', endNodeId: 'a', thickness: 20 },
  ],
};

describe('lastValueMemo', () => {
  it('reuses the value while the key is unchanged and recomputes on a new key', () => {
    const memo = lastValueMemo<{ n: number }>();
    const compute = vi.fn(() => ({ n: compute.mock.calls.length }));
    const first = memo('k1', compute);
    expect(memo('k1', compute)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
    const second = memo('k2', compute);
    expect(second).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(2);
    // Хранится только последний ключ.
    expect(memo('k1', compute)).not.toBe(first);
    expect(compute).toHaveBeenCalledTimes(3);
  });
});

describe('wallGraphKey', () => {
  const key = (nodes = square.nodes, edges = square.edges): string => wallGraphKey(nodes, edges);

  it('is stable for equal graphs', () => {
    expect(key()).toBe(wallGraphKey(square.nodes.map((n) => ({ ...n })), square.edges.map((e) => ({ ...e }))));
  });

  it('changes on any geometry change', () => {
    const base = key();
    const moved = square.nodes.map((n) => (n.id === 'c' ? { ...n, x: n.x + 1e-9 } : n));
    expect(key(moved)).not.toBe(base);
    const thicker = square.edges.map((e, i) => (i === 2 ? { ...e, thickness: 21 } : e));
    expect(key(undefined, thicker)).not.toBe(base);
    const rewired = square.edges.map((e, i) => (i === 0 ? { ...e, endNodeId: 'c' } : e));
    expect(key(undefined, rewired)).not.toBe(base);
    expect(key(undefined, square.edges.slice(0, 3))).not.toBe(base);
    // Порядок влияет на «первое совпадение» в поисках — он часть ключа.
    expect(key([...square.nodes].reverse())).not.toBe(base);
  });

  it('does not confuse nodes with edges', () => {
    expect(wallGraphKey([], [])).not.toBe(wallGraphKey([{ id: 'x', x: 0, y: 0 }], []));
  });
});

describe('rooms through the memo', () => {
  it('returns the same rooms as a fresh findRooms and the same object on a cache hit', () => {
    const memo = lastValueMemo<ReturnType<typeof findRooms>>();
    const compute = (): ReturnType<typeof findRooms> => findRooms(square.nodes, square.edges);
    const cached = memo(wallGraphKey(square.nodes, square.edges), compute);
    expect(cached).toEqual(findRooms(square.nodes, square.edges));
    expect(cached).toHaveLength(1);
    expect(memo(wallGraphKey(square.nodes, square.edges), compute)).toBe(cached);
  });
});

describe('changeGate', () => {
  it('passes only keys that differ from the last passed one', () => {
    const gate = changeGate();
    expect(gate('a')).toBe(true);
    expect(gate('a')).toBe(false);
    expect(gate('b')).toBe(true);
    // Возврат к прежнему значению — тоже изменение.
    expect(gate('a')).toBe(true);
    expect(gate('a')).toBe(false);
  });

  it('passes any key once after reset', () => {
    const gate = changeGate();
    gate('a');
    gate.reset();
    expect(gate('a')).toBe(true);
    expect(gate('a')).toBe(false);
  });

  it('keeps separate state per gate', () => {
    const first = changeGate();
    const second = changeGate();
    first('a');
    expect(second('a')).toBe(true);
  });
});
