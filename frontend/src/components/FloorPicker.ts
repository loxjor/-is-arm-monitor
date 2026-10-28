import { Button } from '../design/components';
import { floorName, floorNumber, freeFloorNumbers, type FloorCopyMode } from '../utils/floorCopy';

export interface FloorOption {
  id: string;
  name: string;
  /** Этаж пуст и не последний — его можно удалить. */
  removable: boolean;
}

export interface FloorPickerCallbacks {
  onSelect: (floorId: string) => void;
  onRemove: (floorId: string) => void;
  /** copy: null — пустой этаж, иначе копия текущего (см. copyFloorScene). */
  onCreate: (number: number, copy: FloorCopyMode | null) => void;
  onSilhouette: (visible: boolean) => void;
  onZoom: (direction: 1 | -1) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// Значок здания: высокий корпус и пристройка — как у переключателя этажей в картах.
const BUILDING_PATH = 'M3 18V5l7-3v16M10 18V8l7 3v7M1 18h18';

/**
 * Вертикальная панель у правого края холста, как переключатель этажей в
 * картах: сверху — значок здания (открывает слева форму нового этажа),
 * ниже — номера этажей, верхний сверху, текущий выделен; внизу — масштаб.
 * Форма нового этажа: какой этаж создать, взять ли исходный план или полную
 * копию текущего, показывать ли силуэт нижнего этажа фоном; там же —
 * удаление текущего этажа, только пустого, чтобы не потерять начерченное
 * одним кликом. Этажи компонент не хранит — рисует то, что передали в render().
 */
export class FloorPicker {
  readonly element: HTMLDivElement;
  private readonly floorList: HTMLDivElement;
  private readonly buildingButton: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly numberSelect: HTMLSelectElement;
  private readonly copyPlan: HTMLInputElement;
  private readonly copyFull: HTMLInputElement;
  private readonly silhouette: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;
  private currentId = '';

  constructor(private readonly callbacks: FloorPickerCallbacks) {
    this.element = document.createElement('div');
    this.element.className = 'floor-rail';

    this.buildingButton = this.railButton('Этажи: новый этаж', () => this.toggle());
    this.buildingButton.classList.add('floor-rail-building');
    this.buildingButton.setAttribute('aria-expanded', 'false');
    this.buildingButton.append(this.buildingIcon());

    this.floorList = document.createElement('div');
    this.floorList.className = 'floor-rail-floors';
    this.floorList.setAttribute('role', 'group');
    this.floorList.setAttribute('aria-label', 'Этажи');

    const zoomIn = this.railButton('Приблизить', () => callbacks.onZoom(1));
    zoomIn.textContent = '+';
    const zoomOut = this.railButton('Отдалить', () => callbacks.onZoom(-1));
    zoomOut.textContent = '−';
    const zoom = document.createElement('div');
    zoom.className = 'floor-rail-zoom';
    zoom.append(zoomIn, zoomOut);

    this.numberSelect = document.createElement('select');
    this.numberSelect.setAttribute('aria-label', 'Какой этаж создать');

    this.copyPlan = this.checkbox();
    this.copyFull = this.checkbox();
    // Полная копия включает исходный план — галочки взаимоисключающие.
    this.copyPlan.addEventListener('change', () => {
      if (this.copyPlan.checked) this.copyFull.checked = false;
    });
    this.copyFull.addEventListener('change', () => {
      if (this.copyFull.checked) this.copyPlan.checked = false;
    });
    this.silhouette = this.checkbox();
    this.silhouette.addEventListener('change', () => callbacks.onSilhouette(this.silhouette.checked));

    this.removeButton = Button('Удалить текущий этаж', {
      variant: 'light',
      title: 'Удалить можно только пустой этаж',
      onClick: () => {
        this.close();
        callbacks.onRemove(this.currentId);
      },
    });

    this.panel = document.createElement('div');
    this.panel.className = 'floor-rail-panel';
    this.panel.hidden = true;
    this.panel.append(
      this.numberSelect,
      this.option(this.copyPlan, 'Скопировать исходный план текущего этажа'),
      this.option(this.copyFull, 'Сделать полную копию текущего этажа'),
      this.option(this.silhouette, 'Показать фоном силуэт нижнего этажа'),
      Button('Создать новый этаж', { variant: 'accent', onClick: () => this.create() }),
      this.removeButton,
    );
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });

    this.element.append(this.buildingButton, this.floorList, zoom, this.panel);
  }

  render(floors: readonly FloorOption[], currentId: string): void {
    this.currentId = currentId;
    // Список этажей идёт снизу вверх, а в панели верхний этаж — сверху.
    this.floorList.replaceChildren(
      ...[...floors].reverse().map((floor) => {
        const button = this.railButton(floor.name, () => this.callbacks.onSelect(floor.id));
        button.textContent = String(floorNumber(floor.name) ?? floor.name);
        button.setAttribute('aria-pressed', String(floor.id === currentId));
        return button;
      }),
    );

    const { numbers, suggested } = freeFloorNumbers(floors.map((floor) => floor.name));
    this.numberSelect.replaceChildren(
      ...numbers.map((n) => {
        const option = document.createElement('option');
        option.value = String(n);
        option.textContent = floorName(n);
        return option;
      }),
    );
    this.numberSelect.value = String(suggested);

    this.removeButton.hidden = !floors.find((floor) => floor.id === currentId)?.removable;
  }

  private create(): void {
    const copy: FloorCopyMode | null = this.copyFull.checked ? 'full' : this.copyPlan.checked ? 'plan' : null;
    this.close();
    this.callbacks.onCreate(Number(this.numberSelect.value), copy);
  }

  private toggle(): void {
    if (this.panel.hidden) {
      this.panel.hidden = false;
      this.buildingButton.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', this.handleOutsidePointer, true);
      this.numberSelect.focus();
    } else {
      this.close();
    }
  }

  private close(): void {
    this.panel.hidden = true;
    this.buildingButton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.element.contains(event.target)) this.close();
  };

  private railButton(title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'floor-rail-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onClick);
    return button;
  }

  private buildingIcon(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', BUILDING_PATH);
    svg.append(path);
    return svg;
  }

  private checkbox(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    return input;
  }

  private option(input: HTMLInputElement, text: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'floor-picker-option';
    label.append(input, text);
    return label;
  }
}
