import { Button } from '../design/components';

export interface BackgroundMenuState {
  /** Подложка загружена. */
  has: boolean;
  visible: boolean;
  /** 0…1 */
  opacity: number;
  /** Включён режим перемещения подложки. */
  moving: boolean;
}

export interface BackgroundMenuCallbacks {
  onLoad: (file: File) => void;
  onCalibrate: () => void;
  onMoveToggle: () => void;
  onVisibleToggle: () => void;
  onOpacity: (opacity: number) => void;
  onRemove: () => void;
}

/**
 * Кнопка «Подложка» в нижней панели и её меню: загрузить картинку (дальше —
 * калибровка), откалибровать заново, перемещать, скрыть/показать,
 * прозрачность, удалить. Без загруженной подложки доступна только загрузка.
 * Состояние подложки хранит FloorPlanCanvas — меню рисует то, что передали
 * в render().
 */
export class BackgroundMenu {
  readonly element: HTMLDivElement;
  private readonly trigger: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly calibrateButton: HTMLButtonElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly visibleButton: HTMLButtonElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly opacityInput: HTMLInputElement;
  private readonly opacityValue: HTMLSpanElement;

  constructor(callbacks: BackgroundMenuCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'background-menu';

    this.trigger = Button('Подложка ▴', { variant: 'light', onClick: () => this.toggle() });
    this.trigger.setAttribute('aria-haspopup', 'true');
    this.trigger.setAttribute('aria-expanded', 'false');

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*,application/pdf';
    this.fileInput.id = 'input-background';
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      // Сброс значения — чтобы тот же файл можно было выбрать снова.
      this.fileInput.value = '';
      if (!file) return;
      this.close();
      callbacks.onLoad(file);
    });
    const load = document.createElement('label');
    load.className = 'arm-btn arm-btn-light file-btn';
    load.append('Загрузить…', this.fileInput);

    this.calibrateButton = this.item('Калибровать', () => {
      this.close();
      callbacks.onCalibrate();
    });
    this.moveButton = this.item('Переместить', () => callbacks.onMoveToggle());
    this.visibleButton = this.item('Скрыть', () => callbacks.onVisibleToggle());
    this.removeButton = this.item('Удалить', () => {
      this.close();
      callbacks.onRemove();
    });

    this.opacityInput = document.createElement('input');
    this.opacityInput.type = 'range';
    this.opacityInput.min = '10';
    this.opacityInput.max = '100';
    this.opacityInput.step = '5';
    this.opacityInput.setAttribute('aria-label', 'Непрозрачность подложки, %');
    this.opacityValue = document.createElement('span');
    this.opacityInput.addEventListener('input', () => {
      this.opacityValue.textContent = `${this.opacityInput.value}%`;
      callbacks.onOpacity(Number(this.opacityInput.value) / 100);
    });
    const opacity = document.createElement('label');
    opacity.className = 'background-menu-opacity';
    const caption = document.createElement('span');
    caption.textContent = 'Непрозрачность';
    opacity.append(caption, this.opacityInput, this.opacityValue);

    this.panel = document.createElement('div');
    this.panel.className = 'background-menu-panel';
    this.panel.hidden = true;
    this.panel.append(load, this.calibrateButton, this.moveButton, this.visibleButton, opacity, this.removeButton);
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.element.append(this.trigger, this.panel);
  }

  render(state: BackgroundMenuState): void {
    [this.calibrateButton, this.moveButton, this.visibleButton, this.removeButton, this.opacityInput].forEach(
      (control) => {
        control.disabled = !state.has;
      },
    );
    this.moveButton.setAttribute('aria-pressed', String(state.moving));
    this.moveButton.textContent = state.moving ? 'Закончить перемещение' : 'Переместить';
    this.visibleButton.textContent = state.visible ? 'Скрыть' : 'Показать';
    const percent = Math.round(state.opacity * 100);
    this.opacityInput.value = String(percent);
    this.opacityValue.textContent = `${percent}%`;
  }

  private item(label: string, onClick: () => void): HTMLButtonElement {
    return Button(label, { variant: 'light', onClick });
  }

  private toggle(): void {
    if (this.panel.hidden) {
      this.panel.hidden = false;
      this.trigger.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', this.handleOutsidePointer, true);
    } else {
      this.close();
    }
  }

  private close(): void {
    this.panel.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.element.contains(event.target)) this.close();
  };
}
