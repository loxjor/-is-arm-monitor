import { api } from '../api/client';
import type { EquipmentStatus, TicketStatus } from '../api/types';
import { can, currentUser } from '../auth';
import { STATUS_LABELS, STATUS_ORDER, TICKET_STATUS_LABELS } from '../labels';
import { h } from '../ui/dom';
import { errorMessage } from '../ui/toast';
import type { Screen } from './Screen';

export class DashboardScreen implements Screen {
  readonly title = 'Главная';
  readonly element: HTMLElement;

  constructor() {
    const user = currentUser();
    const tiles = h('div', { class: 'tiles' }, h('p', { class: 'muted' }, 'Загрузка…'));
    const ticketTiles = h('div', { class: 'tiles' });
    const scopeNote = {
      all: 'Показан весь парк оборудования.',
      department: 'Показано оборудование вашего подразделения.',
      own: 'Показано оборудование, закреплённое за вами.',
    }[user.scope];

    this.element = h(
      'div',
      null,
      h('h1', null, `Здравствуйте, ${user.employee.full_name.split(' ').slice(1, 3).join(' ') || user.login}`),
      h('p', { class: 'muted' }, `${user.role.name}. ${scopeNote}`),
      tiles,
      h('h2', null, 'Заявки'),
      ticketTiles,
      h('div', { class: 'quick-links' },
        h('a', { class: 'btn btn--plain', href: '#/equipment' }, 'Реестр оборудования'),
        h('a', { class: 'btn btn--plain', href: '#/equipment?expiring=12' }, 'Истекает срок службы (12 мес.)'),
        can('manage_equipment') ? h('a', { class: 'btn btn--primary', href: '#/equipment?new=1' }, 'Поставить на учёт') : null,
      ),
    );

    void this.load(tiles);
    void this.loadTickets(ticketTiles);
  }

  private async loadTickets(tiles: HTMLElement): Promise<void> {
    try {
      const counts = await api.get<Partial<Record<TicketStatus, number>>>('/tickets/summary');
      const open: TicketStatus[] = ['new', 'in_progress', 'done'];
      tiles.replaceChildren(
        ...open.map((status) =>
          h('a', { class: `tile tile--ticket-${status}`, href: `#/tickets?status=${status}` },
            h('span', { class: 'tile-value' }, String(counts[status] ?? 0)),
            h('span', { class: 'tile-label' }, status === 'done' ? 'Ждут подтверждения' : TICKET_STATUS_LABELS[status]),
          ),
        ),
      );
    } catch (error) {
      tiles.replaceChildren(h('p', { class: 'form-error' }, errorMessage(error)));
    }
  }

  private async load(tiles: HTMLElement): Promise<void> {
    try {
      const counts = await api.get<Partial<Record<EquipmentStatus, number>>>('/equipment/summary');
      const total = Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
      tiles.replaceChildren(
        h('a', { class: 'tile tile--total', href: '#/equipment' },
          h('span', { class: 'tile-value' }, String(total)), h('span', { class: 'tile-label' }, 'Всего единиц')),
        ...STATUS_ORDER.map((status) =>
          h('a', { class: `tile tile--${status}`, href: `#/equipment?status=${status}` },
            h('span', { class: 'tile-value' }, String(counts[status] ?? 0)),
            h('span', { class: 'tile-label' }, STATUS_LABELS[status]),
          ),
        ),
      );
    } catch (error) {
      tiles.replaceChildren(h('p', { class: 'form-error' }, errorMessage(error)));
    }
  }
}
