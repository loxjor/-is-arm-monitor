import { ApiError, api } from '../api/client';
import type { AssignmentRecord, EquipmentCard } from '../api/types';
import { catalogOptions, loadCatalog } from '../lookups';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { h } from '../ui/dom';

type Operation = AssignmentRecord['operation'];

async function workplaceOptions() {
  const [workplaces, rooms] = await Promise.all([loadCatalog('workplaces'), loadCatalog('rooms')]);
  const roomNo = new Map(rooms.map((room) => [room.room_id, String(room.room_no)]));
  return workplaces
    .map((wp) => ({
      value: Number(wp.workplace_id),
      label: `каб. ${roomNo.get(wp.room_id) ?? '?'} · РМ ${String(wp.workplace_no)}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

const TITLES: Record<Operation, string> = {
  assign: 'Назначение на рабочее место',
  move: 'Перемещение',
  return: 'Возврат на склад',
};

const NOTES: Record<Operation, string> = {
  assign: 'Оборудование перейдёт в статус «В эксплуатации».',
  move: 'Укажите новое рабочее место и/или нового сотрудника. Незаполненное останется прежним.',
  return: 'Оборудование будет снято с рабочего места и вернётся в статус «На складе».',
};

function fields(operation: Operation): FieldSpec[] {
  const basis: FieldSpec = { name: 'basis', label: 'Основание', kind: 'text', maxLength: 255, placeholder: 'Заявка, служебная записка…' };
  if (operation === 'return') return [basis];
  return [
    { name: 'workplace_id', label: 'Рабочее место', kind: 'select', required: operation === 'assign', options: workplaceOptions },
    { name: 'employee_id', label: 'Сотрудник', kind: 'select', options: () => catalogOptions('employees') },
    basis,
  ];
}

/** Окно операции назначения/перемещения/возврата. onSaved получает обновлённую карточку. */
export function openAssignmentForm(card: EquipmentCard, operation: Operation, onSaved: (saved: EquipmentCard) => void): void {
  const form = new Form(fields(operation));
  const current = card.workplace_no
    ? h('p', null, 'Сейчас: ', h('strong', null, `каб. ${card.room_no ?? '?'} · РМ ${card.workplace_no}`),
        card.holder_name ? `, выдано: ${card.holder_name}` : '')
    : null;

  new Modal(`${TITLES[operation]}: ${card.inventory_no}`, h('div', null, current, h('p', { class: 'muted' }, NOTES[operation]), form.element), [
    { label: 'Отмена', onClick: () => undefined },
    {
      label: operation === 'return' ? 'Вернуть на склад' : 'Оформить',
      kind: 'primary',
      onClick: async () => {
        const values = form.getValues();
        if (!values) return false;
        if (operation === 'move' && values.workplace_id === null && values.employee_id === null) {
          form.showError('Укажите новое рабочее место или сотрудника');
          return false;
        }
        try {
          onSaved(await api.post<EquipmentCard>(`/equipment/${card.equipment_id}/assignments`, { operation, ...values }));
          return true;
        } catch (error) {
          if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
          else form.showError('Не удалось оформить');
          return false;
        }
      },
    },
  ]).open();
  void form.ready.then(() => form.focusFirst());
}
