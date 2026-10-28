import { ApiError, api } from '../api/client';
import type { EquipmentCard, Scalar } from '../api/types';
import { catalogOptions, loadCatalog } from '../lookups';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { h } from '../ui/dom';

/** Какие характеристики спрашивать у типа оборудования (по названию из справочника типов). */
type SpecGroup = 'pc' | 'monitor' | 'print' | 'scan';

const TYPE_GROUPS: Record<string, SpecGroup[]> = {
  'системный блок': ['pc'],
  'монитор': ['monitor'],
  'принтер': ['print'],
  'сканер': ['scan'],
  'мфу': ['print', 'scan'],
};

const SCAN_MODE_CHOICES = [
  { value: 'flatbed', label: 'Со стекла' },
  { value: 'feeder', label: 'Потоковая' },
  { value: 'duplex_feeder', label: 'Потоковая двусторонняя' },
];

const names = (records: Record<string, Scalar>[]) => [...new Set(records.map((r) => String(r.name)))].sort();

function buildFields(typeGroups: Map<number, SpecGroup[]>): FieldSpec[] {
  const has = (group: SpecGroup) => (values: Record<string, Scalar>) =>
    typeGroups.get(Number(values.type_id))?.includes(group) ?? false;

  return [
    { name: 'type_id', label: 'Тип оборудования', kind: 'select', required: true,
      options: () => catalogOptions('equipment-types') },
    { name: 'inventory_no', label: 'Инвентарный номер', kind: 'text', required: true, maxLength: 20, placeholder: 'ВТ-000000' },
    { name: 'manufacturer_name', label: 'Производитель', kind: 'text', required: true, maxLength: 50,
      suggestions: async () => names(await loadCatalog('manufacturers')) },
    { name: 'model_name', label: 'Модель', kind: 'text', required: true, maxLength: 150,
      suggestions: async () => names(await loadCatalog('equipment-models')) },
    { name: 'serial_no', label: 'Серийный номер', kind: 'text', maxLength: 50 },

    // Системный блок
    { name: 'cpu', label: 'Процессор', kind: 'text', maxLength: 50, visible: has('pc') },
    { name: 'ram_gb', label: 'ОЗУ, ГБ', kind: 'integer', min: 0, max: 32767, visible: has('pc') },
    { name: 'storage_gb', label: 'Накопитель, ГБ', kind: 'integer', min: 0, max: 32767, visible: has('pc') },

    // Монитор
    { name: 'diagonal_inch', label: 'Диагональ, дюймы', kind: 'decimal', decimalStep: '0.1', min: 0, max: 999,
      visible: has('monitor') },
    { name: 'resolution', label: 'Разрешение', kind: 'text', maxLength: 20, placeholder: '1920×1080',
      visible: has('monitor') },
    { name: 'connection_type', label: 'Тип подключения', kind: 'text', maxLength: 50, placeholder: 'HDMI, VGA, DisplayPort',
      visible: has('monitor') },

    // Принтер и МФУ
    { name: 'is_color', label: 'Печать', kind: 'select', visible: has('print'),
      options: async () => [{ value: 'true', label: 'Цветная' }, { value: 'false', label: 'Чёрно-белая' }] },
    { name: 'cartridge_type', label: 'Тип картриджей', kind: 'text', maxLength: 100, visible: has('print') },
    { name: 'drum_type', label: 'Тип барабанов', kind: 'text', maxLength: 100, visible: has('print') },

    // Сканер и МФУ
    { name: 'scan_modes', label: 'Типы сканирования', kind: 'checkboxes', choices: SCAN_MODE_CHOICES,
      visible: has('scan') },

    { name: 'mol_id', label: 'Материально ответственное лицо', kind: 'select',
      options: () => catalogOptions('employees', (e) => e.is_mol === true) },
    { name: 'os_id', label: 'Операционная система', kind: 'select', options: () => catalogOptions('operating-systems'),
      visible: has('pc') },
    { name: 'hostname', label: 'Сетевое имя', kind: 'text', maxLength: 50 },
    { name: 'ip_address', label: 'IP-адрес', kind: 'text', maxLength: 20 },
    { name: 'commissioned_on', label: 'Дата ввода в эксплуатацию', kind: 'date' },
    { name: 'book_value', label: 'Балансовая стоимость, ₽', kind: 'decimal', min: 0 },
  ];
}

/**
 * Окно постановки на учёт (card === null) или правки карточки.
 * onSaved получает сохранённую карточку.
 */
export async function openEquipmentForm(card: EquipmentCard | null, onSaved: (saved: EquipmentCard) => void): Promise<void> {
  const types = await loadCatalog('equipment-types');
  const typeGroups = new Map<number, SpecGroup[]>(
    types.map((t) => [Number(t.type_id), TYPE_GROUPS[String(t.name).trim().toLowerCase()] ?? ['pc']]),
  );
  const fields = buildFields(typeGroups);

  const initial: Record<string, Scalar> = {};
  if (card) {
    for (const field of fields) {
      initial[field.name] = (card as unknown as Record<string, Scalar>)[field.name] ?? null;
    }
  }
  const form = new Form(fields, initial);
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
