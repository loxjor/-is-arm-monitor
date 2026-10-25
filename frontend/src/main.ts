import './styles/tokens.css';
import './styles/components.css';
import './styles/base.css';
import './style.css';
import {
  DESK_PLACEMENT_SIZE_CM,
  FloorPlanCanvas,
  type CanvasMode,
  type SelectedWallInfo,
} from './components/FloorPlanCanvas';
import { cm } from './utils/scale';
import { generateId } from './utils/id';
import type { WorkspaceStatus } from './types/workspace';
import { FloorPlanApiError, listFloorPlans, loadFloorPlan, saveFloorPlan, sessionToken } from './api/floorPlans';
import { currentTheme, initTheme, onThemeChange, setTheme } from './theme';

initTheme();

// Интерфейс — из ветки workplace-map (верхняя/левая/нижняя панели), движок
// черчения — FloorPlanCanvas. Холст занимает весь экран, панели поверх него.
const canvasContainer = document.getElementById('editor-canvas')!;
const canvas = new FloorPlanCanvas('editor-canvas', canvasContainer.clientWidth, canvasContainer.clientHeight);

const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

const saveBtn = $<HTMLButtonElement>('#btn-save');
const loadBtn = $<HTMLButtonElement>('#btn-load');
const printBtn = $<HTMLButtonElement>('#btn-print');
const planTitle = $<HTMLSpanElement>('#plan-title');
const saveStatus = $<HTMLSpanElement>('#save-status');

const cursorBtn = $<HTMLButtonElement>('#btn-cursor');
const wallBtn = $<HTMLButtonElement>('#btn-wall');
const deskBtn = $<HTMLButtonElement>('#btn-desk');

const toolSettings = $<HTMLElement>('#tool-settings');
const wallSettings = $<HTMLElement>('#settings-wall');
const wallThicknessValue = $<HTMLInputElement>('#settings-wall .setting-value');
const selectedWallSettings = $<HTMLElement>('#settings-selected-wall');
const lengthInput = $<HTMLInputElement>('#input-length');
const selectedThicknessInput = $<HTMLInputElement>('#input-selected-thickness');
const deskSettings = $<HTMLElement>('#settings-desk');

const hint = $<HTMLElement>('#canvas-hint');
const undoBtn = $<HTMLButtonElement>('#btn-undo');
const deleteBtn = $<HTMLButtonElement>('#btn-delete');
const hintsToggle = $<HTMLButtonElement>('#hints-toggle');
const snapToggle = $<HTMLButtonElement>('#snap-toggle');
const dimensionsToggle = $<HTMLButtonElement>('#dimensions-toggle');
const themeToggle = $<HTMLButtonElement>('#theme-toggle');
const backgroundInput = $<HTMLInputElement>('#input-background');
const centerBtn = $<HTMLButtonElement>('#btn-center');
const scaleReadout = $<HTMLSpanElement>('#scale-readout');

const settingsBtn = $<HTMLButtonElement>('#btn-settings');
const settingsModal = $<HTMLElement>('#modal-settings');
const planNameInput = $<HTMLInputElement>('#input-plan-name');

// ─── Инструменты ───────────────────────────────────────────────

const HINTS: Record<CanvasMode, string> = {
  select:
    'Выбор: клик — выделить стену или стол, перетаскивание — переместить. ' +
    'Колесо — масштаб, перетаскивание пустого места — сдвиг плана. Delete — удалить.',
  'draw-wall':
    'Стена: протяните от точки до точки. Shift — без магнитов. ' +
    'Начните от торца или тела стены, чтобы примкнуть к ней.',
  view: '',
  'place-desk': 'Рабочее место: клик — поставить стол, R — повернуть на 90°, Esc — закончить.',
};

let selectedWall: SelectedWallInfo | null = null;

function setTool(mode: CanvasMode): void {
  canvas.setMode(mode);
  cursorBtn.setAttribute('aria-pressed', String(mode === 'select'));
  wallBtn.setAttribute('aria-pressed', String(mode === 'draw-wall'));
  deskBtn.setAttribute('aria-pressed', String(mode === 'place-desk'));
  hint.textContent = HINTS[mode];
  refreshSettingsPanel();
}

cursorBtn.addEventListener('click', () => setTool('select'));
wallBtn.addEventListener('click', () => setTool('draw-wall'));

deskBtn.addEventListener('click', () => setTool('place-desk'));

/** Следующий номер «АРМ N» — после максимального среди уже стоящих столов, а не по их количеству. */
function nextDeskNumber(): number {
  let max = 0;
  for (const workspace of canvas.serialize().workspaces) {
    const match = /^АРМ (\d+)$/.exec(workspace.label);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

canvas.setOnDeskPlace((topLeft, rotation) => {
  canvas.addWorkspace({
    id: generateId('workspace'),
    x: topLeft.x,
    y: topLeft.y,
    width: cm(DESK_PLACEMENT_SIZE_CM.width),
    height: cm(DESK_PLACEMENT_SIZE_CM.height),
    rotation,
    label: `АРМ ${nextDeskNumber()}`,
    status: 'free',
  });
});

// ─── Панель настроек: толщина новой стены / выделенная стена / стол ─────

function selectedDeskId(): string | null {
  const id = canvas.getSelectedId();
  return id !== null && canvas.getWorkspace(id) ? id : null;
}

function refreshSettingsPanel(): void {
  const mode = canvas.getMode();
  const showNewWall = mode === 'draw-wall';
  const showSelectedWall = mode === 'select' && selectedWall !== null;
  const showDesk = mode === 'select' && selectedDeskId() !== null;

  wallSettings.hidden = !showNewWall;
  selectedWallSettings.hidden = !showSelectedWall;
  deskSettings.hidden = !showDesk;
  toolSettings.style.display = showNewWall || showSelectedWall || showDesk ? 'block' : 'none';

  if (showNewWall) {
    wallThicknessValue.value = String(canvas.getWallThickness());
  }
  if (showDesk) {
    const status = canvas.getWorkspace(selectedDeskId() ?? '')?.toData().status;
    deskStatusButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.status === status)));
  }
  if (showSelectedWall && selectedWall) {
    // Поле, в котором сейчас печатают, не трогаем — текст переписывался бы под курсором.
    if (document.activeElement !== lengthInput) lengthInput.value = String(Math.round(selectedWall.lengthCm));
    if (document.activeElement !== selectedThicknessInput) {
      selectedThicknessInput.value = String(selectedWall.thicknessCm);
    }
  }
}

function applyNewWallThickness(value: number): void {
  wallThicknessValue.value = String(canvas.setWallThickness(value));
}

$<HTMLButtonElement>('#settings-wall .setting-btn.minus').addEventListener('click', () => {
  applyNewWallThickness(canvas.getWallThickness() - 1);
});
$<HTMLButtonElement>('#settings-wall .setting-btn.plus').addEventListener('click', () => {
  applyNewWallThickness(canvas.getWallThickness() + 1);
});
document.querySelectorAll<HTMLButtonElement>('#settings-wall .preset-btn').forEach((preset) => {
  preset.addEventListener('click', () => applyNewWallThickness(Number(preset.textContent)));
});

// Длину — только по change (Enter/уход из поля): промежуточное «1» при наборе
// «150» сжало бы стену до минимума и потащило за собой соседей.
lengthInput.addEventListener('change', () => {
  const applied = canvas.setSelectedWallLength(Number(lengthInput.value));
  if (applied === null && selectedWall) {
    lengthInput.value = String(Math.round(selectedWall.lengthCm));
  }
});

// Толщина выделенной стены — сразу по вводу (движок применяет её к выделенной
// стене), нормализация видимого значения — при уходе из поля.
selectedThicknessInput.addEventListener('input', () => {
  const value = Number(selectedThicknessInput.value);
  if (Number.isFinite(value) && value > 0) canvas.setWallThickness(value);
});
selectedThicknessInput.addEventListener('change', () => {
  selectedThicknessInput.value = String(selectedWall?.thicknessCm ?? canvas.getWallThickness());
});

const deskStatusButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#settings-desk .preset-btn'));
deskStatusButtons.forEach((button) => {
  button.addEventListener('click', () => {
    canvas.setSelectedWorkspaceStatus(button.dataset.status as WorkspaceStatus);
    refreshSettingsPanel();
  });
});

canvas.setOnSelectionChange((wall) => {
  selectedWall = wall;
  refreshSettingsPanel();
});
// Выделение стола движок не сообщает колбэком — сверяемся после клика по холсту.
canvasContainer.addEventListener('mouseup', () => window.setTimeout(refreshSettingsPanel, 0));
canvasContainer.addEventListener('touchend', () => window.setTimeout(refreshSettingsPanel, 0));

// ─── Нижняя панель ─────────────────────────────────────────────

undoBtn.addEventListener('click', () => {
  canvas.undo();
  refreshSettingsPanel();
});
deleteBtn.addEventListener('click', () => {
  canvas.removeSelected();
  refreshSettingsPanel();
});

/** Таблетка-переключатель: состояние — в aria-pressed, его же читают скринридеры. */
function bindToggle(button: HTMLButtonElement, onChange: (on: boolean) => void): void {
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
}

bindToggle(hintsToggle, (on) => {
  hint.hidden = !on;
});
bindToggle(snapToggle, (on) => canvas.setSnapEnabled(on));
bindToggle(dimensionsToggle, (on) => canvas.setShowDimensions(on));
// Сцена перекрашивается сама (FloorPlanCanvas подписан на смену темы) — здесь только кнопка.
bindToggle(themeToggle, (on) => setTheme(on ? 'dark' : 'light'));
const syncThemeToggle = () => themeToggle.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
syncThemeToggle();
onThemeChange(syncThemeToggle);

backgroundInput.addEventListener('change', () => {
  const file = backgroundInput.files?.[0];
  if (file) canvas.loadBackgroundPlan(URL.createObjectURL(file));
});

centerBtn.addEventListener('click', () => canvas.resetView());
canvas.setOnScaleChange((scale) => {
  scaleReadout.textContent = `${Math.round(scale * 100)}%`;
});

printBtn.addEventListener('click', () => window.print());

// ─── Сохранение и открытие планов ──────────────────────────────

// Последний открытый/сохранённый план запоминается в localStorage — после
// F5 «Сохранить» обновляет его же, а не создаёт новый. Открыть можно любой
// план из списка («Загрузить») или по адресу index.html?plan=N.
const FLOOR_PLAN_ID_STORAGE_KEY = 'floorPlanId';
const FLOOR_PLAN_NAME_STORAGE_KEY = 'floorPlanName';

function readStoredFloorPlanId(): number | null {
  const raw = localStorage.getItem(FLOOR_PLAN_ID_STORAGE_KEY);
  const id = raw === null ? NaN : Number(raw);
  return Number.isFinite(id) ? id : null;
}

let currentFloorPlanId: number | null = readStoredFloorPlanId();
let currentFloorPlanName: string | null = localStorage.getItem(FLOOR_PLAN_NAME_STORAGE_KEY);
let statusTimeoutId: number | undefined;

function rememberPlan(id: number | null, name: string | null): void {
  currentFloorPlanId = id;
  currentFloorPlanName = name;
  if (id === null) localStorage.removeItem(FLOOR_PLAN_ID_STORAGE_KEY);
  else localStorage.setItem(FLOOR_PLAN_ID_STORAGE_KEY, String(id));
  if (name === null) localStorage.removeItem(FLOOR_PLAN_NAME_STORAGE_KEY);
  else localStorage.setItem(FLOOR_PLAN_NAME_STORAGE_KEY, name);
  planTitle.textContent = name ?? '';
  document.title = name ? `${name} — редактор плана` : 'Редактор плана этажа';
}

function showStatus(text: string, isError: boolean): void {
  window.clearTimeout(statusTimeoutId);
  saveStatus.textContent = text;
  saveStatus.classList.toggle('save-status-error', isError);
  statusTimeoutId = window.setTimeout(() => {
    saveStatus.textContent = '';
  }, 4000);
}

async function savePlan(name: string): Promise<void> {
  try {
    const id = await saveFloorPlan(canvas.serialize(), currentFloorPlanId, name);
    rememberPlan(id, name);
    showStatus('Сохранено', false);
  } catch (error) {
    // Бэкенд может быть недоступен — черчение при этом продолжает работать.
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';
    showStatus(`Не удалось сохранить: ${message}`, true);
  }
}

saveBtn.addEventListener('click', () => {
  let name = currentFloorPlanName;
  if (currentFloorPlanId === null || !name) {
    name = window.prompt('Название плана', name ?? 'Новый план')?.trim() || null;
    if (!name) return;
  }
  void savePlan(name);
});

async function openPlan(planId: number, name: string): Promise<void> {
  try {
    const scene = await loadFloorPlan(planId);
    canvas.loadScene(scene);
    canvas.resetView();
    rememberPlan(planId, name);
    selectedWall = null;
    refreshSettingsPanel();
    showStatus('Открыто', false);
  } catch (error) {
    // 404 — плана больше нет на сервере: забываем его, иначе «Сохранить»
    // упиралось бы в несуществующий id.
    if (error instanceof FloorPlanApiError && error.status === 404 && currentFloorPlanId === planId) {
      rememberPlan(null, null);
    }
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';
    showStatus(`Не удалось открыть: ${message}`, true);
  }
}

let planPicker: HTMLElement | null = null;

function closePlanPicker(): void {
  planPicker?.remove();
  planPicker = null;
  document.removeEventListener('mousedown', onOutsidePickerClick);
  document.removeEventListener('keydown', onPickerKey);
}

function onOutsidePickerClick(event: MouseEvent): void {
  if (planPicker && event.target instanceof Node && !planPicker.contains(event.target)
      && !loadBtn.contains(event.target)) {
    closePlanPicker();
  }
}

function onPickerKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') closePlanPicker();
}

loadBtn.addEventListener('click', () => {
  if (planPicker) {
    closePlanPicker();
    return;
  }
  void (async () => {
    let plans;
    try {
      plans = await listFloorPlans();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'неизвестная ошибка';
      showStatus(`Не удалось получить список планов: ${message}`, true);
      return;
    }
    if (plans.length === 0) {
      showStatus('На сервере нет сохранённых планов', true);
      return;
    }

    const picker = document.createElement('div');
    picker.className = 'plan-picker';
    picker.setAttribute('role', 'listbox');
    picker.setAttribute('aria-label', 'Сохранённые планы');
    for (const plan of plans) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'plan-picker-item';
      item.setAttribute('role', 'option');
      if (plan.id === currentFloorPlanId) item.classList.add('current');
      const updated = new Date(plan.updated_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
      const title = document.createElement('span');
      title.textContent = plan.name;
      const meta = document.createElement('small');
      meta.textContent = `№ ${plan.id} · изм. ${updated}`;
      item.append(title, meta);
      item.addEventListener('click', () => {
        closePlanPicker();
        void openPlan(plan.id, plan.name);
      });
      picker.append(item);
    }

    const rect = loadBtn.getBoundingClientRect();
    picker.style.top = `${rect.bottom + 6}px`;
    picker.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
    document.body.append(picker);
    planPicker = picker;
    picker.querySelector<HTMLButtonElement>('.plan-picker-item')?.focus();
    document.addEventListener('mousedown', onOutsidePickerClick);
    document.addEventListener('keydown', onPickerKey);
  })();
});

// ─── Настройки плана (шестерёнка): название, новый план ──────────

function closeSettings(): void {
  settingsModal.classList.remove('active');
}

settingsBtn.addEventListener('click', () => {
  planNameInput.value = currentFloorPlanName ?? '';
  settingsModal.classList.add('active');
  planNameInput.focus();
});
settingsModal.querySelector<HTMLButtonElement>('.close-modal')!.addEventListener('click', closeSettings);
settingsModal.addEventListener('mousedown', (event) => {
  if (event.target === settingsModal) closeSettings();
});

$<HTMLButtonElement>('#btn-rename-plan').addEventListener('click', () => {
  const name = planNameInput.value.trim();
  if (!name) {
    planNameInput.focus();
    return;
  }
  closeSettings();
  if (currentFloorPlanId === null) {
    rememberPlan(null, name);
    showStatus('Название задано — сохраните план', false);
  } else {
    void savePlan(name);
  }
});

$<HTMLButtonElement>('#btn-new-plan').addEventListener('click', () => {
  if (!window.confirm('Начать новый план? Несохранённые изменения текущего пропадут.')) return;
  const empty = canvas.serialize();
  canvas.loadScene({ ...empty, nodes: [], segments: [], workspaces: [] });
  rememberPlan(null, null);
  selectedWall = null;
  closeSettings();
  setTool('select');
  showStatus('Новый план', false);
});

// ─── Клавиатура ────────────────────────────────────────────────

function isTypingInField(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsModal.classList.contains('active')) {
    closeSettings();
    return;
  }
  if (isTypingInField()) {
    return;
  }

  if (canvas.getMode() === 'place-desk') {
    // event.code — физическая клавиша: R работает и в русской раскладке (К).
    if (event.code === 'KeyR') {
      canvas.rotateDeskGhost();
      return;
    }
    if (event.key === 'Escape') {
      setTool('select');
      return;
    }
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    canvas.removeSelected();
    refreshSettingsPanel();
    return;
  }

  // event.key зависит от раскладки — при русской раскладке Ctrl+Z даёт
  // key: 'я', а не 'z'. event.code — физическая клавиша, от раскладки не зависит.
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    event.preventDefault();
    canvas.undo();
    refreshSettingsPanel();
  }
});

// ─── Доступ: редактор только для администратора ИС ─────────────

/** Закрывает редактор плашкой, если вход не выполнен или роль не та. Сервер проверяет права и сам. */
async function checkEditorAccess(): Promise<boolean> {
  const token = sessionToken();
  let reason = 'Войдите в систему под учётной записью администратора ИС.';
  if (token) {
    try {
      const response = await fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const user = (await response.json()) as { permissions?: string[] };
        if (user.permissions?.includes('edit_floor_plans')) return true;
        reason = 'Редактор плана доступен только администратору ИС. Посмотреть план можно в разделе «Карта этажа».';
      }
    } catch {
      reason = 'Сервер недоступен.';
    }
  }
  const lock = document.createElement('div');
  lock.className = 'editor-lock';
  lock.setAttribute('role', 'alertdialog');
  const box = document.createElement('div');
  box.className = 'editor-lock-box';
  const title = document.createElement('h2');
  title.textContent = 'Нет доступа к редактору';
  const text = document.createElement('p');
  text.textContent = reason;
  const link = document.createElement('a');
  link.className = 'arm-btn';
  link.href = '/admin.html';
  link.textContent = token ? 'Вернуться в АРМ Монитор' : 'Войти';
  box.append(title, text, link);
  lock.append(box);
  document.body.append(lock);
  return false;
}

// ─── Старт ─────────────────────────────────────────────────────

void checkEditorAccess().then((editorAllowed) => {
  if (!editorAllowed) return;

  setTool('select');
  rememberPlan(currentFloorPlanId, currentFloorPlanName);

  // index.html?plan=N — открыть конкретный план сразу (ссылка из учётной части);
  // иначе — последний открытый на этом устройстве, если он ещё есть на сервере.
  const planFromUrl = Number(new URLSearchParams(location.search).get('plan'));
  const planToOpen = Number.isInteger(planFromUrl) && planFromUrl > 0 ? planFromUrl : currentFloorPlanId;
  if (planToOpen !== null) {
    void listFloorPlans()
      .then((plans) => {
        const plan = plans.find((p) => p.id === planToOpen);
        if (plan) void openPlan(plan.id, plan.name);
        else if (planToOpen === planFromUrl) showStatus(`План № ${planToOpen} не найден`, true);
        else rememberPlan(null, null);
      })
      .catch(() => showStatus('Сервер недоступен — можно чертить, сохранить не получится', true));
  }
});
