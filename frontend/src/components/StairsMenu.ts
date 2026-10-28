import { STAIR_MENU, STAIR_VARIANTS, type StairVariant } from '../types/fixture';

/**
 * Меню вида лестницы у кнопки «Лестница» (как в RemPlanner): группы
 * («Прямые», «Угловые на 90°», «Полуоборотные на 180°») раскрываются по
 * клику, одиночные виды выбираются сразу. Выбор — в onPick, дальше
 * редактор переходит к расстановке этого вида.
 */
export class StairsMenu {
  readonly element: HTMLDivElement;
  private anchor: HTMLElement | null = null;

  constructor(private readonly onPick: (variant: StairVariant) => void) {
    this.element = document.createElement('div');
    this.element.className = 'stairs-menu';
    this.element.hidden = true;
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', 'Вид лестницы');

    STAIR_MENU.forEach((group) => {
      if (group.items.length === 1) {
        this.element.append(this.item(group.title, group.items[0], 'stairs-menu-item'));
        return;
      }
      const sub = document.createElement('div');
      sub.className = 'stairs-menu-sub';
      sub.hidden = true;
      group.items.forEach((variant) => sub.append(this.item(STAIR_VARIANTS[variant].name, variant, 'stairs-menu-subitem')));

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'stairs-menu-item stairs-menu-group';
      header.setAttribute('aria-expanded', 'false');
      header.append(group.title, Object.assign(document.createElement('span'), { className: 'stairs-menu-chevron', textContent: '⌄' }));
      header.addEventListener('click', () => {
        sub.hidden = !sub.hidden;
        header.setAttribute('aria-expanded', String(!sub.hidden));
      });
      this.element.append(header, sub);
    });

    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
  }

  /** Открыть рядом с кнопкой инструмента — справа от неё. */
  open(anchor: HTMLElement): void {
    this.anchor = anchor;
    const rect = anchor.getBoundingClientRect();
    this.element.style.left = `${rect.right + 8}px`;
    this.element.style.top = `${rect.top}px`;
    this.element.hidden = false;
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  close(): void {
    this.element.hidden = true;
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  isOpen(): boolean {
    return !this.element.hidden;
  }

  private item(text: string, variant: StairVariant, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.setAttribute('role', 'menuitem');
    button.textContent = text;
    button.addEventListener('click', () => {
      this.close();
      this.onPick(variant);
    });
    return button;
  }

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    const target = event.target;
    if (target instanceof Node && !this.element.contains(target) && !this.anchor?.contains(target)) this.close();
  };
}
