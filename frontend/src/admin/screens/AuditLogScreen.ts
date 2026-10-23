import { api } from '../api/client';
import type { AuditLogEntry, Page, User } from '../api/types';
import { AUDIT_ACTION_LABELS, ENTITY_LABELS } from '../labels';
import { DataTable, Pager } from '../ui/DataTable';
import { dash, formatDate, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { Screen } from './Screen';

const PAGE_SIZE = 50;

function describe(details: string | null): string {
  if (!details) return '';
  try {
    const parsed = JSON.parse(details) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => {
        if (value && typeof value === 'object' && 'from' in value && 'to' in value) {
          const change = value as { from: unknown; to: unknown };
          return `${key}: ${String(change.from)} → ${String(change.to)}`;
        }
        return `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`;
      })
      .join('; ');
  } catch {
    return details;
  }
}

export class AuditLogScreen implements Screen {
  readonly title = 'Журнал действий';
  readonly element: HTMLElement;
  private readonly table: DataTable<AuditLogEntry>;
  private readonly pager: Pager;
  private readonly actionSelect = h('select', { 'aria-label': 'Действие' });
  private readonly dateFrom = h('input', { type: 'date', 'aria-label': 'С даты' });
  private readonly dateTo = h('input', { type: 'date', 'aria-label': 'По дату' });
  private logins = new Map<number, string>();

  constructor() {
    this.table = new DataTable<AuditLogEntry>([
      { title: 'Время', render: (e) => formatDate(e.occurred_at) },
      { title: 'Пользователь', render: (e) => (e.user_id === null ? '—' : this.logins.get(e.user_id) ?? `#${e.user_id}`) },
      { title: 'Действие', render: (e) => AUDIT_ACTION_LABELS[e.action] ?? e.action },
      { title: 'Объект', render: (e) => (e.entity ? `${ENTITY_LABELS[e.entity] ?? e.entity}${e.entity_id ? ` #${e.entity_id}` : ''}` : '—') },
      { title: 'Подробности', className: 'details', render: (e) => dash(describe(e.details)) },
    ]);
    this.pager = new Pager(PAGE_SIZE, () => void this.load());

    this.actionSelect.append(h('option', { value: '' }, 'Все действия'),
      ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => h('option', { value }, label)));
    for (const control of [this.actionSelect, this.dateFrom, this.dateTo]) {
      control.addEventListener('change', () => {
        this.pager.reset();
        void this.load();
      });
    }

    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' }, h('h1', null, this.title)),
      h('div', { class: 'filters' }, this.actionSelect, h('span', null, 'с'), this.dateFrom, h('span', null, 'по'), this.dateTo),
      this.table.element,
      this.pager.element,
    );
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const users = await api.get<User[]>('/users');
      this.logins = new Map(users.map((u) => [u.user_id, u.login]));
    } catch {
      // без логинов покажем коды пользователей
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.table.setLoading();
    try {
      const page = await api.get<Page<AuditLogEntry>>('/audit-log', {
        action: this.actionSelect.value,
        date_from: this.dateFrom.value,
        date_to: this.dateTo.value,
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
}
