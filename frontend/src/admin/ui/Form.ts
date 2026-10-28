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
  /**
   * Для text: выпадающий список с поиском по вводу. Варианты считаются по текущим значениям формы
   * (список может зависеть от других полей); если введённого значения в списке нет, предлагается добавить его.
   */
  suggestions?: (values: Record<string, Scalar>) => string[];
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
          field.suggestions ? this.createCombo(field, control as HTMLInputElement) : control,
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

  /** Поле ввода с выпадающим списком: фильтр по набранному, «Добавить …» для нового значения. */
  private createCombo(field: FieldSpec, input: HTMLInputElement): HTMLElement {
    const list = h('ul', { class: 'combo-list', role: 'listbox', hidden: true });
    let items: HTMLElement[] = [];
    let active = -1;

    const close = () => {
      list.hidden = true;
      active = -1;
    };
    const choose = (text: string) => {
      input.value = text;
      close();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const highlight = (index: number) => {
      active = items.length ? (index + items.length) % items.length : -1;
      items.forEach((item, i) => item.classList.toggle('active', i === active));
      items[active]?.scrollIntoView({ block: 'nearest' });
    };
    const open = () => {
      const typed = input.value.trim();
      const wanted = typed.toLowerCase();
      const variants = field.suggestions!(this.snapshot());
      const shown = variants.filter((text) => text.toLowerCase().includes(wanted));
      const texts = typed && !variants.some((text) => text.toLowerCase() === wanted)
        ? [...shown, `Добавить «${typed}»`]
        : shown;
      items = texts.map((text, i) => {
        const adding = i === shown.length && texts.length > shown.length;
        return h('li', {
          role: 'option',
          class: adding ? 'combo-add' : null,
          // mousedown, а не click: иначе поле потеряет фокус и список закроется раньше выбора
          onmousedown: (event) => {
            event.preventDefault();
            choose(adding ? typed : text);
          },
        }, text);
      });
      list.replaceChildren(...items);
      list.hidden = items.length === 0;
      active = -1;
    };

    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (list.hidden) open();
        highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
        event.preventDefault();
      } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
        items[active].dispatchEvent(new MouseEvent('mousedown', { cancelable: true }));
        event.preventDefault();
      } else if (event.key === 'Escape' && !list.hidden) {
        close();
        event.stopPropagation();
      }
    });
    return h('div', { class: 'combo' }, input, list);
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
    if (control instanceof HTMLInputElement && control.type === 'checkbox') {
      control.checked = value === true;
    } else if (value !== null) {
      this.setControl(field, control, value);
    }
  }

  private setControl(field: FieldSpec, control: Control, value: Scalar): void {
    control.value = value === null ? '' : String(value);
    if (field.kind === 'checkboxes') {
      const codes = control.value.split(',');
      for (const box of this.boxes.get(field.name) ?? []) box.checked = codes.includes(box.value);
    }
  }

  /** Программно задаёт значения полей (например, подставляет характеристики модели). */
  setValues(values: Record<string, Scalar>): void {
    for (const field of this.fields) {
      const control = this.controls.get(field.name);
      if (!control || !(field.name in values)) continue;
      if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = values[field.name] === true;
      else this.setControl(field, control, values[field.name]);
    }
    this.refreshVisibility();
  }

  /** Текущие значения полей без проверки обязательности. */
  currentValues(): Record<string, Scalar> {
    return this.snapshot();
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
