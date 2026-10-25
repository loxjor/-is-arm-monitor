import { StatusBadge } from '../../design/components';
import { ApiError, api } from '../api/client';
import type { Role, Scalar, User } from '../api/types';
import { currentUser } from '../auth';
import { catalogOptions, type Option } from '../lookups';
import { DataTable } from '../ui/DataTable';
import { Form, type FieldSpec } from '../ui/Form';
import { Modal } from '../ui/Modal';
import { formatDate, h } from '../ui/dom';
import { errorMessage, toast } from '../ui/toast';
import type { Screen } from './Screen';

export class UsersScreen implements Screen {
  readonly title = 'Пользователи ИС';
  readonly element: HTMLElement;
  private readonly table: DataTable<User>;
  private roles: Role[] = [];

  constructor() {
    this.table = new DataTable<User>(
      [
        { title: 'Логин', render: (u) => h('strong', null, u.login) },
        { title: 'Сотрудник', render: (u) => u.employee.full_name },
        { title: 'Роль', render: (u) => u.role.name },
        { title: 'Состояние', render: (u) => (u.is_active ? StatusBadge('free', 'Активен') : StatusBadge('neutral', 'Заблокирован')) },
        { title: 'Последний вход', render: (u) => formatDate(u.last_login_at) },
      ],
      { onRowClick: (user) => this.openEdit(user) },
    );
    this.element = h(
      'div',
      null,
      h('div', { class: 'page-head' },
        h('h1', null, this.title),
        h('button', { type: 'button', class: 'arm-btn', onclick: () => this.openCreate() }, 'Новый пользователь'),
      ),
      h('p', { class: 'muted' }, 'Учётные записи не удаляются — их блокируют. Нажмите на строку, чтобы сменить роль, заблокировать или сбросить пароль.'),
      this.table.element,
    );
    void this.load();
  }

  private roleOptions(): Promise<Option[]> {
    return Promise.resolve(this.roles.map((role) => ({ value: role.role_id, label: role.name })));
  }

  private async load(): Promise<void> {
    this.table.setLoading();
    try {
      const [users, roles] = await Promise.all([api.get<User[]>('/users'), api.get<Role[]>('/roles')]);
      this.roles = roles;
      this.table.setRows(users);
    } catch (error) {
      this.table.setRows([]);
      toast(errorMessage(error), 'error');
    }
  }

  private openCreate(): void {
    const fields: FieldSpec[] = [
      { name: 'login', label: 'Логин', kind: 'text', required: true, maxLength: 50, hint: 'Латиница, цифры, точка, дефис' },
      { name: 'password', label: 'Пароль', kind: 'password', required: true, hint: 'Не менее 8 символов' },
      { name: 'role_id', label: 'Роль', kind: 'select', required: true, options: () => this.roleOptions() },
      { name: 'employee_id', label: 'Сотрудник', kind: 'select', required: true, options: () => catalogOptions('employees') },
    ];
    this.openModal('Новый пользователь', fields, {}, (values) => api.post('/users', values), 'Пользователь создан');
  }

  private openEdit(user: User): void {
    const self = user.user_id === currentUser().user_id;
    const fields: FieldSpec[] = [
      { name: 'role_id', label: 'Роль', kind: 'select', required: true, options: () => this.roleOptions() },
      ...(self ? [] : [{ name: 'is_active', label: 'Учётная запись активна', kind: 'checkbox' } as FieldSpec]),
      { name: 'password', label: 'Новый пароль', kind: 'password', hint: 'Оставьте пустым, чтобы не менять' },
    ];
    this.openModal(
      `${user.login} — ${user.employee.full_name}`,
      fields,
      { role_id: user.role.role_id, is_active: user.is_active },
      (values) => api.patch(`/users/${user.user_id}`, values),
      'Изменения сохранены',
    );
  }

  private openModal(
    title: string,
    fields: FieldSpec[],
    initial: Record<string, Scalar>,
    submit: (values: Record<string, Scalar>) => Promise<unknown>,
    successMessage: string,
  ): void {
    const form = new Form(fields, initial);
    new Modal(title, form.element, [
      { label: 'Отмена', onClick: () => undefined },
      {
        label: 'Сохранить',
        kind: 'primary',
        onClick: async () => {
          const values = form.getValues();
          if (!values) return false;
          try {
            await submit(values);
            toast(successMessage);
            await this.load();
            return true;
          } catch (error) {
            if (error instanceof ApiError) form.showError(error.message, error.fieldErrors);
            else form.showError('Не удалось сохранить');
            return false;
          }
        },
      },
    ]).open();
    void form.ready.then(() => form.focusFirst());
  }
}
