import { Button } from '../design/components';

export interface RoomEditorValue {
  title: string;
  note: string;
}

// Пределы длины — как у SceneRoom в backend/app/schemas/scene.py: длиннее сервер не примет.
const TITLE_MAX_LENGTH = 100;
const NOTE_MAX_LENGTH = 200;
const EDGE_GAP_PX = 8;

/**
 * Панель правки названия и примечания помещения поверх холста, у самого
 * помещения. Своя форма вместо window.prompt: встроенные браузеры (в том
 * числе панель браузера desktop-приложения) prompt не поддерживают вовсе.
 * Enter сохраняет, Esc или клик мимо панели — отмена.
 */
export class RoomEditor {
  private readonly form: HTMLFormElement;
  private readonly titleInput: HTMLInputElement;
  private readonly noteInput: HTMLInputElement;
  private onSave: ((value: RoomEditorValue) => void) | null = null;

  constructor(private readonly container: HTMLElement) {
    this.titleInput = this.createInput('room-editor-title', TITLE_MAX_LENGTH, 'каб. 1, Коридор…');
    this.titleInput.required = true;
    this.noteInput = this.createInput('room-editor-note', NOTE_MAX_LENGTH, 'Необязательно');

    this.form = document.createElement('form');
    this.form.className = 'room-editor';
    this.form.hidden = true;
    this.form.append(
      this.createField('Название', this.titleInput),
      this.createField('Примечание', this.noteInput),
      this.createActions(),
    );
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
      }
    });
    container.append(this.form);
  }

  /** at — точка в пикселях контейнера, вокруг которой встаёт панель (обычно центр помещения). */
  open(at: { x: number; y: number }, value: RoomEditorValue, onSave: (value: RoomEditorValue) => void): void {
    this.onSave = onSave;
    this.titleInput.value = value.title;
    this.noteInput.value = value.note;
    this.form.hidden = false;

    const maxLeft = this.container.clientWidth - this.form.offsetWidth - EDGE_GAP_PX;
    const maxTop = this.container.clientHeight - this.form.offsetHeight - EDGE_GAP_PX;
    this.form.style.left = `${Math.max(EDGE_GAP_PX, Math.min(maxLeft, at.x - this.form.offsetWidth / 2))}px`;
    this.form.style.top = `${Math.max(EDGE_GAP_PX, Math.min(maxTop, at.y - this.form.offsetHeight / 2))}px`;

    // На фазе захвата: Konva гасит часть событий на своём канвасе, а закрыть
    // панель нужно по любому нажатию мимо неё.
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
    this.titleInput.focus();
    this.titleInput.select();
  }

  close(): void {
    this.form.hidden = true;
    this.onSave = null;
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
  }

  destroy(): void {
    this.close();
    this.form.remove();
  }

  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.form.contains(event.target)) {
      this.close();
    }
  };

  private submit(): void {
    const title = this.titleInput.value.trim();
    if (!title) {
      this.titleInput.focus();
      return;
    }
    const onSave = this.onSave;
    const note = this.noteInput.value.trim();
    this.close();
    onSave?.({ title, note });
  }

  private createInput(id: string, maxLength: number, placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.maxLength = maxLength;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    return input;
  }

  private createField(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'room-editor-field';
    const caption = document.createElement('span');
    caption.className = 't-label';
    caption.textContent = text;
    label.append(caption, input);
    return label;
  }

  private createActions(): HTMLDivElement {
    const actions = document.createElement('div');
    actions.className = 'room-editor-actions';
    actions.append(
      Button('Отмена', { variant: 'light', onClick: () => this.close() }),
      Button('Сохранить', { type: 'submit' }),
    );
    return actions;
  }
}
