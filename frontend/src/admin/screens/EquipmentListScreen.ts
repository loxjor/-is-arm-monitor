import { api } from '../api/client';
import type { EquipmentListItem, EquipmentStatus, Page } from '../api/types';
import { can } from '../auth';
import { STATUS_LABELS, STATUS_ORDER, statusBadge } from '../labels';
import { catalogOptions, type Option } from '../lookups';
import { DataTable, Pager } from '../ui/DataTable';
import { dash, formatDate, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import { openEquipmentForm } from './equipmentForm';
import type { RouteContext, Screen } from './Screen';

const PAGE_SIZE = 50;

function isExpired(isoDate: string | null): boolean {
  return isoDate !== null && isoDate <= new Date().toISOString().slice(0, 10);
}

export class EquipmentListScreen implements Screen {
  readonly title = 'Реестр оборудования';
  readonly element: HTMLElement;
  private readonly table: DataTable<EquipmentListItem>;
  private readonly pager: Pager;
  private readonly search = h('input', { type: 'search', placeholder: 'Инв. номер, серийный, сетевое имя, IP', class: 'search' });
  private readonly statusSelect = h('select', { 'aria-label': 'Статус' });
  private readonly typeSelect = h('select', { 'aria-label': 'Тип оборудования' });
  private readonly roomSelect = h('select', { 'aria-label': 'Помещение' });
  private readonly expiring = h('input', { type: 'checkbox' });
  private searchTimer = 0;
  private requestNo = 0;

  constructor(context: RouteContext) {
    this.table = new DataTable<EquipmentListItem>(
      [
        { title: 'Инв. номер', render: (row) => h('strong', null, row.inventory_no) },
        { title: 'Тип и модель', render: (row) => h('div', null, row.type_name, h('div', { class: 'muted small' }, `${row.manufacturer_name} ${row.model_name}`)) },
        { title: 'Статус', render: (row) => statusBadge(row.status) },
        {
          title: 'Размещение',
          render: (row) => (row.room_no
            ? h('div', null, `каб. ${row.room_no}, РМ ${dash(row.workplace_no)}`,
                row.holder_name ? h('div', { class: 'muted small' }, row.holder_name) : null)
            : '—'),
        },
        { title: 'МОЛ', render: (row) => dash(row.mol_name) },
        { title: 'ОС', render: (row) => dash(row.os_name) },
        {
          title: 'Срок службы до',
          render: (row) => h('span', { class: isExpired(row.service_end) ? 'text-danger' : null }, formatDate(row.service_end)),
        },
      ],
      { onRowClick: (row) => (location.hash = `#/equipment/${row.equipment_id}`), emptyText: 'Ничего не найдено' },
    );
    this.pager = new Pager(PAGE_SIZE, () => void this.load());

    this.statusSelect.append(h('option', { value: '' }, 'Все статусы'),
      ...STATUS_ORDER.map((status) => h('option', { value: status }, STATUS_LABELS[status])));
    this.statusSelect.value = context.query.get('status') ?? '';
    this.expiring.checked = context.query.has('expiring');

    for (const control of [this.statusSelect, this.typeSelect, this.roomSelect, this.expiring]) {
      control.addEventListener('change', () => this.reload());
    }
    this.search.addEventListener('input', () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.reload(), 300);
    });

    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' },
        h('h1', null, this.title),
        can('manage_equipment')
          ? h('button', { type: 'button', class: 'btn btn--primary', onclick: () => this.openNew() }, '+ Поставить на учёт')
          : null,
      ),
      h('div', { class: 'filters' },
        this.search, this.statusSelect, this.typeSelect, this.roomSelect,
        h('label', { class: 'check' }, this.expiring, ' срок службы истекает в течение 12 мес.'),
      ),
      this.table.element,
      this.pager.element,
    );

    void this.fillSelect(this.typeSelect, 'Все типы', catalogOptions('equipment-types'));
    void this.fillSelect(this.roomSelect, 'Все помещения', catalogOptions('rooms'));
    void this.load();
    if (context.query.has('new') && can('manage_equipment')) this.openNew();
  }

  private async fillSelect(select: HTMLSelectElement, emptyLabel: string, options: Promise<Option[]>): Promise<void> {
    select.append(h('option', { value: '' }, emptyLabel));
    try {
      select.append(...(await options).map((option) => h('option', { value: option.value }, option.label)));
    } catch {
      // фильтр просто останется без вариантов
    }
  }

  private openNew(): void {
    openEquipmentForm(null, (saved) => {
      toast(`${saved.inventory_no} поставлен на учёт`);
      location.hash = `#/equipment/${saved.equipment_id}`;
    });
  }

  private reload(): void {
    this.pager.reset();
    void this.load();
  }

  private async load(): Promise<void> {
    const requestNo = ++this.requestNo;
    this.table.setLoading();
    try {
      const page = await api.get<Page<EquipmentListItem>>('/equipment', {
        q: this.search.value.trim(),
        status: this.statusSelect.value as EquipmentStatus | '',
        type_id: this.typeSelect.value,
        room_id: this.roomSelect.value,
        expiring_within_months: this.expiring.checked ? 12 : null,
        limit: PAGE_SIZE,
        offset: this.pager.currentOffset,
      });
      // Ответ на устаревший запрос (фильтр уже сменили) не должен затирать новый.
      if (requestNo !== this.requestNo) return;
      this.table.setRows(page.items);
      this.pager.update(page.total);
    } catch (error) {
      if (requestNo !== this.requestNo) return;
      this.table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }

  destroy(): void {
    window.clearTimeout(this.searchTimer);
  }
}
