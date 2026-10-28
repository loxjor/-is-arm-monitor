import type { Scalar } from '../api/types';
import type { Option } from '../lookups';
import { h } from './dom';

export type FieldKind =
  | 'text'
  | 'password'
  | 'textarea'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'checkboxes';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  decimalStep?: string;
  placeholder?: string;
  hint?: string;
  /** Для select: загрузка вариантов (обычно — из справочника). */
  options?: () => Promise<Option[]>;
  /** Для checkboxes: набор вариантов; значение поля — коды отмеченных через запятую. */
  choices?: Option[];
  /** Для text: подсказки при вводе (список <datalist>), ввод остаётся свободным. */
  suggestions?: () => Promise<string[]>;
  /** Поле показывается, пока функция возвращает true; скрытое поле не проверяется и отдаёт null. */
  visible?: (values: Record<string, Scalar>) => boolean;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Форма по описанию полей. Значения: пустая строка → null, integer → number,
 * select → number для числовых ключей и строка для перечислений,
 * decimal → строка (сервер принимает её как Decimal без потерь точности).
 */
export class Form {
  readonly element: HTMLFormElement;
  private readonly controls = new Map<string, Control>();
  private readonly errors = new Map<string, HTMLElement>();
  private readonly general: HTMLElement;
  private readonly wrappers = new Map<string, HTMLElement>();
  private readonly boxes = new Map<string, HTMLInputElement[]>();
  readonly ready: Promise<void>;

  constructor(
    private readonly fields: FieldSpec[],
    initial: Record<string, Scalar> = {},
  ) {
    this.general = h('div', { class: 'form-error', role: 'alert' });
    this.element = h('form', { class: 'form', novalidate: true }, this.general);
    const loading: Promise<void>[] = [];

    for (const field of fields) {
      const control = this.createControl(field);
      this.controls.set(field.name, control);
      const error = h('div', { class: 'field-error' });
      this.errors.set(field.name, error);

      let wrapper: HTMLElement;
      if (field.kind === 'checkbox') {
        wrapper = h('label', { class: 'field field--checkbox' }, control, h('span', null, field.label), error);
      } else if (field.kind === 'checkboxes') {
        wrapper = h(
          'div',
          { class: 'field field--wide', role: 'group' },
          h('span', { class: 'field-label' }, field.label),
          h('div', { class: 'check-group' }, control, this.createBoxes(field, control)),
          error,
        );
      } else {
        wrapper = h(
          'label',
          { class: 'field' },
          h('span', { class: 'field-label' }, field.label, field.required ? h('span', { class: 'req' }, ' *') : null),
          control,
          field.hint ? h('span', { class: 'field-hint' }, field.hint) : null,
          error,
        );
      }
      this.wrappers.set(field.name, wrapper);
      this.element.append(wrapper);
      loading.push(this.fill(field, control, initial[field.name] ?? null));
    }
    this.refreshVisibility();
    this.ready = Promise.all(loading).then(() => this.refreshVisibility());
    this.element.addEventListener('input', () => this.refreshVisibility());
    this.element.addEventListener('change', () => this.refreshVisibility());
  }

  /** Группа чекбоксов; скрытое поле хранит отмеченные коды через запятую. */
  private createBoxes(field: FieldSpec, control: Control): HTMLElement[] {
    const boxes = (field.choices ?? []).map((choice) =>
      h('input', {
        type: 'checkbox',
        value: String(choice.value),
        onchange: () => {
          control.value = boxes.filter((box) => box.checked).map((box) => box.value).join(',');
        },
      }),
    );
    this.boxes.set(field.name, boxes);
    return (field.choices ?? []).map((choice, i) => h('label', { class: 'check' }, boxes[i], choice.label));
  }

  /** Показывает только те поля, которым подходят текущие значения формы (например, тип оборудования). */
  private refreshVisibility(): void {
    const values = this.snapshot();
    for (const field of this.fields) {
      if (field.visible) this.wrappers.get(field.name)!.hidden = !field.visible(values);
    }
  }

  private isVisible(field: FieldSpec): boolean {
    return !this.wrappers.get(field.name)!.hidden;
  }

  private readValue(field: FieldSpec, control: Control): Scalar {
    if (field.kind === 'checkbox') return (control as HTMLInputElement).checked;
    const raw = control.value.trim();
    if (raw === '') return null;
    if (field.kind === 'integer') return Number(raw);
    // Ключи справочников — числа, перечисления (тип заявки и т. п.) — строки.
    if (field.kind === 'select') return /^\d+$/.test(raw) ? Number(raw) : raw;
    return raw;
  }

  /** Текущие значения без проверки обязательности — для условной видимости полей. */
  private snapshot(): Record<string, Scalar> {
    return Object.fromEntries(this.fields.map((f) => [f.name, this.readValue(f, this.controls.get(f.name)!)]));
  }

  private createControl(field: FieldSpec): Control {
    const common = { name: field.name, id: `f-${field.name}` };
    switch (field.kind) {
      case 'textarea':
        return h('textarea', { ...common, rows: 3, maxlength: field.maxLength });
      case 'select':
        return h('select', common, h('option', { value: '' }, field.required ? 'Выберите…' : '— не указано —'));
      case 'checkbox':
        return h('input', { ...common, type: 'checkbox' });
      case 'checkboxes':
        return h('input', { ...common, type: 'hidden' });
      case 'integer':
        return h('input', { ...common, type: 'number', step: 1, min: field.min, max: field.max });
      case 'decimal':
        return h('input', { ...common, type: 'number', step: field.decimalStep ?? '0.01', min: field.min, max: field.max });
      case 'date':
        return h('input', { ...common, type: 'date' });
      case 'password':
        return h('input', { ...common, type: 'password', autocomplete: 'new-password', maxlength: field.maxLength });
      default:
        return h('input', {
          ...common,
          type: 'text',
          maxlength: field.maxLength,
          placeholder: field.placeholder,
          list: field.suggestions ? `dl-${field.name}` : null,
          autocomplete: field.suggestions ? 'off' : null,
        });
    }
  }

  private async fill(field: FieldSpec, control: Control, value: Scalar): Promise<void> {
    if (field.kind === 'select' && field.options && control instanceof HTMLSelectElement) {
      const options = await field.options();
      for (const option of options) {
        control.append(h('option', { value: option.value }, option.label));
      }
    }
    if (field.kind === 'text' && field.suggestions) {
      const list = h('datalist', { id: `dl-${field.name}` });
      for (const text of await field.suggestions()) list.append(h('option', { value: text }));
      control.after(list);
    }
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = value === true;
    } else if (value !== null) {
      control.value = String(value);
      if (field.kind === 'checkboxes') {
        const codes = String(value).split(',');
        for (const box of this.boxes.get(field.name) ?? []) box.checked = codes.includes(box.value);
      }
    }
  }

  focusFirst(): void {
    this.controls.values().next().value?.focus();
  }

  /** Значения формы или null, если не заполнены обязательные поля. */
  getValues(): Record<string, Scalar> | null {
    this.clearErrors();
    const values: Record<string, Scalar> = {};
    let valid = true;

    for (const field of this.fields) {
      if (!this.isVisible(field)) {
        values[field.name] = null;
        continue;
      }
      const value = this.readValue(field, this.controls.get(field.name)!);
      if (value === null && field.required) {
        this.setFieldError(field.name, 'обязательное поле');
        valid = false;
      }
      values[field.name] = value;
    }
    return valid ? values : null;
  }

  setFieldError(name: string, message: string): void {
    const error = this.errors.get(name);
    if (error) {
      error.textContent = message;
      this.controls.get(name)?.classList.add('invalid');
    }
  }

  /** Ошибка без поля (или по полю, которого нет в форме) — общим сообщением сверху. */
  showError(message: string, fieldErrors: Record<string, string> = {}): void {
    const orphans: string[] = [];
    for (const [name, text] of Object.entries(fieldErrors)) {
      if (this.errors.has(name)) this.setFieldError(name, text);
      else orphans.push(`${name}: ${text}`);
    }
    this.general.textContent = [message, ...orphans].join('. ');
  }

  clearErrors(): void {
    this.general.textContent = '';
    for (const [name, error] of this.errors) {
      error.textContent = '';
      this.controls.get(name)?.classList.remove('invalid');
    }
  }
}
