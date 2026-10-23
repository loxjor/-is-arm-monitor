import type { Scalar } from '../api/types';
import type { Option } from '../lookups';
import { h } from './dom';

export type FieldKind = 'text' | 'password' | 'textarea' | 'integer' | 'decimal' | 'date' | 'checkbox' | 'select';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  /** Для select: загрузка вариантов (обычно — из справочника). */
  options?: () => Promise<Option[]>;
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/**
 * Форма по описанию полей. Значения: пустая строка → null, integer → number,
 * decimal → строка (сервер принимает её как Decimal без потерь точности).
 */
export class Form {
  readonly element: HTMLFormElement;
  private readonly controls = new Map<string, Control>();
  private readonly errors = new Map<string, HTMLElement>();
  private readonly general: HTMLElement;
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

      if (field.kind === 'checkbox') {
        this.element.append(
          h('label', { class: 'field field--checkbox' }, control, h('span', null, field.label), error),
        );
      } else {
        this.element.append(
          h(
            'label',
            { class: 'field' },
            h('span', { class: 'field-label' }, field.label, field.required ? h('span', { class: 'req' }, ' *') : null),
            control,
            field.hint ? h('span', { class: 'field-hint' }, field.hint) : null,
            error,
          ),
        );
      }
      loading.push(this.fill(field, control, initial[field.name] ?? null));
    }
    this.ready = Promise.all(loading).then(() => undefined);
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
      case 'integer':
        return h('input', { ...common, type: 'number', step: 1, min: field.min, max: field.max });
      case 'decimal':
        return h('input', { ...common, type: 'number', step: '0.01', min: field.min, max: field.max });
      case 'date':
        return h('input', { ...common, type: 'date' });
      case 'password':
        return h('input', { ...common, type: 'password', autocomplete: 'new-password', maxlength: field.maxLength });
      default:
        return h('input', { ...common, type: 'text', maxlength: field.maxLength, placeholder: field.placeholder });
    }
  }

  private async fill(field: FieldSpec, control: Control, value: Scalar): Promise<void> {
    if (field.kind === 'select' && field.options && control instanceof HTMLSelectElement) {
      const options = await field.options();
      for (const option of options) {
        control.append(h('option', { value: option.value }, option.label));
      }
    }
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = value === true;
    } else if (value !== null) {
      control.value = String(value);
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
      const control = this.controls.get(field.name)!;
      if (field.kind === 'checkbox') {
        values[field.name] = (control as HTMLInputElement).checked;
        continue;
      }
      const raw = control.value.trim();
      if (raw === '') {
        if (field.required) {
          this.setFieldError(field.name, 'обязательное поле');
          valid = false;
        }
        values[field.name] = null;
      } else if (field.kind === 'integer' || field.kind === 'select') {
        values[field.name] = Number(raw);
      } else {
        values[field.name] = raw;
      }
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
