import { describe, expect, it } from 'vitest';
import { findAbutmentFace, prepareAbutmentWalls, type AbutmentWallInput } from './wallAbutment';
import type { WallEndpoint } from './geometry';
import type { FaceLine } from './wallPolygon';

const EPS = 0.5;

/** Прежняя реализация FloorPlanCanvas.findAbutmentFacePx — эталон: полный перебор без предфильтра. */
function referenceFind(nodeId: string, nodePx: WallEndpoint, walls: AbutmentWallInput[]): FaceLine | undefined {
  for (const wall of walls) {
    if (wall.startNodeId === nodeId || wall.endNodeId === nodeId) continue;
    const { startPx, endPx, thicknessPx } = wall;
    const lengthPx = Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y);
    if (lengthPx === 0) continue;
    const dir = { x: (endPx.x - startPx.x) / lengthPx, y: (endPx.y - startPx.y) / lengthPx };
    const relX = nodePx.x - startPx.x;
    const relY = nodePx.y - startPx.y;
    const t = relX * dir.x + relY * dir.y;
    const d = -relX * dir.y + relY * dir.x;
    const half = thicknessPx / 2;
    if (t < 0 || t > lengthPx || Math.abs(Math.abs(d) - half) > EPS) continue;
    const sign = Math.sign(d);
    return { point: { x: startPx.x - dir.y * half * sign, y: startPx.y + dir.x * half * sign }, dir };
  }
  return undefined;
}

const horizontal: AbutmentWallInput = {
  startNodeId: 'a',
  endNodeId: 'b',
  startPx: { x: 0, y: 0 },
  endPx: { x: 100, y: 0 },
  thicknessPx: 20,
};

describe('findAbutmentFace', () => {
  it('finds the face line the node lies on, on either side', () => {
    const prepared = prepareAbutmentWalls([horizontal], EPS);
    expect(findAbutmentFace('n', { x: 40, y: 10 }, prepared, EPS)).toEqual({
      point: { x: 0, y: 10 },
      dir: { x: 1, y: 0 },
    });
    // -0 из -dir.y*half*sign — как в прежней реализации.
    expect(findAbutmentFace('n', { x: 40, y: -10.3 }, prepared, EPS)?.point.y).toBe(-10);
  });

  it('ignores the node own walls, points off the face, beyond the ends and zero-length walls', () => {
    const zero: AbutmentWallInput = { ...horizontal, startNodeId: 'z1', endNodeId: 'z2', endPx: { x: 0, y: 0 } };
    const prepared = prepareAbutmentWalls([horizontal, zero], EPS);
    expect(prepared).toHaveLength(1);
    expect(findAbutmentFace('a', { x: 40, y: 10 }, prepared, EPS)).toBeUndefined();
    expect(findAbutmentFace('n', { x: 40, y: 5 }, prepared, EPS)).toBeUndefined();
    expect(findAbutmentFace('n', { x: 101, y: 10 }, prepared, EPS)).toBeUndefined();
    expect(findAbutmentFace('n', { x: 5000, y: 5000 }, prepared, EPS)).toBeUndefined();
  });

  it('returns the first matching wall in input order', () => {
    const twin: AbutmentWallInput = { ...horizontal, startNodeId: 'c', endNodeId: 'd', thicknessPx: 20 };
    const prepared = prepareAbutmentWalls([horizontal, twin], EPS);
    expect(prepared[0].startNodeId).toBe('a');
    expect(findAbutmentFace('n', { x: 40, y: 10 }, prepared, EPS)).toBeDefined();
    expect(findAbutmentFace('a', { x: 40, y: 10 }, prepared, EPS)).toEqual(
      referenceFind('a', { x: 40, y: 10 }, [horizontal, twin]),
    );
  });

  it('matches the unfiltered reference on random plans, including points exactly on faces', () => {
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let plan = 0; plan < 30; plan++) {
      const walls: AbutmentWallInput[] = [];
      for (let i = 0; i < 25; i++) {
        walls.push({
          startNodeId: `s${i}`,
          endNodeId: `e${i}`,
          startPx: { x: rand() * 2000, y: rand() * 2000 },
          endPx: { x: rand() * 2000, y: rand() * 2000 },
          thicknessPx: 4 + rand() * 40,
        });
      }
      const prepared = prepareAbutmentWalls(walls, EPS);
      const probes: Array<{ id: string; p: WallEndpoint }> = [];
      for (let i = 0; i < 40; i++) {
        probes.push({ id: `p${i}`, p: { x: rand() * 2000, y: rand() * 2000 } });
      }
      // Точки на гранях (с дрожанием в пределах допуска и чуть за ним) и в концах граней.
      walls.forEach((w, i) => {
        const len = Math.hypot(w.endPx.x - w.startPx.x, w.endPx.y - w.startPx.y);
        const dir = { x: (w.endPx.x - w.startPx.x) / len, y: (w.endPx.y - w.startPx.y) / len };
        for (const t of [0, rand() * len, len]) {
          for (const off of [w.thicknessPx / 2, -w.thicknessPx / 2, w.thicknessPx / 2 + EPS * 0.99, w.thicknessPx / 2 + EPS * 1.01]) {
            probes.push({
              id: i % 3 === 0 ? w.startNodeId : `q${i}`,
              p: { x: w.startPx.x + dir.x * t - dir.y * off, y: w.startPx.y + dir.y * t + dir.x * off },
            });
          }
        }
      });
      for (const { id, p } of probes) {
        expect(findAbutmentFace(id, p, prepared, EPS)).toEqual(referenceFind(id, p, walls));
      }
    }
  });
});
