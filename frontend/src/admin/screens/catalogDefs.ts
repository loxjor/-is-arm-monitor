import { catalogOptions } from '../lookups';
import type { FieldSpec } from '../ui/Form';

export interface CatalogColumn {
  title: string;
  field: string;
  /** Внешний ключ: показывать подпись записи из этого справочника. */
  ref?: string;
  format?: 'bool' | 'months';
}

export interface CatalogDef {
  path: string;
  title: string;
  singular: string;
  columns: CatalogColumn[];
  fields: FieldSpec[];
}

const select = (name: string, label: string, ref: string, required = false): FieldSpec => ({
  name, label, kind: 'select', required, options: () => catalogOptions(ref),
});

export const CATALOG_DEFS: CatalogDef[] = [
  {
    path: 'departments',
    title: 'Подразделения',
    singular: 'подразделение',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Краткое', field: 'short_name' },
      { title: 'Телефон', field: 'phone' },
      { title: 'Вышестоящее', field: 'parent_dept_id', ref: 'departments' },
      { title: 'Руководитель', field: 'head_employee_id', ref: 'employees' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 255 },
      { name: 'short_name', label: 'Краткое наименование', kind: 'text', maxLength: 50 },
      { name: 'phone', label: 'Телефон', kind: 'text', maxLength: 20 },
      select('parent_dept_id', 'Вышестоящее подразделение', 'departments'),
      select('head_employee_id', 'Руководитель', 'employees'),
    ],
  },
  {
    path: 'employees',
    title: 'Сотрудники',
    singular: 'сотрудника',
    columns: [
      { title: 'ФИО', field: 'full_name' },
      { title: 'Должность', field: 'position' },
      { title: 'Подразделение', field: 'dept_id', ref: 'departments' },
      { title: 'МОЛ', field: 'is_mol', format: 'bool' },
      { title: 'Телефон', field: 'phone' },
      { title: 'E-mail', field: 'email' },
    ],
    fields: [
      { name: 'full_name', label: 'ФИО', kind: 'text', required: true, maxLength: 150 },
      { name: 'position', label: 'Должность', kind: 'text', required: true, maxLength: 150 },
      select('dept_id', 'Подразделение', 'departments', true),
      { name: 'is_mol', label: 'Материально ответственное лицо', kind: 'checkbox' },
      { name: 'phone', label: 'Телефон', kind: 'text', maxLength: 20 },
      { name: 'email', label: 'Электронная почта', kind: 'text', maxLength: 150 },
    ],
  },
  {
    path: 'buildings',
    title: 'Здания',
    singular: 'здание',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Адрес', field: 'address' },
      { title: 'Этажей', field: 'floors_count' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 50 },
      { name: 'address', label: 'Адрес', kind: 'text', required: true, maxLength: 255 },
      { name: 'floors_count', label: 'Количество этажей', kind: 'integer', min: 0 },
    ],
  },
  {
    path: 'rooms',
    title: 'Помещения',
    singular: 'помещение',
    columns: [
      { title: 'Номер', field: 'room_no' },
      { title: 'Этаж', field: 'floor' },
      { title: 'Площадь, м²', field: 'area' },
      { title: 'Здание', field: 'building_id', ref: 'buildings' },
      { title: 'Подразделение', field: 'dept_id', ref: 'departments' },
    ],
    fields: [
      { name: 'room_no', label: 'Номер помещения', kind: 'text', required: true, maxLength: 20 },
      { name: 'floor', label: 'Этаж', kind: 'integer', required: true },
      { name: 'area', label: 'Площадь, м²', kind: 'decimal', min: 0 },
      select('building_id', 'Здание', 'buildings', true),
      select('dept_id', 'Подразделение', 'departments'),
    ],
  },
  {
    path: 'workplaces',
    title: 'Рабочие места',
    singular: 'рабочее место',
    columns: [
      { title: 'Номер', field: 'workplace_no' },
      { title: 'Помещение', field: 'room_id', ref: 'rooms' },
      { title: 'X на схеме', field: 'x' },
      { title: 'Y на схеме', field: 'y' },
    ],
    fields: [
      { name: 'workplace_no', label: 'Номер рабочего места', kind: 'text', required: true, maxLength: 20 },
      select('room_id', 'Помещение', 'rooms', true),
      { name: 'x', label: 'Координата X', kind: 'decimal', hint: 'Позже будет задаваться на интерактивной схеме' },
      { name: 'y', label: 'Координата Y', kind: 'decimal' },
    ],
  },
  {
    path: 'equipment-types',
    title: 'Типы оборудования',
    singular: 'тип',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Нормативный срок службы', field: 'service_life_months', format: 'months' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 50 },
      { name: 'service_life_months', label: 'Срок службы, мес.', kind: 'integer', required: true, min: 1 },
    ],
  },
  {
    path: 'manufacturers',
    title: 'Производители',
    singular: 'производителя',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Страна', field: 'country' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 50 },
      { name: 'country', label: 'Страна', kind: 'text', maxLength: 50 },
    ],
  },
  {
    path: 'equipment-models',
    title: 'Модели оборудования',
    singular: 'модель',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Тип', field: 'type_id', ref: 'equipment-types' },
      { title: 'Производитель', field: 'manufacturer_id', ref: 'manufacturers' },
      { title: 'Характеристики', field: 'specs' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 150 },
      select('type_id', 'Тип оборудования', 'equipment-types', true),
      select('manufacturer_id', 'Производитель', 'manufacturers', true),
      { name: 'specs', label: 'Технические характеристики', kind: 'textarea' },
    ],
  },
  {
    path: 'operating-systems',
    title: 'Операционные системы',
    singular: 'ОС',
    columns: [
      { title: 'Наименование', field: 'name' },
      { title: 'Версия', field: 'version' },
      { title: 'Отечественная', field: 'is_domestic', format: 'bool' },
    ],
    fields: [
      { name: 'name', label: 'Наименование', kind: 'text', required: true, maxLength: 50 },
      { name: 'version', label: 'Версия', kind: 'text', maxLength: 20 },
      { name: 'is_domestic', label: 'Входит в реестр отечественного ПО', kind: 'checkbox' },
    ],
  },
];
