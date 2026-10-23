import { api } from '../api/client';
import type { AssignmentRecord, EquipmentCard } from '../api/types';
import { can } from '../auth';
import { OPERATION_LABELS, statusBadge } from '../labels';
import { DataTable } from '../ui/DataTable';
import { dash, formatDate, formatMoney, h, type Child } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
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
    document.title = `${card.inventory_no} — АРМ-Монитор`;
    const editable = can('manage_equipment') && card.status !== 'written_off';

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

    this.content.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, card.inventory_no, ' ', statusBadge(card.status)),
          h('p', { class: 'muted' }, `${card.type_name}: ${card.manufacturer_name} ${card.model_name}`),
        ),
        editable
          ? h('button', {
              type: 'button', class: 'btn btn--primary',
              onclick: () => openEquipmentForm(card, (saved) => {
                toast('Карточка сохранена');
                this.render(saved);
              }),
            }, 'Изменить')
          : null,
      ),
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
          ['Сетевое имя', dash(card.hostname)],
          ['IP-адрес', dash(card.ip_address)],
        ])),
        h('section', { class: 'card' }, h('h2', null, 'Характеристики'), facts([
          ['Процессор', dash(card.cpu)],
          ['ОЗУ', card.ram_gb === null ? '—' : `${card.ram_gb} ГБ`],
          ['Накопитель', card.storage_gb === null ? '—' : `${card.storage_gb} ГБ`],
          ['Операционная система', dash(card.os_name)],
        ])),
      ),
      h('section', { class: 'card' }, h('h2', null, 'История назначений и перемещений'), history.element),
    );
  }
}
