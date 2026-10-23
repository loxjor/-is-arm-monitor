import { api } from '../api/client';
import type { EquipmentListItem, PersonBrief, Profile } from '../api/types';
import { can } from '../auth';
import { statusBadge } from '../labels';
import { dash, h, type Child } from '../ui/dom';
import { errorMessage } from '../ui/toast';
import type { Screen } from './Screen';

function facts(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'facts' }, rows.flatMap(([term, value]) => [h('dt', null, term), h('dd', null, value)]));
}

function contacts(person: PersonBrief): Child[] {
  return [
    person.phone ? h('div', { class: 'muted small' }, `тел. ${person.phone}`) : null,
    person.email ? h('div', { class: 'small' }, h('a', { href: `mailto:${person.email}` }, person.email)) : null,
  ];
}

function initials(fullName: string): string {
  const [last, first] = fullName.split(' ');
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`;
}

function equipmentTile(item: EquipmentListItem): HTMLElement {
  return h('a', { class: 'equipment-tile', href: `#/equipment/${item.equipment_id}` },
    h('strong', null, item.type_name),
    h('span', null, `${item.manufacturer_name} ${item.model_name}`),
    h('span', { class: 'muted small' }, `Инв. № ${item.inventory_no}${item.hostname ? ` · ${item.hostname}` : ''}`),
    h('span', null, statusBadge(item.status)),
  );
}

/** «Мой профиль»: кто я, где работаю, какая техника на моём АРМ. */
export class ProfileScreen implements Screen {
  readonly title = 'Мой профиль';
  readonly element: HTMLElement;

  constructor() {
    this.element = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.render(await api.get<Profile>('/profile'));
    } catch (error) {
      this.element.replaceChildren(h('p', { class: 'form-error' }, errorMessage(error)));
    }
  }

  private render(profile: Profile): void {
    const { person, department, head } = profile;
    const territory = profile.territories.length
      ? profile.territories.map((t) => h('div', { class: 'territory' },
          h('div', null, h('strong', null, `Кабинет ${t.room_no}`), `, ${t.floor} этаж · рабочее место ${t.workplace_no}`),
          h('div', { class: 'muted small' }, `${t.building_name}, ${t.building_address}`),
        ))
      : [h('span', { class: 'muted' }, 'Рабочее место не назначено')];

    this.element.replaceChildren(
      h('div', { class: 'profile-head' },
        h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials(person.full_name)),
        h('div', null,
          h('h1', null, person.full_name),
          h('p', { class: 'muted' }, `${person.position} · ${department.name}`),
        ),
      ),
      h('div', { class: 'cards' },
        h('section', { class: 'card' }, h('h2', null, 'Сотрудник'), facts([
          ['ФИО', person.full_name],
          ['Должность', person.position],
          ['Телефон', dash(person.phone)],
          ['E-mail', dash(person.email)],
          ['МОЛ', profile.is_mol ? 'Да' : 'Нет'],
          ['Учётная запись', `${profile.login} (${profile.role_name})`],
        ])),
        h('section', { class: 'card' }, h('h2', null, 'Подразделение'), facts([
          ['Отдел', department.name],
          ['Входит в', dash(department.parent_name)],
          ['Телефон отдела', dash(department.phone)],
          ['Руководитель', head ? h('div', null, h('div', null, head.full_name), h('div', { class: 'muted small' }, head.position), contacts(head)) : '—'],
        ])),
        h('section', { class: 'card' }, h('h2', null, 'Территория'), h('div', null, territory)),
      ),
      h('section', { class: 'card' },
        h('div', { class: 'section-head' },
          h('h2', null, `Техника на моём АРМ (${profile.equipment.length})`),
          h('div', { class: 'actions' },
            h('a', { class: 'btn btn--plain btn--small', href: '#/tickets' },
              profile.open_tickets ? `Мои заявки · открыто ${profile.open_tickets}` : 'Мои заявки'),
            can('create_tickets') ? h('a', { class: 'btn btn--primary btn--small', href: '#/tickets/new' }, 'Создать заявку') : null,
          ),
        ),
        profile.equipment.length
          ? h('div', { class: 'equipment-cards' }, profile.equipment.map(equipmentTile))
          : h('p', { class: 'muted' }, 'За вами пока не закреплено оборудование.'),
      ),
    );
  }
}
