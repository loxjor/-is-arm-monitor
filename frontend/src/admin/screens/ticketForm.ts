import { ApiError, api } from '../api/client';
import type { EquipmentListItem, Page, TicketCard } from '../api/types';
import { TICKET_PRIORITY_LABELS, TICKET_TYPE_LABELS } from '../labels';
import type { Option } from '../lookups';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';

async function equipmentOptions(): Promise<Option[]> {
  // Сервер отдаёт только видимое пользователю оборудование — на чужое заявку не подать.
  const page = await api.get<Page<EquipmentListItem>>('/equipment', { limit: 500 });
  return page.items
    .filter((item) => item.status !== 'written_off')
    .map((item) => ({
      value: item.equipment_id,
      label: `${item.inventory_no} — ${item.type_name}${item.workplace_no ? `, РМ ${item.workplace_no}` : ''}`,
    }));
}

const enumOptions = (labels: Record<string, string>) => async (): Promise<Option[]> =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const FIELDS: FieldSpec[] = [
  { name: 'ticket_type', label: 'Тип заявки', kind: 'select', required: true, options: enumOptions(TICKET_TYPE_LABELS) },
  { name: 'priority', label: 'Приоритет', kind: 'select', required: true, options: enumOptions(TICKET_PRIORITY_LABELS) },
  {
    name: 'equipment_id', label: 'Оборудование', kind: 'select', options: equipmentOptions,
    hint: 'Для ремонта и обслуживания — обязательно',
  },
  { name: 'description', label: 'Описание', kind: 'textarea', required: true },
];

/** Окно подачи заявки. equipmentId — подставить оборудование (из карточки). */
export function openTicketForm(equipmentId: number | null, onSaved: (saved: TicketCard) => void): void {
  const form = new Form(FIELDS, {
    ticket_type: equipmentId ? 'repair' : 'install',
    priority: 'normal',
    equipment_id: equipmentId,
  });

  new Modal('Новая заявка', form.element, [
    { label: 'Отмена', onClick: () => undefined },
    {
      label: 'Подать заявку',
      kind: 'primary',
      onClick: async () => {
        const values = form.getValues();
        if (!values) return false;
        try {
          onSaved(await api.post<TicketCard>('/tickets', values));
          return true;
        } catch (error) {
          if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
          else form.showError('Не удалось подать заявку');
          return false;
        }
      },
    },
  ]).open();
  void form.ready.then(() => form.focusFirst());
}
