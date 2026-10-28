import type { SceneData } from '../types/scene';

/**
 * Что взять с текущего этажа в новый:
 *  - 'plan' — исходный план: стены, двери и окна (кабинеты новый этаж
 *    пронумерует сам, столы расставят заново);
 *  - 'full' — всё, включая подписи кабинетов и рабочие места.
 */
export type FloorCopyMode = 'plan' | 'full';

/**
 * Копия сцены этажа с новыми id у всего, что копируется, и пересвязанными
 * ссылками (стена → узлы, проём → стена). Новые id нужны не для стен
 * (их сервер проверяет в пределах этажа), а для рабочих мест: client_id
 * уникален во всём плане, и копия стола иначе затёрла бы оригинал при
 * сохранении. Стены пересоздаются заодно — чтобы id не повторялись нигде.
 */
export function copyFloorScene(
  scene: SceneData,
  mode: FloorCopyMode,
  newId: (prefix: string) => string,
): SceneData {
  const nodeIds = new Map(scene.nodes.map((node) => [node.id, newId('node')]));
  const segmentIds = new Map(scene.segments.map((segment) => [segment.id, newId('wall')]));
  const remap = (ids: Map<string, string>, id: string): string => ids.get(id) ?? id;

  return {
    version: 2,
    nodes: scene.nodes.map((node) => ({ ...node, id: remap(nodeIds, node.id) })),
    segments: scene.segments.map((segment) => ({
      ...segment,
      id: remap(segmentIds, segment.id),
      startNodeId: remap(nodeIds, segment.startNodeId),
      endNodeId: remap(nodeIds, segment.endNodeId),
    })),
    openings: (scene.openings ?? []).map((opening) => ({
      ...opening,
      id: newId(opening.kind === 'window' || opening.kind === 'windowway' ? 'window' : 'door'),
      segmentId: remap(segmentIds, opening.segmentId),
    })),
    // Лестницы и лифты — часть исходного плана здания, как стены.
    fixtures: (scene.fixtures ?? []).map((fixture) => ({ ...fixture, id: newId(fixture.kind) })),
    rooms: mode === 'full' ? (scene.rooms ?? []).map((room) => ({ ...room, id: newId('room') })) : [],
    workspaces:
      mode === 'full' ? scene.workspaces.map((workspace) => ({ ...workspace, id: newId('workspace') })) : [],
  };
}

// Цокольные и подвальные этажи — отрицательные номера; выше 30 этажей
// офисный план в этой системе не встречается.
const FLOOR_NUMBERS = Array.from({ length: 33 }, (_, index) => index - 2).filter((n) => n !== 0);

/** «2-й этаж», «-1-й этаж» — так этаж называется в списке и в сохранённом плане. */
export function floorName(number: number): string {
  return `${number}-й этаж`;
}

/** Номер этажа из названия («2-й этаж», «2 этаж», «-1 этаж»); null — название без номера. */
export function floorNumber(name: string): number | null {
  const match = /^(-?\d+)/.exec(name.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Номера, которые ещё можно создать, и номер по умолчанию — следующий над
 * самым верхним существующим (или 1 на пустом плане).
 */
export function freeFloorNumbers(names: readonly string[]): { numbers: number[]; suggested: number } {
  const taken = new Set(names.map(floorNumber).filter((n): n is number => n !== null));
  const numbers = FLOOR_NUMBERS.filter((n) => !taken.has(n));
  const top = Math.max(0, ...taken);
  const suggested = numbers.find((n) => n > top) ?? numbers[0] ?? top + 1;
  return { numbers, suggested };
}

/** Куда вставить этаж с этим номером, чтобы список шёл снизу вверх; этажи без номера — в конце. */
export function floorInsertIndex(names: readonly string[], number: number): number {
  const index = names.findIndex((name) => {
    const other = floorNumber(name);
    return other === null || other > number;
  });
  return index < 0 ? names.length : index;
}
