export type Child = Node | string | number | null | undefined | false;
type Listener = (event: Event) => void;
export type Attrs = Record<string, string | number | boolean | Listener | null | undefined>;

/**
 * Создание элемента одной строкой: h('button', { class: 'arm-btn', onclick: fn }, 'Текст').
 * Ключи on* — обработчики событий; false/null/undefined — атрибут не ставится.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      element.className = String(value);
    } else if (key === 'value' && 'value' in element) {
      (element as HTMLInputElement).value = String(value);
    } else {
      element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: (Child | Child[])[]): void {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [datePart, timePart] = iso.split('T');
  const [year, month, day] = datePart.split('-');
  const date = `${day}.${month}.${year}`;
  return timePart ? `${date} ${timePart.slice(0, 5)}` : date;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

export function dash(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
