import { Button } from '../../design/components';
import { api } from '../api/client';
import type { EquipmentListItem, EquipmentStatus, Page, Profile } from '../api/types';
import { STATUS_LABELS, STATUS_ORDER, statusBadge } from '../labels';
import { DataTable } from '../ui/DataTable';
import { dash, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { RouteContext, Screen } from './Screen';

type Role = 'holder' | 'mol';

const ROLE_LABELS: Record<Role, string> = { holder: 'Пользователь', mol: 'МОЛ' };
const TAB_TITLES: Record<Role, string> = { holder: 'В эксплуатации', mol: 'Являюсь МОЛ (материально ответственный)' };

// Своего имущества у сотрудника единицы — список берётся целиком и
// фильтруется на месте, без запроса на каждое изменение фильтра.
const LIMIT = 500;
const NO_ROOM = 'none';

function locationKey(item: EquipmentListItem): string {
  return item.room_id === null ? NO_ROOM : String(item.room_id);
}

function locationLabel(item: EquipmentListItem): string {
  if (!item.room_no) return 'Склад';
  return [item.building_address, `каб. ${item.room_no}`].filter(Boolean).join(', ');
}

/** «Моё имущество»: что выдано мне в работу и за что я отвечаю как МОЛ. */
export class MyEquipmentScreen implements Screen {
  readonly title = 'Моё имущество';
  readonly element: HTMLElement;
  private readonly table: DataTable<EquipmentListItem>;
  private readonly tabs = h('div', { class: 'tabs', role: 'tablist' });
  private readonly total = h('span', { class: 'role-total' });
  private readonly search = h('input', { type: 'search', placeholder: 'Название, инв. №, SN, кабинет', class: 'search' });
  private readonly locationSelect = h('select', { 'aria-label': 'Местоположение' });
  private readonly statusSelect = h('select', { 'aria-label': 'Статус' },
    h('option', { value: '' }, 'Все статусы'),
    STATUS_ORDER.map((status) => h('option', { value: status }, STATUS_LABELS[status])),
  );
  private readonly items: Record<Role, EquipmentListItem[]> = { holder: [], mol: [] };
  private isMol = false;
  private role: Role;

  constructor(context: RouteContext) {
    this.role = context.query.get('tab') === 'mol' ? 'mol' : 'holder';
    this.table = new DataTable<EquipmentListItem>(
      [
        {
          title: 'Наименование / Модель',
          render: (row) => h('div', null, h('strong', null, row.model_name), h('div', { class: 'muted small' }, row.manufacturer_name)),
        },
        { title: 'Тип имущества', render: (row) => h('span', { class: 'tag' }, row.type_name) },
        { title: 'Инвентарный номер', render: (row) => h('span', { class: 'inv-no' }, row.inventory_no) },
        { title: 'Серийный номер', render: (row) => h('span', { class: 'mono' }, dash(row.serial_no)) },
        {
          title: 'Местоположение / Кабинет',
          render: (row) => (row.room_no
            ? h('div', null, dash(row.building_address), h('div', { class: 'muted small' }, `Каб. ${row.room_no}, РМ ${dash(row.workplace_no)}`))
            : 'Склад'),
        },
        { title: 'Статус', render: (row) => statusBadge(row.status) },
        { title: 'Роль', render: () => h('span', { class: 'tag tag--accent' }, ROLE_LABELS[this.role]) },
      ],
      { onRowClick: (row) => (location.hash = `#/equipment/${row.equipment_id}`), emptyText: 'Ничего не найдено' },
    );

    this.search.addEventListener('input', () => this.render());
    for (const select of [this.locationSelect, this.statusSelect]) select.addEventListener('change', () => this.render());

    const field = (label: string, control: HTMLElement) =>
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control);
    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, this.title),
          h('p', { class: 'muted' }, 'Просмотр ТМЦ и оборудования, находящихся у вас в пользовании или под материальной ответственностью'),
        ),
        this.total,
      ),
      this.tabs,
      h('div', { class: 'filters filters--panel' },
        field('Поиск', this.search),
        field('Местоположение', this.locationSelect),
        field('Статус', this.statusSelect),
        Button('Найти', { variant: 'accent', onClick: () => this.render() }),
      ),
      this.table.element,
    );
    this.table.setLoading();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const profile = await api.get<Profile>('/profile');
      const employeeId = profile.person.employee_id;
      this.isMol = profile.is_mol;
      const empty: Page<EquipmentListItem> = { items: [], total: 0 };
      const [holder, mol] = await Promise.all([
        api.get<Page<EquipmentListItem>>('/equipment', { holder_id: employeeId, limit: LIMIT }),
        this.isMol ? api.get<Page<EquipmentListItem>>('/equipment', { mol_id: employeeId, limit: LIMIT }) : Promise.resolve(empty),
      ]);
      this.items.holder = holder.items;
      this.items.mol = mol.items;
      // Вкладка МОЛ — только у материально ответственных лиц, даже если её открыли по ссылке.
      if (!this.isMol) this.role = 'holder';
      this.switchTo(this.role);
    } catch (error) {
      this.table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }

  private switchTo(role: Role): void {
    this.role = role;
    const roles: Role[] = this.isMol ? ['holder', 'mol'] : ['holder'];
    this.tabs.replaceChildren(
      ...roles.map((tabRole) => {
        const tab = h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': String(tabRole === role) },
          TAB_TITLES[tabRole],
          h('span', { class: 'tab-count' }, this.items[tabRole].length),
        );
        tab.addEventListener('click', () => {
          if (tabRole === this.role) return;
          // Вкладка — в адресе, чтобы «назад» из карточки вернул на неё.
          history.replaceState(null, '', tabRole === 'mol' ? '#/my-equipment?tab=mol' : '#/my-equipment');
          this.switchTo(tabRole);
        });
        return tab;
      }),
    );
    this.fillLocations();
    this.total.textContent = `Всего по роли: ${this.items[role].length}`;
    this.render();
  }

  private fillLocations(): void {
    const selected = this.locationSelect.value;
    const options = new Map(this.items[this.role].map((item) => [locationKey(item), locationLabel(item)]));
    this.locationSelect.replaceChildren(
      h('option', { value: '' }, 'Все местоположения'),
      ...[...options]
        .sort((a, b) => a[1].localeCompare(b[1], 'ru'))
        .map(([value, label]) => h('option', { value }, label)),
    );
    this.locationSelect.value = options.has(selected) ? selected : '';
  }

  private render(): void {
    const q = this.search.value.trim().toLowerCase();
    const place = this.locationSelect.value;
    const status = this.statusSelect.value as EquipmentStatus | '';
    this.table.setRows(this.items[this.role].filter((item) =>
      (!status || item.status === status)
      && (!place || locationKey(item) === place)
      && (!q || [item.model_name, item.manufacturer_name, item.type_name, item.inventory_no, item.serial_no, item.room_no]
        .some((value) => value?.toLowerCase().includes(q))),
    ));
  }
}
