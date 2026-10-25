import { buttonClass, type ButtonVariant } from '../../design/components';
import { h } from './dom';

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'danger' | 'plain';
  /** Возвращает false (или Promise<false>), чтобы окно не закрывалось — например, при ошибке. */
  onClick: () => boolean | void | Promise<boolean | void>;
}

const ACTION_VARIANT: Record<NonNullable<ModalAction['kind']>, ButtonVariant> = {
  primary: 'dark',
  danger: 'danger',
  plain: 'light',
};

/** Модальное окно поверх страницы. Esc и клик по фону закрывают его. */
export class Modal {
  private readonly overlay: HTMLElement;
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
  };

  constructor(title: string, body: Node, actions: ModalAction[]) {
    const buttons = actions.map((action) => {
      const button = h('button', { type: 'button', class: buttonClass(ACTION_VARIANT[action.kind ?? 'plain']) }, action.label);
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          if ((await action.onClick()) !== false) this.close();
        } finally {
          button.disabled = false;
        }
      });
      return button;
    });

    const dialog = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' },
        h('h2', null, title),
        h('button', { type: 'button', class: buttonClass('light'), onclick: () => this.close() }, 'Закрыть'),
      ),
      h('div', { class: 'modal-body' }, body),
      h('div', { class: 'modal-actions' }, buttons),
    );
    this.overlay = h('div', { class: 'overlay' }, dialog);
    this.overlay.addEventListener('mousedown', (event) => {
      if (event.target === this.overlay) this.close();
    });
  }

  open(): this {
    document.body.append(this.overlay);
    document.addEventListener('keydown', this.onKeyDown);
    return this;
  }

  close(): void {
    this.overlay.remove();
    document.removeEventListener('keydown', this.onKeyDown);
  }
}

export function confirmDialog(title: string, text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const modal = new Modal(title, h('p', null, text), [
      { label: 'Отмена', onClick: () => undefined },
      {
        label: confirmLabel,
        kind: 'danger',
        onClick: () => {
          answered = true;
          resolve(true);
        },
      },
    ]).open();
    const originalClose = modal.close.bind(modal);
    modal.close = () => {
      originalClose();
      if (!answered) resolve(false);
    };
  });
}
