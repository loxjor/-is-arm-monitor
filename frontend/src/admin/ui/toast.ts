import { h } from './dom';

let container: HTMLElement | null = null;

/** Короткое уведомление в углу экрана, исчезает само. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok'): void {
  if (!container) {
    container = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(container);
  }
  const item = h('div', { class: `toast toast--${kind}` }, message);
  container.append(item);
  window.setTimeout(() => item.remove(), kind === 'error' ? 6000 : 3000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка';
}
