import { SpecRow, SpecTile } from '../../design/components';
import { ApiError, api } from '../api/client';
import type { EquipmentListItem, Page, TicketCard, TicketPriority, TicketType } from '../api/types';
import { statusBadge } from '../labels';
import { h } from '../ui/dom';
import { toast } from '../ui/toast';
import type { RouteContext, Screen } from './Screen';

const TYPES: { value: TicketType; label: string; hint: string }[] = [
  { value: 'repair', label: 'Ремонт', hint: 'Что-то сломалось или не включается' },
  { value: 'service', label: 'Обслуживание', hint: 'Картридж, программы, настройка' },
  { value: 'install', label: 'Установка', hint: 'Нужна новая техника или рабочее место' },
  { value: 'move', label: 'Перемещение', hint: 'Перенести технику или рабочее место' },
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Не срочно' },
  { value: 'normal', label: 'Обычно' },
  { value: 'high', label: 'Срочно — не могу работать' },
];

const NEEDS_EQUIPMENT: TicketType[] = ['repair', 'service'];

/** Отдельная страница заявки системному администратору (BPMN 2.7, сторона сотрудника). */
export class NewTicketScreen implements Screen {
  readonly title = 'Новая заявка';
  readonly element: HTMLElement;
  private type: TicketType = 'repair';
  private priority: TicketPriority = 'normal';
  private equipmentId: number | null;
  private readonly typeRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Что нужно сделать' });
  private readonly priorityRow = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Срочность' });
  private readonly equipmentGrid = h('div', { class: 'equipment-cards' }, h('p', { class: 'muted' }, 'Загрузка…'));
  private readonly equipmentHint = h('p', { class: 'muted small' });
  private readonly description = h('textarea', { 'aria-label': 'Описание', maxlength: 4000,
    placeholder: 'Опишите, что случилось: когда началось, что на экране, что уже пробовали' });
  private readonly error = h('div', { class: 'form-error', role: 'alert' });
  private readonly submit = h('button', { type: 'button', class: 'arm-btn' }, 'Отправить заявку');
  private equipment: EquipmentListItem[] = [];

  constructor(context: RouteContext) {
    const preset = Number(context.query.get('equipment'));
    this.equipmentId = Number.isInteger(preset) && preset > 0 ? preset : null;
    this.submit.addEventListener('click', () => void this.send());

    this.element = h(
      'div',
      { class: 'new-ticket' },
      h('a', { href: '#/tickets', class: 'back' }, '← Мои заявки'),
      h('h1', null, this.title),
      h('p', { class: 'muted' }, 'Заявка уйдёт системным администраторам. Статус можно отслеживать в разделе «Заявки».'),
      h('section', { class: 'card step' }, h('h2', null, '1. Что нужно сделать?'), this.typeRow),
      h('section', { class: 'card step' }, h('h2', null, '2. С какой техникой?'), this.equipmentHint, this.equipmentGrid),
      h('section', { class: 'card step' }, h('h2', null, '3. Насколько срочно?'), this.priorityRow),
      h('section', { class: 'card step' }, h('h2', null, '4. Опишите проблему'), this.description),
      this.error,
      h('div', { class: 'actions' }, h('a', { class: 'arm-btn arm-btn-light', href: '#/tickets' }, 'Отмена'), this.submit),
    );
    this.renderChoices();
    void this.loadEquipment();
  }

  private renderChoices(): void {
    this.typeRow.replaceChildren(...TYPES.map((t) => {
      const button = h('button', {
        type: 'button', class: 'arm-chip', 'aria-pressed': String(t.value === this.type), title: t.hint,
        onclick: () => {
          this.type = t.value;
          this.renderChoices();
          this.renderEquipment();
        },
      }, t.label);
      return button;
    }));
    this.priorityRow.replaceChildren(...PRIORITIES.map((p) => h('button', {
      type: 'button', class: 'arm-chip', 'aria-pressed': String(p.value === this.priority),
      onclick: () => {
        this.priority = p.value;
        this.renderChoices();
      },
    }, p.label)));
  }

  private async loadEquipment(): Promise<void> {
    try {
      // Сервер отдаёт только видимое пользователю — сотруднику это его техника.
      const page = await api.get<Page<EquipmentListItem>>('/equipment', { limit: 500 });
      this.equipment = page.items.filter((item) => item.status !== 'written_off');
    } catch {
      this.equipment = [];
    }
    if (this.equipmentId !== null && !this.equipment.some((e) => e.equipment_id === this.equipmentId)) {
      this.equipmentId = null;
    }
    this.renderEquipment();
  }

  private renderEquipment(): void {
    const required = NEEDS_EQUIPMENT.includes(this.type);
    this.equipmentHint.textContent = required
      ? 'Выберите технику, с которой проблема.'
      : 'Можно не выбирать, если речь о новой технике.';

    const tile = (id: number | null, children: (Node | string)[]) => {
      const selected = this.equipmentId === id;
      return h('button', {
        type: 'button', class: `equipment-tile${selected ? ' selected' : ''}`, 'aria-pressed': String(selected),
        onclick: () => {
          this.equipmentId = id;
          this.renderEquipment();
        },
      }, children);
    };

    const tiles = this.equipment.map((item) => tile(item.equipment_id, [
      h('strong', null, item.type_name),
      h('span', { class: 'muted' }, `${item.manufacturer_name} ${item.model_name}`),
      SpecRow([SpecTile(item.inventory_no, 'Инв. номер'), ...(item.workplace_no ? [SpecTile(item.workplace_no, 'Рабочее место')] : [])]),
      statusBadge(item.status),
    ]));
    if (!required) tiles.unshift(tile(null, [h('strong', null, 'Без оборудования'), h('span', { class: 'muted small' }, 'Новая техника, рабочее место')]));
    if (tiles.length === 0) {
      this.equipmentGrid.replaceChildren(h('p', { class: 'muted' }, 'За вами не закреплено оборудование. Для ремонта обратитесь к системному администратору по телефону.'));
      return;
    }
    this.equipmentGrid.replaceChildren(...tiles);
  }

  private async send(): Promise<void> {
    this.error.textContent = '';
    const description = this.description.value.trim();
    if (NEEDS_EQUIPMENT.includes(this.type) && this.equipmentId === null) {
      this.error.textContent = 'Выберите технику, с которой проблема.';
      return;
    }
    if (description.length < 3) {
      this.error.textContent = 'Опишите проблему хотя бы парой слов.';
      this.description.focus();
      return;
    }

    this.submit.disabled = true;
    try {
      const saved = await api.post<TicketCard>('/tickets', {
        ticket_type: this.type,
        priority: this.priority,
        equipment_id: this.equipmentId,
        description,
      });
      toast(`Заявка № ${saved.ticket_id} отправлена`);
      location.hash = `#/tickets/${saved.ticket_id}`;
    } catch (error) {
      this.error.textContent = error instanceof ApiError ? error.message : 'Не удалось отправить заявку';
    } finally {
      this.submit.disabled = false;
    }
  }
}
