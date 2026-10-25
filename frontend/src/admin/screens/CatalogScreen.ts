import { ChipGroup } from '../../design/components';
import { ApiError, api } from '../api/client';
import type { CatalogRecord, Page } from '../api/types';
import { can } from '../auth';
import { invalidateCatalog, labelMap, primaryKey } from '../lookups';
import { DataTable, Pager } from '../ui/DataTable';
import { Form } from '../ui/Form';
import { Modal, confirmDialog } from '../ui/Modal';
import { dash, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import { CATALOG_DEFS, type CatalogColumn, type CatalogDef } from './catalogDefs';
import type { Screen } from './Screen';

const PAGE_SIZE = 50;

/** Экран любого справочника — по описанию из catalogDefs. */
export class CatalogScreen implements Screen {
  readonly title: string;
  readonly element: HTMLElement;
  private readonly table: DataTable<CatalogRecord>;
  private readonly pager: Pager;
  private readonly search = h('input', { type: 'search', placeholder: 'Поиск', class: 'search' });
  private refLabels = new Map<string, Map<number, string>>();
  private searchTimer = 0;
  private readonly editable = can('manage_catalogs');

  constructor(private readonly def: CatalogDef) {
    this.title = def.title;
    this.table = new DataTable<CatalogRecord>(
      def.columns.map((column) => ({ title: column.title, render: (row: CatalogRecord) => this.cell(column, row) })),
      { onRowClick: this.editable ? (row) => this.openForm(row) : undefined },
    );
    this.pager = new Pager(PAGE_SIZE, () => void this.load());
    this.search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.pager.reset();
        void this.load();
      }, 300);
    });

    // В меню один пункт «Справочники» — между самими справочниками переключает ряд таблеток.
    const switcher = new ChipGroup<string>(
      'Справочник',
      CATALOG_DEFS.map((d) => ({ value: d.path, label: d.title })),
      def.path,
      (path) => (location.hash = `#/catalogs/${path}`),
    );

    this.element = h(
      'div',
      null,
      h('div', { class: 'filters' }, switcher.element),
      h('div', { class: 'page-head' },
        h('h1', null, def.title),
        this.editable
          ? h('button', { type: 'button', class: 'arm-btn', onclick: () => this.openForm(null) }, `Добавить ${def.singular}`)
          : null,
      ),
      h('div', { class: 'filters' }, this.search, this.editable ? h('span', { class: 'muted small' }, 'Нажмите на строку, чтобы изменить или удалить') : null),
      this.table.element,
      this.pager.element,
    );
    void this.loadRefs().then(() => this.load());
  }

  private cell(column: CatalogColumn, row: CatalogRecord): string {
    const value = row[column.field];
    if (value === null || value === undefined) return '—';
    if (column.ref) return this.refLabels.get(column.ref)?.get(Number(value)) ?? `#${String(value)}`;
    if (column.format === 'bool') return value ? 'Да' : '—';
    if (column.format === 'months') return `${String(value)} мес.`;
    return dash(value as string | number);
  }

  private async loadRefs(): Promise<void> {
    const refs = [...new Set(this.def.columns.flatMap((column) => (column.ref ? [column.ref] : [])))];
    try {
      const maps = await Promise.all(refs.map((ref) => labelMap(ref)));
      this.refLabels = new Map(refs.map((ref, index) => [ref, maps[index]]));
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  private async load(): Promise<void> {
    this.table.setLoading();
    try {
      const page = await api.get<Page<CatalogRecord>>(`/${this.def.path}`, {
        q: this.search.value.trim(),
        limit: PAGE_SIZE,
        offset: this.pager.currentOffset,
      });
      this.table.setRows(page.items);
      this.pager.update(page.total);
    } catch (error) {
      this.table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }

  private async afterChange(message: string): Promise<void> {
    invalidateCatalog(this.def.path);
    toast(message);
    await this.loadRefs();
    await this.load();
  }

  private openForm(record: CatalogRecord | null): void {
    const pk = primaryKey(this.def.path);
    const id = record ? Number(record[pk]) : null;
    const form = new Form(this.def.fields, record ?? {});

    const save = async (): Promise<boolean> => {
      const values = form.getValues();
      if (!values) return false;
      try {
        if (id === null) await api.post(`/${this.def.path}`, values);
        else await api.put(`/${this.def.path}/${id}`, values);
        await this.afterChange('Сохранено');
        return true;
      } catch (error) {
        if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
        else form.showError('Не удалось сохранить');
        return false;
      }
    };

    const remove = async (): Promise<boolean> => {
      if (id === null) return false;
      const confirmed = await confirmDialog('Удаление записи', 'Удалить запись из справочника? Это действие необратимо.', 'Удалить');
      if (!confirmed) return false;
      try {
        await api.delete(`/${this.def.path}/${id}`);
        await this.afterChange('Запись удалена');
        return true;
      } catch (error) {
        // 409: запись используется — показываем, где именно.
        form.showError(errorMessage(error));
        return false;
      }
    };

    new Modal(
      id === null ? `Новая запись: ${this.def.title.toLowerCase()}` : `${this.def.title}: изменение`,
      form.element,
      [
        ...(id === null ? [] : [{ label: 'Удалить', kind: 'danger' as const, onClick: remove }]),
        { label: 'Отмена', onClick: () => undefined },
        { label: 'Сохранить', kind: 'primary', onClick: save },
      ],
    ).open();
    void form.ready.then(() => form.focusFirst());
  }

  destroy(): void {
    window.clearTimeout(this.searchTimer);
  }
}
