import { ApiError, api } from '../api/client';
import type { EquipmentCard, Scalar } from '../api/types';
import { catalogOptions, loadCatalog } from '../lookups';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { h } from '../ui/dom';

async function modelOptions() {
  const [models, types, manufacturers] = await Promise.all([
    loadCatalog('equipment-models'),
    loadCatalog('equipment-types'),
    loadCatalog('manufacturers'),
  ]);
  const typeName = new Map(types.map((t) => [t.type_id, String(t.name)]));
  const manufacturerName = new Map(manufacturers.map((m) => [m.manufacturer_id, String(m.name)]));
  return models.map((model) => ({
    value: Number(model.model_id),
    label: `${typeName.get(model.type_id) ?? ''}: ${manufacturerName.get(model.manufacturer_id) ?? ''} ${String(model.name)}`,
  }));
}

const FIELDS: FieldSpec[] = [
  { name: 'inventory_no', label: 'Инвентарный номер', kind: 'text', required: true, maxLength: 20, placeholder: 'ВТ-000000' },
  { name: 'model_id', label: 'Модель', kind: 'select', required: true, options: modelOptions },
  { name: 'serial_no', label: 'Серийный номер', kind: 'text', maxLength: 50 },
  { name: 'mol_id', label: 'Материально ответственное лицо', kind: 'select',
    options: () => catalogOptions('employees', (e) => e.is_mol === true) },
  { name: 'os_id', label: 'Операционная система', kind: 'select', options: () => catalogOptions('operating-systems') },
  { name: 'cpu', label: 'Процессор', kind: 'text', maxLength: 50 },
  { name: 'ram_gb', label: 'ОЗУ, ГБ', kind: 'integer', min: 0, max: 32767 },
  { name: 'storage_gb', label: 'Накопитель, ГБ', kind: 'integer', min: 0, max: 32767 },
  { name: 'hostname', label: 'Сетевое имя', kind: 'text', maxLength: 50 },
  { name: 'ip_address', label: 'IP-адрес', kind: 'text', maxLength: 20 },
  { name: 'commissioned_on', label: 'Дата ввода в эксплуатацию', kind: 'date' },
  { name: 'book_value', label: 'Балансовая стоимость, ₽', kind: 'decimal', min: 0 },
];

/**
 * Окно постановки на учёт (card === null) или правки карточки.
 * onSaved получает сохранённую карточку.
 */
export function openEquipmentForm(card: EquipmentCard | null, onSaved: (saved: EquipmentCard) => void): void {
  const initial: Record<string, Scalar> = {};
  if (card) {
    for (const field of FIELDS) {
      initial[field.name] = (card as unknown as Record<string, Scalar>)[field.name] ?? null;
    }
  }
  const form = new Form(FIELDS, initial);
  const note = card
    ? null
    : h('p', { class: 'muted' }, 'Оборудование ставится на учёт со статусом «На складе». Размещение на рабочем месте — через назначение.');

  new Modal(card ? `Карточка ${card.inventory_no}` : 'Постановка оборудования на учёт', h('div', null, note, form.element), [
    { label: 'Отмена', onClick: () => undefined },
    {
      label: card ? 'Сохранить' : 'Поставить на учёт',
      kind: 'primary',
      onClick: async () => {
        const values = form.getValues();
        if (!values) return false;
        try {
          const saved = card
            ? await api.put<EquipmentCard>(`/equipment/${card.equipment_id}`, values)
            : await api.post<EquipmentCard>('/equipment', values);
          onSaved(saved);
          return true;
        } catch (error) {
          if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
          else form.showError('Не удалось сохранить');
          return false;
        }
      },
    },
  ]).open();
  void form.ready.then(() => form.focusFirst());
}
