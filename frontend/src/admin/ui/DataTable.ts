import { h, type Child } from './dom';

export interface Column<T> {
  title: string;
  render: (row: T) => Child;
  className?: string;
}

/** Таблица записей. Строка кликабельна, если передан onRowClick. */
export class DataTable<T> {
  readonly element: HTMLElement;
  private readonly body: HTMLTableSectionElement;

  constructor(
    private readonly columns: Column<T>[],
    private readonly options: { onRowClick?: (row: T) => void; emptyText?: string } = {},
  ) {
    this.body = h('tbody');
    this.element = h(
      'div',
      { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null, h('tr', null, columns.map((column) => h('th', { class: column.className }, column.title)))),
        this.body,
      ),
    );
  }

  setLoading(): void {
    this.body.replaceChildren(
      h('tr', null, h('td', { colspan: this.columns.length, class: 'table-empty' }, 'Загрузка…')),
    );
  }

  setRows(rows: T[]): void {
    if (rows.length === 0) {
      this.body.replaceChildren(
        h('tr', null, h('td', { colspan: this.columns.length, class: 'table-empty' }, this.options.emptyText ?? 'Нет записей')),
      );
      return;
    }
    const onRowClick = this.options.onRowClick;
    this.body.replaceChildren(
      ...rows.map((row) => {
        const tr = h('tr', { class: onRowClick ? 'clickable' : null },
          this.columns.map((column) => h('td', { class: column.className }, column.render(row))),
        );
        if (onRowClick) {
          tr.tabIndex = 0;
          tr.addEventListener('click', () => onRowClick(row));
          tr.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') onRowClick(row);
          });
        }
        return tr;
      }),
    );
  }
}

/** Переключатель страниц: «1–50 из 120  ‹ ›». */
export class Pager {
  readonly element: HTMLElement;
  private offset = 0;
  private total = 0;

  constructor(
    private readonly limit: number,
    private readonly onChange: (offset: number) => void,
  ) {
    this.element = h('div', { class: 'pager' });
  }

  get currentOffset(): number {
    return this.offset;
  }

  reset(): void {
    this.offset = 0;
  }

  update(total: number): void {
    this.total = total;
    const from = total === 0 ? 0 : this.offset + 1;
    const to = Math.min(this.offset + this.limit, total);
    this.element.replaceChildren(
      h('span', null, `${from}–${to} из ${total}`),
      h('button', {
        type: 'button', class: 'btn btn--plain btn--small', disabled: this.offset === 0,
        'aria-label': 'Предыдущая страница', onclick: () => this.go(this.offset - this.limit),
      }, '‹'),
      h('button', {
        type: 'button', class: 'btn btn--plain btn--small', disabled: to >= total,
        'aria-label': 'Следующая страница', onclick: () => this.go(this.offset + this.limit),
      }, '›'),
    );
  }

  private go(offset: number): void {
    this.offset = Math.max(0, Math.min(offset, Math.max(0, this.total - 1)));
    this.onChange(this.offset);
  }
}
