import { api } from '../api/client';
import type { Page, TicketListItem } from '../api/types';
import { can } from '../auth';
import { TICKET_STATUS_LABELS, TICKET_STATUS_ORDER, TICKET_TYPE_LABELS, priorityMark, ticketBadge } from '../labels';
import { DataTable, Pager } from '../ui/DataTable';
import { dash, formatDate, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { RouteContext, Screen } from './Screen';

const PAGE_SIZE = 50;

export class TicketListScreen implements Screen {
  readonly title = 'Заявки';
  readonly element: HTMLElement;
  private readonly table: DataTable<TicketListItem>;
  private readonly pager: Pager;
  private readonly statusSelect = h('select', { 'aria-label': 'Статус' });
  private readonly typeSelect = h('select', { 'aria-label': 'Тип заявки' });
  private readonly mine = h('input', { type: 'checkbox' });
  private requestNo = 0;

  constructor(context: RouteContext) {
    this.table = new DataTable<TicketListItem>(
      [
        { title: '№', render: (t) => h('strong', null, String(t.ticket_id)) },
        { title: 'Создана', render: (t) => formatDate(t.created_at) },
        { title: 'Тип', render: (t) => TICKET_TYPE_LABELS[t.ticket_type] },
        { title: 'Описание', render: (t) => h('div', { class: 'clip', title: t.description }, t.description) },
        { title: 'Оборудование', render: (t) => dash(t.inventory_no) },
        { title: 'Приоритет', render: (t) => priorityMark(t.priority) },
        { title: 'Статус', render: (t) => ticketBadge(t.status) },
        { title: 'Заявитель', render: (t) => t.requester_name },
        { title: 'Исполнитель', render: (t) => dash(t.assignee_name) },
      ],
      { onRowClick: (t) => (location.hash = `#/tickets/${t.ticket_id}`), emptyText: 'Заявок нет' },
    );
    this.pager = new Pager(PAGE_SIZE, () => void this.load());

    this.statusSelect.append(h('option', { value: '' }, 'Все статусы'),
      ...TICKET_STATUS_ORDER.map((status) => h('option', { value: status }, TICKET_STATUS_LABELS[status])));
    this.statusSelect.value = context.query.get('status') ?? '';
    this.typeSelect.append(h('option', { value: '' }, 'Все типы'),
      ...Object.entries(TICKET_TYPE_LABELS).map(([value, label]) => h('option', { value }, label)));
    this.mine.checked = context.query.has('mine');
    for (const control of [this.statusSelect, this.typeSelect, this.mine]) {
      control.addEventListener('change', () => {
        this.pager.reset();
        void this.load();
      });
    }

    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' },
        h('h1', null, this.title),
        can('create_tickets') ? h('a', { class: 'btn btn--primary', href: '#/tickets/new' }, '+ Новая заявка') : null,
      ),
      h('div', { class: 'filters' },
        this.statusSelect, this.typeSelect,
        can('process_tickets') ? h('label', { class: 'check' }, this.mine, ' назначенные мне') : null,
      ),
      this.table.element,
      this.pager.element,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    const requestNo = ++this.requestNo;
    this.table.setLoading();
    try {
      const page = await api.get<Page<TicketListItem>>('/tickets', {
        status: this.statusSelect.value,
        ticket_type: this.typeSelect.value,
        assigned_to_me: this.mine.checked ? true : null,
        limit: PAGE_SIZE,
        offset: this.pager.currentOffset,
      });
      if (requestNo !== this.requestNo) return;
      this.table.setRows(page.items);
      this.pager.update(page.total);
    } catch (error) {
      if (requestNo !== this.requestNo) return;
      this.table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }
}
