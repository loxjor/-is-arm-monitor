import { api } from './api/client';
import type { CatalogRecord, Page } from './api/types';

/** Справочники для выпадающих списков и подписей в таблицах. Кэш до первого изменения. */
const cache = new Map<string, Promise<CatalogRecord[]>>();

export function loadCatalog(path: string): Promise<CatalogRecord[]> {
  let pending = cache.get(path);
  if (!pending) {
    pending = api.get<Page<CatalogRecord>>(`/${path}`, { limit: 1000 }).then((page) => page.items);
    pending.catch(() => cache.delete(path));
    cache.set(path, pending);
  }
  return pending;
}

export function invalidateCatalog(path: string): void {
  cache.delete(path);
}

const PRIMARY_KEYS: Record<string, string> = {
  departments: 'dept_id',
  employees: 'employee_id',
  buildings: 'building_id',
  rooms: 'room_id',
  workplaces: 'workplace_id',
  'equipment-types': 'type_id',
  manufacturers: 'manufacturer_id',
  'equipment-models': 'model_id',
  'operating-systems': 'os_id',
};

export function primaryKey(path: string): string {
  return PRIMARY_KEYS[path];
}

export function recordLabel(path: string, record: CatalogRecord): string {
  switch (path) {
    case 'departments':
      return String(record.short_name ?? record.name);
    case 'employees':
      return String(record.full_name);
    case 'rooms':
      return `каб. ${String(record.room_no)}`;
    case 'workplaces':
      return `РМ ${String(record.workplace_no)}`;
    case 'operating-systems':
      return [record.name, record.version].filter(Boolean).join(' ');
    default:
      return String(record.name);
  }
}

export interface Option {
  value: number | string;
  label: string;
}

export async function catalogOptions(
  path: string,
  filter?: (record: CatalogRecord) => boolean,
): Promise<Option[]> {
  const records = await loadCatalog(path);
  const key = primaryKey(path);
  return records
    .filter((record) => !filter || filter(record))
    .map((record) => ({ value: Number(record[key]), label: recordLabel(path, record) }));
}

/** id → подпись для отображения внешних ключей в таблицах. */
export async function labelMap(path: string): Promise<Map<number, string>> {
  const records = await loadCatalog(path);
  const key = primaryKey(path);
  return new Map(records.map((record) => [Number(record[key]), recordLabel(path, record)]));
}
