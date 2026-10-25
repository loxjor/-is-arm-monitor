// Разметка компонентов дизайн-системы «АРМ Монитор» (project/components/*/preview.html).
// Стили — styles/components.css; здесь только сборка DOM, чтобы классы и
// aria-атрибуты не повторялись по экранам вручную.

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
}

// ─── Button ────────────────────────────────────────────────────

/** dark — главная (одна на группу), light — вторичная, accent — одно ключевое действие на экран. */
export type ButtonVariant = 'dark' | 'light' | 'accent' | 'danger';

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  dark: 'arm-btn',
  light: 'arm-btn arm-btn-light',
  accent: 'arm-btn arm-btn-accent',
  danger: 'arm-btn arm-btn-danger',
};

export function buttonClass(variant: ButtonVariant = 'dark'): string {
  return BUTTON_CLASSES[variant];
}

export interface ButtonOptions {
  variant?: ButtonVariant;
  onClick?: (event: MouseEvent) => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
}

export function Button(label: string, options: ButtonOptions = {}): HTMLButtonElement {
  const button = el('button', buttonClass(options.variant), label);
  button.type = options.type ?? 'button';
  button.disabled = options.disabled ?? false;
  if (options.title) button.title = options.title;
  if (options.onClick) button.addEventListener('click', options.onClick);
  return button;
}

export function ButtonLink(label: string, href: string, variant: ButtonVariant = 'light'): HTMLAnchorElement {
  const link = el('a', buttonClass(variant), label);
  link.href = href;
  return link;
}

// ─── Chip ──────────────────────────────────────────────────────

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Короткий код перед подписью: «А» у «Корпус А». */
  code?: string;
}

export function Chip(label: string, pressed: boolean, code?: string): HTMLButtonElement {
  const chip = el('button', 'arm-chip');
  chip.type = 'button';
  if (code) chip.append(el('span', 'arm-code', code), ' ');
  chip.append(label);
  chip.setAttribute('aria-pressed', String(pressed));
  return chip;
}

/** Ряд таблеток-фильтров с одним выбранным значением. */
export class ChipGroup<T extends string> {
  readonly element: HTMLDivElement;
  private chips: { value: T; chip: HTMLButtonElement }[] = [];
  private current: T;

  constructor(
    label: string,
    options: ChipOption<T>[],
    value: T,
    private readonly onChange: (value: T) => void,
  ) {
    this.element = el('div', 'chip-row');
    this.element.setAttribute('role', 'group');
    this.element.setAttribute('aria-label', label);
    this.current = value;
    this.setOptions(options);
  }

  get value(): T {
    return this.current;
  }

  set value(value: T) {
    this.current = value;
    for (const { value: chipValue, chip } of this.chips) {
      chip.setAttribute('aria-pressed', String(chipValue === value));
    }
  }

  setOptions(options: ChipOption<T>[]): void {
    this.chips = options.map((option) => {
      const chip = Chip(option.label, option.value === this.current, option.code);
      chip.addEventListener('click', () => {
        if (option.value === this.current) return;
        this.value = option.value;
        this.onChange(option.value);
      });
      return { value: option.value, chip };
    });
    this.element.replaceChildren(...this.chips.map(({ chip }) => chip));
  }
}

// ─── SpecTile ──────────────────────────────────────────────────

/** Плитка характеристики: одно значение, подпись под ним и необязательный тег в углу. */
export function SpecTile(value: string, label: string, tag?: string): HTMLDivElement {
  const tile = el('div', 'arm-spec');
  if (tag) tile.append(el('span', 'arm-spec-tag', tag));
  tile.append(el('span', 'arm-spec-value', value), el('span', 'arm-spec-label', label));
  return tile;
}

export function SpecRow(tiles: HTMLElement[]): HTMLDivElement {
  return el('div', 'spec-row', ...tiles);
}

// ─── StatusBadge ───────────────────────────────────────────────

/** free/occupied/reserved — статусы места; neutral — прочие состояния (списано, закрыто). */
export type StatusKind = 'free' | 'occupied' | 'reserved' | 'neutral';

export function StatusBadge(kind: StatusKind, text: string): HTMLSpanElement {
  return el('span', `arm-status arm-status-${kind}`, text);
}

// ─── TreeNav ───────────────────────────────────────────────────

export interface TreeNavLink {
  href: string;
  label: string;
  isNew?: boolean;
}

/** Группа с раскрывающимися ссылками или (с href) самостоятельный пункт на уровне групп. */
export interface TreeNavGroup {
  title: string;
  links: TreeNavLink[];
  href?: string;
}

interface TreeNavSection {
  toggle: HTMLButtonElement;
  list: HTMLUListElement;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface TreeNavOptions {
  label?: string;
  collapsed?: boolean;
  /** Куда переезжает знак, пока меню свёрнуто (например, в шапку страницы). */
  collapsedSlot?: HTMLElement;
  /** Перед сменой раскладки, пока знак ещё на прежнем месте — чтобы запомнить положения блоков. */
  onBeforeToggle?: () => void;
  /**
   * Знак нажали — меню свернули или развернули. Вызывается синхронно, до
   * анимации знака: здесь можно перестроить раскладку страницы, и знак
   * поедет уже к своему итоговому месту.
   */
  onToggle?: (collapsed: boolean) => void;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
// Сколько длится первая фаза сворачивания — исчезновение блоков (см. styles/base.css).
const COLLAPSE_FADE_MS = 340;

/**
 * FLIP-анимация: элемент уже стоит на новом месте, а визуально плавно
 * доезжает туда из прежнего положения first.
 */
export function slideFrom(element: Element, first: DOMRect, duration = 350): void {
  if (window.matchMedia(REDUCED_MOTION).matches) return;
  const last = element.getBoundingClientRect();
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  element.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    // easeInOutCubic: мягкий разгон и торможение — без рывка в начале движения.
    { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' },
  );
}

/**
 * FLIP для блоков внутри root, которые перестраиваются из-за смены его
 * ширины: запоминает их положение (относительно root) и ширину сейчас,
 * а возвращённая функция после смены раскладки плавно доводит блоки до
 * нового места и новой ширины. Берутся только внешние блоки из selector —
 * вложенные едут вместе с ними, иначе сдвиг сложился бы дважды — и только
 * видимые на экране, чтобы длинные таблицы не анимировались целиком.
 */
export function captureLayout(root: Element, selector: string, duration = 350): () => void {
  if (window.matchMedia(REDUCED_MOTION).matches) return () => undefined;
  const rootBefore = root.getBoundingClientRect();
  const blocks: { element: HTMLElement; left: number; top: number; width: number }[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (blocks.some((block) => block.element.contains(element))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
    blocks.push({ element, left: rect.left - rootBefore.left, top: rect.top - rootBefore.top, width: rect.width });
  }

  return () => {
    const rootAfter = root.getBoundingClientRect();
    for (const block of blocks) {
      const rect = block.element.getBoundingClientRect();
      const dx = block.left - (rect.left - rootAfter.left);
      const dy = block.top - (rect.top - rootAfter.top);
      const resized = Math.abs(block.width - rect.width) > 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !resized) continue;
      const from: Keyframe = { transform: `translate(${dx}px, ${dy}px)` };
      const to: Keyframe = { transform: 'translate(0, 0)' };
      if (resized) {
        from.width = `${block.width}px`;
        to.width = `${rect.width}px`;
      }
      block.element.animate([from, to], { duration, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
    }
  };
}

/**
 * Древовидное меню: от знака к каждой группе идёт плавная ветка. Ветки
 * строятся по фактическим позициям заголовков групп и перестраиваются при
 * изменении размеров (перенос строк, мобильная раскладка).
 *
 * Знак — кнопка: сворачивает меню и разворачивает обратно. В свёрнутом виде
 * знак живёт в collapsedSlot и переезжает туда и обратно FLIP-анимацией;
 * ветки и блоки групп анимирует CSS (styles/base.css) — порядок появления
 * задаёт переменная --i у каждого блока.
 */
export class TreeNav {
  readonly element: HTMLElement;
  readonly links: HTMLAnchorElement[] = [];
  private readonly brandButton: HTMLButtonElement;
  private animating = false;
  private readonly body: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly titles: HTMLDivElement[] = [];
  private readonly sections: TreeNavSection[] = [];

  constructor(brand: string, groups: TreeNavGroup[], private readonly options: TreeNavOptions = {}) {
    this.brandButton = el('button', 'arm-tree-brand', el('span', 'arm-tree-mark'), brand);
    this.brandButton.type = 'button';
    this.brandButton.setAttribute('aria-controls', 'arm-tree-body');
    this.brandButton.addEventListener('click', () => {
      if (this.animating) return;
      const collapse = !this.collapsed;
      const switchLayout = () => {
        this.options.onBeforeToggle?.();
        const first = this.brandButton.getBoundingClientRect();
        this.setCollapsed(collapse);
        this.options.onToggle?.(collapse);
        // Знак отъезжает из шапки к корню дерева (или обратно), фокус остаётся на нём.
        slideFrom(this.brandButton, first);
        this.brandButton.focus();
      };
      if (!collapse || window.matchMedia(REDUCED_MOTION).matches) {
        switchLayout();
        return;
      }
      // Сворачивание в две фазы: сначала блоки уезжают и ветки втягиваются, пока
      // панель ещё на месте, и только потом панель убирается, а знак едет в шапку.
      // Если убрать панель сразу, блоки обрезаются на полпути — анимация дёргается.
      this.animating = true;
      this.element.classList.add('arm-tree--collapsed');
      window.setTimeout(() => {
        switchLayout();
        this.animating = false;
      }, COLLAPSE_FADE_MS);
    });

    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('aria-hidden', 'true');
    this.body = el('div', 'arm-tree-body');
    this.body.id = 'arm-tree-body';
    this.body.append(this.svg);
    groups.forEach((group, index) => {
      if (group.href) {
        // Самостоятельный пункт: таблетка-ссылка со своей веткой, без подпунктов.
        const link = el('a', 'arm-chip arm-tree-toggle', group.title);
        link.href = group.href;
        this.links.push(link);
        const title = el('div', 'arm-tree-group', link);
        title.style.setProperty('--i', String(index));
        this.titles.push(title);
        this.body.append(title);
        return;
      }
      // Заголовок группы — таблетка-кнопка: раскрывает и сворачивает свои ссылки.
      const toggle = Chip(group.title, false);
      toggle.removeAttribute('aria-pressed');
      toggle.classList.add('arm-tree-toggle');
      const listId = `arm-tree-list-${index}`;
      toggle.setAttribute('aria-controls', listId);
      const title = el('div', 'arm-tree-group', toggle);
      this.titles.push(title);
      const list = el('ul', '');
      list.id = listId;
      const section: TreeNavSection = { toggle, list };
      this.sections.push(section);
      toggle.addEventListener('click', () => this.setExpanded(section, list.hidden));
      for (const item of group.links) {
        const link = el('a', '', item.label);
        link.href = item.href;
        if (item.isNew) link.append(el('span', 'arm-new', 'NEW'));
        this.links.push(link);
        list.append(el('li', '', link));
      }
      title.style.setProperty('--i', String(index));
      list.style.setProperty('--i', String(index));
      this.body.append(title, list);
      this.setExpanded(section, false);
    });

    this.element = el('nav', 'arm-tree arm-tree-collapsible', this.brandButton, this.body);
    this.element.setAttribute('aria-label', options.label ?? 'Разделы');
    this.setCollapsed(options.collapsed ?? false);
    new ResizeObserver(() => this.drawBranches()).observe(this.body);
  }

  get collapsed(): boolean {
    return this.element.classList.contains('arm-tree--collapsed');
  }

  setCollapsed(collapsed: boolean): void {
    const slot = this.options.collapsedSlot;
    if (collapsed && slot) slot.append(this.brandButton);
    else if (this.brandButton.parentElement !== this.element) this.element.prepend(this.brandButton);
    this.element.classList.toggle('arm-tree--collapsed', collapsed);
    this.brandButton.setAttribute('aria-expanded', String(!collapsed));
    this.brandButton.title = collapsed ? 'Открыть меню' : 'Свернуть меню';
    // Свёрнутые блоки не должны ловить Tab и читаться скринридером.
    this.body.inert = collapsed;
  }

  /** Отмечает текущий пункт и раскрывает его группу; открытые вручную группы не сворачивает. */
  setCurrent(href: string | null): void {
    for (const link of this.links) {
      if (link.getAttribute('href') === href) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const section of this.sections) {
      if (section.list.querySelector('[aria-current="page"]')) this.setExpanded(section, true);
    }
  }

  private setExpanded({ toggle, list }: TreeNavSection, expanded: boolean): void {
    list.hidden = !expanded;
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  private drawBranches(): void {
    // Ширина веток — расстояние, на которое CSS вынес svg левее тела меню.
    const width = -parseFloat(getComputedStyle(this.svg).left) || 0;
    const first = this.titles[0]?.offsetTop ?? 0;
    const ys = this.titles.map((title) => title.offsetTop - first);
    const height = Math.max(0, ...ys);
    this.svg.setAttribute('width', String(width));
    this.svg.setAttribute('height', String(height + 1));
    // Пути не пересоздаются, а только меняют форму: перестройка срабатывает и
    // в момент раскрытия меню, а новый путь появился бы сразу целиком, мимо
    // анимации прорисовки (stroke-dashoffset).
    while (this.svg.childElementCount > ys.length) this.svg.lastElementChild?.remove();
    ys.forEach((y, index) => {
      let path = this.svg.children[index] as SVGPathElement | undefined;
      if (!path) {
        path = document.createElementNS(SVG_NS, 'path');
        // pathLength=1 — ветка «прорисовывается» через stroke-dashoffset независимо от длины.
        path.setAttribute('pathLength', '1');
        path.style.setProperty('--i', String(index));
        this.svg.append(path);
      }
      // Первые 5% ширины ветка идёт прямо от знака и только потом изгибается к группе.
      const bendStart = width * 0.05;
      const span = width - bendStart;
      path.setAttribute(
        'd',
        `M0 0 H ${bendStart} C ${bendStart + span * 0.6} 0, ${bendStart + span * 0.4} ${y}, ${width} ${y}`,
      );
    });
  }
}
