import { SpecRow, SpecTile } from '../../design/components';
import { api } from '../api/client';
import type { AssignmentRecord, EquipmentCard } from '../api/types';
import { can, currentUser } from '../auth';
import { OPERATION_LABELS, statusBadge } from '../labels';
import { DataTable } from '../ui/DataTable';
import { dash, formatDate, formatMoney, h, type Child } from '../ui/dom';
import { printLabels } from '../ui/label';
import { errorMessage, toast } from '../ui/toast';
import { openAssignmentForm } from './assignmentForm';
import { openEquipmentForm } from './equipmentForm';
import type { RouteContext, Screen } from './Screen';

const SCAN_MODE_LABELS: Record<string, string> = {
  flatbed: 'со стекла',
  feeder: 'потоковая',
  duplex_feeder: 'потоковая двусторонняя',
};

function facts(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'facts' }, rows.flatMap(([term, value]) => [h('dt', null, term), h('dd', null, value)]));
}

export class EquipmentCardScreen implements Screen {
  title = 'Карточка оборудования';
  readonly element: HTMLElement;
  private readonly content = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));

  constructor(context: RouteContext) {
    // Сотруднику реестр не показывается — назад он возвращается к своему имуществу.
    const back = currentUser().scope === 'own'
      ? h('a', { href: '#/my-equipment', class: 'back' }, '← Моё имущество')
      : h('a', { href: '#/equipment', class: 'back' }, '← Реестр оборудования');
    this.element = h('div', null, back, this.content);
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

    // Ряд плиток — только заполненные характеристики: у монитора их нет вовсе.
    const specs = [
      card.cpu ? SpecTile(card.cpu, 'Процессор') : null,
      card.ram_gb !== null ? SpecTile(`${card.ram_gb} ГБ`, 'ОЗУ') : null,
      card.storage_gb !== null ? SpecTile(`${card.storage_gb} ГБ`, 'Накопитель') : null,
      card.diagonal_inch !== null ? SpecTile(`${card.diagonal_inch}″`, 'Диагональ') : null,
      card.resolution ? SpecTile(card.resolution, 'Разрешение') : null,
      card.connection_type ? SpecTile(card.connection_type, 'Подключение') : null,
      card.is_color !== null ? SpecTile(card.is_color ? 'Цветная' : 'Чёрно-белая', 'Печать') : null,
      card.cartridge_type ? SpecTile(card.cartridge_type, 'Картриджи') : null,
      card.drum_type ? SpecTile(card.drum_type, 'Барабаны') : null,
      card.scan_modes
        ? SpecTile(card.scan_modes.split(',').map((m) => SCAN_MODE_LABELS[m] ?? m).join(', '), 'Сканирование')
        : null,
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
          h('button', {
            type: 'button', class: 'arm-btn arm-btn-light',
            onclick: () => printLabels([card]).catch((error) => toast(errorMessage(error))),
          }, 'Печать этикетки'),
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
    );
  }
}
