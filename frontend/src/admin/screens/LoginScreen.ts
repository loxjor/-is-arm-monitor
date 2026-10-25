import { ApiError } from '../api/client';
import { login } from '../auth';
import { h } from '../ui/dom';

export class LoginScreen {
  readonly element: HTMLElement;

  constructor(onLoggedIn: () => void) {
    const loginInput = h('input', { name: 'login', autocomplete: 'username', required: true, autofocus: true });
    const passwordInput = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    const error = h('div', { class: 'form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'arm-btn btn-wide' }, 'Войти');

    const form = h(
      'form',
      { class: 'login-card' },
      h('div', { class: 'login-brand' }, h('span', { class: 'arm-tree-mark' }), h('span', null, 'АРМ Монитор')),
      h('p', { class: 'login-sub' }, 'Учёт автоматизированных рабочих мест'),
      error,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Логин'), loginInput),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Пароль'), passwordInput),
      submit,
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        await login(loginInput.value.trim(), passwordInput.value);
        onLoggedIn();
      } catch (caught) {
        error.textContent = caught instanceof ApiError ? caught.message : 'Не удалось войти';
        passwordInput.select();
      } finally {
        submit.disabled = false;
      }
    });

    this.element = h('div', { class: 'login-page' }, form);
  }
}
