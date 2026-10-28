import { ApiError, api } from '../api/client';
import type { CatalogRecord, EquipmentCard, Scalar } from '../api/types';
import { catalogOptions, invalidateCatalog, loadCatalog } from '../lookups';
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

type Values = Record<string, Scalar>;

const sameName = (a: Scalar, b: Scalar) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** Характеристики, которые подставляются при выборе уже известной модели. */
const SPEC_FIELDS = [
  'cpu', 'ram_gb', 'storage_gb', 'diagonal_inch', 'resolution', 'connection_type',
  'is_color', 'cartridge_type', 'drum_type', 'scan_modes',
];

/** Модели выбранного производителя в выбранном типе: модель — только в рамках производителя. */
function modelsOf(models: CatalogRecord[], manufacturers: CatalogRecord[], values: Values): CatalogRecord[] {
  const manufacturer = manufacturers.find((m) => sameName(m.name, values.manufacturer_name));
  if (!manufacturer) return [];
  return models.filter(
    (m) => m.manufacturer_id === manufacturer.manufacturer_id && Number(m.type_id) === Number(values.type_id),
  );
}

function buildFields(
  typeGroups: Map<number, SpecGroup[]>,
  manufacturers: CatalogRecord[],
  models: CatalogRecord[],
): FieldSpec[] {
  const has = (group: SpecGroup) => (values: Values) =>
    typeGroups.get(Number(values.type_id))?.includes(group) ?? false;

  return [
    { name: 'type_id', label: 'Тип оборудования', kind: 'select', required: true,
      options: () => catalogOptions('equipment-types') },
    { name: 'inventory_no', label: 'Инвентарный номер', kind: 'text', required: true, maxLength: 20, placeholder: 'ВТ-000000' },
    { name: 'manufacturer_name', label: 'Производитель', kind: 'text', required: true, maxLength: 50,
      suggestions: () => manufacturers.map((m) => String(m.name)).sort((a, b) => a.localeCompare(b, 'ru')) },
    { name: 'model_name', label: 'Модель', kind: 'text', required: true, maxLength: 150,
      suggestions: (values) =>
        modelsOf(models, manufacturers, values).map((m) => String(m.name)).sort((a, b) => a.localeCompare(b, 'ru')) },
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
    { name: 'commissioned_on', label: 'Дата ввода в эксплуатацию', kind: 'date' },
    { name: 'book_value', label: 'Балансовая стоимость, ₽', kind: 'decimal', min: 0 },
  ];
}

/**
 * Окно постановки на учёт (card === null) или правки карточки.
 * onSaved получает сохранённую карточку.
 */
export async function openEquipmentForm(card: EquipmentCard | null, onSaved: (saved: EquipmentCard) => void): Promise<void> {
  const [types, manufacturers, models] = await Promise.all([
    loadCatalog('equipment-types'),
    loadCatalog('manufacturers'),
    loadCatalog('equipment-models'),
  ]);
  const typeGroups = new Map<number, SpecGroup[]>(
    types.map((t) => [Number(t.type_id), TYPE_GROUPS[String(t.name).trim().toLowerCase()] ?? ['pc']]),
  );
  const fields = buildFields(typeGroups, manufacturers, models);

  const initial: Record<string, Scalar> = {};
  if (card) {
    for (const field of fields) {
      initial[field.name] = (card as unknown as Record<string, Scalar>)[field.name] ?? null;
    }
  }
  const form = new Form(fields, initial);

  // Смена типа или производителя сбрасывает модель, если такой у них нет; выбор известной модели
  // подставляет характеристики, заданные при первой постановке на учёт этой модели.
  let appliedModelId = card?.model_id ?? null;
  form.element.addEventListener('change', (event) => {
    const name = (event.target as HTMLInputElement).name;
    const values = form.currentValues();
    const model = modelsOf(models, manufacturers, values).find((m) => sameName(m.name, values.model_name));
    if ((name === 'type_id' || name === 'manufacturer_name') && values.model_name !== null && !model) {
      form.setValues({ model_name: null });
      appliedModelId = null;
    }
    if (name !== 'model_name' || !model || Number(model.model_id) === appliedModelId) return;
    const modelId = Number(model.model_id);
    appliedModelId = modelId;
    void api.get<Record<string, Scalar>>(`/equipment/models/${modelId}/specs`).then((specs) => {
      // Модель могли сменить, пока шёл запрос; пустые характеристики не затирают уже введённое.
      if (appliedModelId !== modelId || SPEC_FIELDS.every((field) => specs[field] === null)) return;
      form.setValues(Object.fromEntries(SPEC_FIELDS.map((field) => [field, specs[field] ?? null])));
    }).catch(() => undefined);
  });
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
          // Производитель и модель могли быть заведены этой формой.
          invalidateCatalog('manufacturers');
          invalidateCatalog('equipment-models');
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
