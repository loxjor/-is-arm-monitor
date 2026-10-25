import { ApiError, api } from '../api/client';
import type { Scalar, TicketCard, TicketStatus, TicketWork } from '../api/types';
import { TICKET_TYPE_LABELS, priorityMark, ticketBadge } from '../labels';
import { DataTable } from '../ui/DataTable';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { dash, formatDate, h, type Child } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { RouteContext, Screen } from './Screen';

interface ActionSpec {
  label: string;
  primary?: boolean;
  /** Поля диалога; без полей переход выполняется сразу. */
  fields?: (card: TicketCard) => FieldSpec[];
  success: string;
}

function actionFor(card: TicketCard, to: TicketStatus): ActionSpec {
  switch (to) {
    case 'in_progress':
      return card.status === 'new'
        ? { label: 'Принять в работу', primary: true, success: 'Заявка принята в работу' }
        : {
            label: 'Вернуть в работу',
            fields: () => [{ name: 'comment', label: 'Что не устранено', kind: 'text', required: true, maxLength: 255 }],
            success: 'Заявка возвращена в работу',
          };
    case 'rejected':
      return {
        label: 'Отклонить',
        fields: () => [{ name: 'comment', label: 'Причина отклонения', kind: 'text', required: true, maxLength: 255 }],
        success: 'Заявка отклонена',
      };
    case 'done':
      return {
        label: 'Выполнено',
        primary: true,
        fields: (c) => [
          { name: 'comment', label: 'Итог работ', kind: 'text', maxLength: 255 },
          ...(c.equipment_id
            ? [{ name: 'unrepairable', label: 'Оборудование не подлежит ремонту (направить на списание)', kind: 'checkbox' } as FieldSpec]
            : []),
        ],
        success: 'Заявка выполнена',
      };
    case 'closed':
      return { label: 'Подтвердить выполнение', primary: true, success: 'Заявка закрыта' };
    default:
      return { label: to, success: 'Готово' };
  }
}

function facts(rows: [string, Child][]): HTMLElement {
  return h('dl', { class: 'facts' }, rows.flatMap(([term, value]) => [h('dt', null, term), h('dd', null, value)]));
}

export class TicketCardScreen implements Screen {
  title = 'Заявка';
  readonly element: HTMLElement;
  private readonly content = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));

  constructor(context: RouteContext) {
    this.element = h('div', null, h('a', { href: '#/tickets', class: 'back' }, '← Заявки'), this.content);
    void this.load(Number(context.params[0]));
  }

  private async load(id: number): Promise<void> {
    try {
      this.render(await api.get<TicketCard>(`/tickets/${id}`));
    } catch (error) {
      this.content.replaceChildren(h('p', { class: 'form-error' }, errorMessage(error)));
    }
  }

  private submit(
    card: TicketCard, path: string, fields: FieldSpec[], title: string, success: string,
    extra: Record<string, Scalar> = {},
  ): void {
    const run = async (values: Record<string, Scalar>, form: Form | null): Promise<boolean> => {
      try {
        const saved = await api.post<TicketCard>(`/tickets/${card.ticket_id}/${path}`, { ...extra, ...values });
        toast(success);
        this.render(saved);
        return true;
      } catch (error) {
        if (form && error instanceof ApiError) form.showError(error.message, error.fieldErrors);
        else toast(errorMessage(error), 'error');
        return false;
      }
    };

    if (fields.length === 0) {
      void run({}, null);
      return;
    }
    const form = new Form(fields);
    new Modal(title, form.element, [
      { label: 'Отмена', onClick: () => undefined },
      {
        label: 'Сохранить',
        kind: 'primary',
        onClick: async () => {
          const values = form.getValues();
          return values ? run(values, form) : false;
        },
      },
    ]).open();
    void form.ready.then(() => form.focusFirst());
  }

  private render(card: TicketCard): void {
    this.title = `Заявка № ${card.ticket_id}`;
    document.title = `${this.title} — АРМ Монитор`;

    const buttons = card.can_transition_to.map((to) => {
      const action = actionFor(card, to);
      return h('button', {
        type: 'button', class: `arm-btn${action.primary ? '' : ' arm-btn-light'}`,
        onclick: () => this.submit(card, 'transitions', action.fields?.(card) ?? [], action.label, action.success, { to }),
      }, action.label);
    });

    const workFields: FieldSpec[] = [
      { name: 'description', label: 'Содержание работ', kind: 'textarea', required: true },
      { name: 'minutes_spent', label: 'Затрачено, мин', kind: 'integer', min: 0 },
      { name: 'result', label: 'Результат', kind: 'text', maxLength: 255 },
    ];

    const works = new DataTable<TicketWork>(
      [
        { title: '№', render: (w) => String(w.work_no) },
        { title: 'Когда', render: (w) => formatDate(w.performed_at) },
        { title: 'Содержание', render: (w) => h('p', { class: 'description' }, w.description) },
        { title: 'Мин', render: (w) => dash(w.minutes_spent) },
        { title: 'Результат', render: (w) => dash(w.result) },
        { title: 'Кто', render: (w) => w.user_login },
      ],
      { emptyText: 'Записей пока нет' },
    );
    works.setRows(card.works);

    this.content.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, this.title, ' ', ticketBadge(card.status)),
          h('p', { class: 'muted' }, `${TICKET_TYPE_LABELS[card.ticket_type]} · создана ${formatDate(card.created_at)}`),
        ),
        h('div', { class: 'actions' }, buttons),
      ),
      h('div', { class: 'cards' },
        h('section', { class: 'card' }, h('h2', null, 'Описание'), h('p', { class: 'description' }, card.description)),
        h('section', { class: 'card' }, h('h2', null, 'Сведения'), facts([
          ['Оборудование', card.equipment_id
            ? h('a', { href: `#/equipment/${card.equipment_id}` }, card.inventory_no ?? `#${card.equipment_id}`)
            : '—'],
          ['Приоритет', priorityMark(card.priority)],
          ['Заявитель', card.requester_name],
          ['Исполнитель', dash(card.assignee_name)],
          ['Закрыта', formatDate(card.closed_at)],
        ])),
      ),
      h('section', { class: 'card' },
        h('div', { class: 'section-head' },
          h('h2', null, 'Журнал работ'),
          card.can_add_work
            ? h('button', {
                type: 'button', class: 'arm-btn arm-btn-light',
                onclick: () => this.submit(card, 'works', workFields, 'Запись в журнал работ', 'Запись добавлена'),
              }, '+ Добавить запись')
            : null,
        ),
        works.element,
      ),
    );
  }
}
