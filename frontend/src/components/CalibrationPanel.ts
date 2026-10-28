import { Button } from '../design/components';

export interface CalibrationPanelCallbacks {
  onApply: (lengthCm: number) => void;
  onRedraw: () => void;
  onCancel: () => void;
}

/**
 * Панель калибровки подложки над холстом. Два шага: сначала подсказка
 * провести отрезок по известному размеру на картинке, затем — длина этого
 * отрезка в сантиметрах. Сам отрезок рисует FloorPlanCanvas; панель только
 * показывает шаг и отдаёт введённую длину.
 */
export class CalibrationPanel {
  readonly element: HTMLDivElement;
  private readonly text: HTMLParagraphElement;
  private readonly form: HTMLFormElement;
  private readonly lengthInput: HTMLInputElement;

  constructor(callbacks: CalibrationPanelCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'calibration-panel';
    this.element.hidden = true;

    const title = document.createElement('div');
    title.className = 't-label';
    title.textContent = 'Калибровка подложки';

    this.text = document.createElement('p');
    this.text.className = 'calibration-text';

    this.lengthInput = document.createElement('input');
    this.lengthInput.type = 'number';
    this.lengthInput.min = '1';
    this.lengthInput.step = '1';
    this.lengthInput.required = true;
    this.lengthInput.placeholder = 'например, 300';
    this.lengthInput.setAttribute('aria-label', 'Длина отрезка, см');

    const label = document.createElement('label');
    label.className = 'calibration-field';
    const caption = document.createElement('span');
    caption.textContent = 'Длина отрезка, см';
    label.append(caption, this.lengthInput);

    const actions = document.createElement('div');
    actions.className = 'calibration-actions';
    actions.append(
      Button('Перерисовать', { variant: 'light', onClick: () => callbacks.onRedraw() }),
      Button('Применить', { type: 'submit' }),
    );

    this.form = document.createElement('form');
    this.form.className = 'calibration-form';
    this.form.append(label, actions);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const length = Number(this.lengthInput.value);
      if (Number.isFinite(length) && length > 0) callbacks.onApply(length);
      else this.lengthInput.focus();
    });

    this.element.append(
      title,
      this.text,
      this.form,
      Button('Отмена', { variant: 'light', onClick: () => callbacks.onCancel() }),
    );
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') callbacks.onCancel();
    });
  }

  /** Шаг 1: провести отрезок. */
  showDraw(): void {
    this.element.hidden = false;
    this.form.hidden = true;
    this.text.textContent =
      'Проведите на подложке отрезок вдоль известного размера — например, стены или размерной линии. ' +
      'Shift — строго по горизонтали или вертикали.';
  }

  /** Шаг 2: отрезок есть, нужна его настоящая длина. */
  showLength(): void {
    this.element.hidden = false;
    this.form.hidden = false;
    this.text.textContent = 'Сколько сантиметров на самом деле в этом отрезке?';
    this.lengthInput.value = '';
    this.lengthInput.focus();
  }

  hide(): void {
    this.element.hidden = true;
  }
}
