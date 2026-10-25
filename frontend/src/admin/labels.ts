import type { AssignmentRecord, EquipmentStatus, TicketPriority, TicketStatus, TicketType } from './api/types';
import { StatusBadge, type StatusKind } from '../design/components';
import { h } from './ui/dom';

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
  ticket: 'Заявка',
  ticket_work: 'Работа по заявке',
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

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  install: 'Установка',
  move: 'Перемещение',
  service: 'Обслуживание',
  repair: 'Ремонт',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнена',
  rejected: 'Отклонена',
  closed: 'Закрыта',
};

export const TICKET_STATUS_ORDER: TicketStatus[] = ['new', 'in_progress', 'done', 'closed', 'rejected'];

const TICKET_STATUS_KIND: Record<TicketStatus, StatusKind> = {
  new: 'reserved',
  in_progress: 'occupied',
  done: 'free',
  closed: 'neutral',
  rejected: 'neutral',
};

export function ticketBadge(status: TicketStatus): HTMLElement {
  return StatusBadge(TICKET_STATUS_KIND[status], TICKET_STATUS_LABELS[status]);
}

export function priorityMark(priority: TicketPriority): HTMLElement | string {
  return priority === 'high' ? h('strong', { class: 'text-danger' }, 'Высокий') : TICKET_PRIORITY_LABELS[priority];
}
