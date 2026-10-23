import type { AssignmentRecord, EquipmentStatus } from './api/types';
import { h } from './ui/dom';

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  in_stock: 'На складе',
  in_use: 'В эксплуатации',
  in_repair: 'В ремонте',
  pending_writeoff: 'К списанию',
  written_off: 'Списано',
};

export const STATUS_ORDER: EquipmentStatus[] = ['in_use', 'in_stock', 'in_repair', 'pending_writeoff', 'written_off'];

export function statusBadge(status: EquipmentStatus): HTMLElement {
  return h('span', { class: `badge badge--${status}` }, STATUS_LABELS[status]);
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
