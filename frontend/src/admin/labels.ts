import type { AssignmentRecord, EquipmentStatus } from './api/types';
import { StatusBadge, type StatusKind } from '../design/components';

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  in_stock: 'На складе',
  in_use: 'В эксплуатации',
  in_repair: 'В ремонте',
  pending_writeoff: 'К списанию',
  written_off: 'Списано',
};

export const STATUS_ORDER: EquipmentStatus[] = ['in_use', 'in_stock', 'in_repair', 'pending_writeoff', 'written_off'];

// В системе три статусных цвета: «свободно» — то, что можно выдать, «занято» —
// в работе у сотрудника, «бронь» (синий бренда) — требует внимания службы.
const EQUIPMENT_STATUS_KIND: Record<EquipmentStatus, StatusKind> = {
  in_stock: 'free',
  in_use: 'occupied',
  in_repair: 'reserved',
  pending_writeoff: 'neutral',
  written_off: 'neutral',
};

export function statusBadge(status: EquipmentStatus): HTMLElement {
  return StatusBadge(EQUIPMENT_STATUS_KIND[status], STATUS_LABELS[status]);
}

export const OPERATION_LABELS: Record<AssignmentRecord['operation'], string> = {
  assign: 'Назначение',
  move: 'Перемещение',
  return: 'Возврат на склад',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: 'Вход',
  login_failed: 'Неудачный вход',
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  status_change: 'Смена статуса',
  assign: 'Назначение',
  move: 'Перемещение',
  return: 'Возврат на склад',
};

export const ENTITY_LABELS: Record<string, string> = {
  app_user: 'Пользователь',
  equipment: 'Оборудование',
  department: 'Подразделение',
  employee: 'Сотрудник',
  building: 'Здание',
  room: 'Помещение',
  workplace: 'Рабочее место',
  equipment_type: 'Тип оборудования',
  manufacturer: 'Производитель',
  equipment_model: 'Модель',
  operating_system: 'ОС',
};

