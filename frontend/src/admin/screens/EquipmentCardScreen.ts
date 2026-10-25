import { SpecRow, SpecTile } from '../../design/components';
import { api } from '../api/client';
import type { AssignmentRecord, EquipmentCard, Page, TicketListItem } from '../api/types';
import { can } from '../auth';
import { OPERATION_LABELS, TICKET_TYPE_LABELS, statusBadge, ticketBadge } from '../labels';
import { DataTable } from '../ui/DataTable';
import { dash, formatDate, formatMoney, h, type Child } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import { openAssignmentForm } from './assignmentForm';
import { openEquipmentForm } from './equipmentForm';
import type { RouteContext, Screen } from './Screen';

function facts(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'facts' }, rows.flatMap(([term, value]) => [h('dt', null, term), h('dd', null, value)]));
}

export class EquipmentCardScreen implements Screen {
  title = 'Карточка оборудования';
  readonly element: HTMLElement;
  private readonly content = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));

  constructor(context: RouteContext) {
    this.element = h('div', null, h('a', { href: '#/equipment', class: 'back' }, '← Реестр оборудования'), this.content);
    void this.load(Number(context.params[0]));
  }

  private async load(id: number): Promise<void> {
    try {
      this.render(await api.get<EquipmentCard>(`/equipment/${id}`));
    } catch (error) {
      this.content.replaceChildren(h('p', { class: 'form-error' }, errorMessage(error)));
    }
  }

  private render(card: EquipmentCard): void {
    this.title = card.inventory_no;
    document.title = `${card.inventory_no} — АРМ Монитор`;
    const editable = can('manage_equipment') && card.status !== 'written_off';
    const onAssigned = (message: string) => (saved: EquipmentCard) => {
      toast(message);
      this.render(saved);
    };
    const action = (label: string, operation: 'assign' | 'move' | 'return', message: string, primary = false) =>
      h('button', {
        type: 'button', class: `arm-btn${primary ? '' : ' arm-btn-light'}`,
        onclick: () => openAssignmentForm(card, operation, onAssigned(message)),
      }, label);
    const operations = can('assign_equipment')
      ? card.status === 'in_stock'
        ? [action('Назначить на рабочее место', 'assign', 'Оборудование назначено', true)]
        : card.status === 'in_use'
          ? [action('Переместить', 'move', 'Перемещение оформлено', true), action('Вернуть на склад', 'return', 'Оборудование возвращено на склад')]
          : []
      : [];

    const history = new DataTable<AssignmentRecord>(
      [
        { title: 'Дата', render: (a) => formatDate(a.assigned_at) },
        { title: 'Операция', render: (a) => OPERATION_LABELS[a.operation] },
        { title: 'Сотрудник', render: (a) => dash(a.employee_name) },
        { title: 'Рабочее место', render: (a) => dash(a.workplace_no) },
        { title: 'Основание', render: (a) => dash(a.basis) },
        { title: 'Оформил', render: (a) => a.user_login },
      ],
      { emptyText: 'Назначений и перемещений ещё не было' },
    );
    history.setRows(card.assignments);

    const tickets = new DataTable<TicketListItem>(
      [
        { title: '№', render: (t) => String(t.ticket_id) },
        { title: 'Создана', render: (t) => formatDate(t.created_at) },
        { title: 'Тип', render: (t) => TICKET_TYPE_LABELS[t.ticket_type] },
        { title: 'Описание', render: (t) => h('div', { class: 'clip' }, t.description) },
        { title: 'Статус', render: (t) => ticketBadge(t.status) },
      ],
      { onRowClick: (t) => (location.hash = `#/tickets/${t.ticket_id}`), emptyText: 'Заявок не было' },
    );

    // Ряд плиток — только заполненные характеристики: у монитора их нет вовсе.
    const specs = [
      card.cpu ? SpecTile(card.cpu, 'Процессор') : null,
      card.ram_gb !== null ? SpecTile(`${card.ram_gb} ГБ`, 'ОЗУ') : null,
      card.storage_gb !== null ? SpecTile(`${card.storage_gb} ГБ`, 'Накопитель') : null,
      card.os_name ? SpecTile(card.os_name, 'ОС') : null,
      card.hostname ? SpecTile(card.hostname, 'Сетевое имя', card.ip_address ?? undefined) : null,
    ].filter((tile): tile is HTMLDivElement => tile !== null);

    this.content.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, card.inventory_no, ' ', statusBadge(card.status)),
          h('p', { class: 'muted' }, `${card.type_name}: ${card.manufacturer_name} ${card.model_name}`),
        ),
        h('div', { class: 'actions' },
          operations,
          can('create_tickets') && card.status !== 'written_off'
            ? h('a', { class: 'arm-btn arm-btn-light', href: `#/tickets/new?equipment=${card.equipment_id}` }, 'Подать заявку')
            : null,
          editable
            ? h('button', {
                type: 'button', class: 'arm-btn arm-btn-light',
                onclick: () => openEquipmentForm(card, (saved) => {
                  toast('Карточка сохранена');
                  this.render(saved);
                }),
              }, 'Изменить карточку')
            : null,
        ),
      ),
      ...(specs.length ? [SpecRow(specs)] : []),
      h('div', { class: 'cards' },
        h('section', { class: 'card' }, h('h2', null, 'Учётные сведения'), facts([
          ['Инвентарный номер', card.inventory_no],
          ['Серийный номер', dash(card.serial_no)],
          ['МОЛ', dash(card.mol_name)],
          ['Ввод в эксплуатацию', formatDate(card.commissioned_on)],
          ['Срок службы до', formatDate(card.service_end)],
          ['Балансовая стоимость', formatMoney(card.book_value)],
        ])),
        h('section', { class: 'card' }, h('h2', null, 'Размещение'), facts([
          ['Подразделение', dash(card.dept_name)],
          ['Помещение', card.room_no ? `каб. ${card.room_no}` : '—'],
          ['Рабочее место', dash(card.workplace_no)],
          ['Выдано', dash(card.holder_name)],
          ['IP-адрес', dash(card.ip_address)],
        ])),
      ),
      h('section', { class: 'card' }, h('h2', null, 'История назначений и перемещений'), history.element),
      h('section', { class: 'card' }, h('h2', null, 'Заявки по оборудованию'), tickets.element),
    );
    void this.loadTickets(card.equipment_id, tickets);
  }

  private async loadTickets(equipmentId: number, table: DataTable<TicketListItem>): Promise<void> {
    table.setLoading();
    try {
      const page = await api.get<Page<TicketListItem>>('/tickets', { equipment_id: equipmentId, limit: 100 });
      table.setRows(page.items);
    } catch {
      table.setRows([]);
    }
  }
}
