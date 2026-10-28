/**
 * Кэш последнего результата по строковому ключу: пока ключ тот же, compute
 * не вызывается и возвращается прежний объект (по ссылке — по ней вызывающий
 * может понять, что пересчитывать производное, например Konva-узлы, не нужно).
 */
export function lastValueMemo<T>(): (key: string, compute: () => T) => T {
  let lastKey: string | undefined;
  let lastValue: T;
  return (key, compute) => {
    if (key !== lastKey) {
      lastValue = compute();
      lastKey = key;
    }
    return lastValue;
  };
}

export interface KeyNode {
  id: string;
  x: number;
  y: number;
}

export interface KeyEdge {
  startNodeId: string;
  endNodeId: string;
  thickness: number;
}

/**
 * Отпечаток графа стен: всё, от чего зависит производная геометрия (помещения,
 * свободные концы, примыкания к граням), — узлы с координатами и рёбра с
 * концами и толщиной, в порядке обхода (от порядка зависит, какое из
 * равноправных совпадений найдётся первым). Строится за O(узлы + рёбра) —
 * дешевле любого из попарных пересчётов, которые он позволяет пропустить.
 * String(number) точно воспроизводит double, так что любой сдвиг узла меняет ключ.
 */
export function wallGraphKey(nodes: Iterable<KeyNode>, edges: Iterable<KeyEdge>): string {
  const parts: string[] = [];
  for (const n of nodes) {
    parts.push(`${n.id}:${n.x}:${n.y}`);
  }
  parts.push('|');
  for (const e of edges) {
    parts.push(`${e.startNodeId}>${e.endNodeId}:${e.thickness}`);
  }
  return parts.join(';');
}

/**
 * Пропускает повтор: возвращает true, только если ключ отличается от
 * последнего пропущенного. reset() забывает его — следующий вызов пройдёт
 * при любом ключе (например, после смены подписчика).
 */
export interface ChangeGate {
  (key: string): boolean;
  reset(): void;
}

export function changeGate(): ChangeGate {
  let lastKey: string | undefined;
  const gate = ((key: string) => {
    if (key === lastKey) {
      return false;
    }
    lastKey = key;
    return true;
  }) as ChangeGate;
  gate.reset = () => {
    lastKey = undefined;
  };
  return gate;
}
