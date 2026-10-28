import './styles/tokens.css';
import './styles/components.css';
import './styles/base.css';
import './style.css';
import {
  DESK_PLACEMENT_SIZE_CM,
  FloorPlanCanvas,
  type CanvasMode,
  type OpeningToolMode,
  type SelectedWallInfo,
} from './components/FloorPlanCanvas';
import { OPENING_DEFAULTS, OPENING_WIDTH_PRESETS, type OpeningKind } from './types/opening';
import type { OpeningOptions } from './utils/wallOpening';
import { emptyScene, type PlanData, type PlanFloor, type SceneData } from './types/scene';
import { FloorPicker } from './components/FloorPicker';
import { CalibrationPanel } from './components/CalibrationPanel';
import { BackgroundMenu } from './components/BackgroundMenu';
import { StairsMenu } from './components/StairsMenu';
import { STAIR_MENU, STAIR_VARIANTS, type StairVariant } from './types/fixture';
import { copyFloorScene, floorInsertIndex, floorName, type FloorCopyMode } from './utils/floorCopy';
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
const windowBtn = $<HTMLButtonElement>('#btn-window');
const doorBtn = $<HTMLButtonElement>('#btn-door');
const stairsBtn = $<HTMLButtonElement>('#btn-stairs');
const elevatorBtn = $<HTMLButtonElement>('#btn-elevator');

const toolSettings = $<HTMLElement>('#tool-settings');
const wallSettings = $<HTMLElement>('#settings-wall');
const wallThicknessValue = $<HTMLInputElement>('#settings-wall .setting-value');
const selectedWallSettings = $<HTMLElement>('#settings-selected-wall');
const lengthInput = $<HTMLInputElement>('#input-length');
const selectedThicknessInput = $<HTMLInputElement>('#input-selected-thickness');
const deskSettings = $<HTMLElement>('#settings-desk');
const openingSettings = $<HTMLElement>('#settings-opening');
const fixtureSettings = $<HTMLElement>('#settings-fixture');
const fixtureTitle = $<HTMLElement>('#fixture-settings-title');
const fixtureWidthLabel = $<HTMLElement>('#label-fixture-width');
const fixtureHeightLabel = $<HTMLElement>('#label-fixture-height');
const fixtureWidthInput = $<HTMLInputElement>('#input-fixture-width');
const fixtureHeightInput = $<HTMLInputElement>('#input-fixture-height');
const fixtureVariantSelect = $<HTMLSelectElement>('#input-fixture-variant');
const openingTitle = $<HTMLElement>('#opening-settings-title');
const openingKindButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#opening-kind-row .arm-chip'));
const openingWidthInput = $<HTMLInputElement>('#input-opening-width');
const openingWidthPresets = $<HTMLElement>('#opening-width-presets');
const openingDoorActions = $<HTMLElement>('#opening-door-actions');

const hint = $<HTMLElement>('#canvas-hint');
const floorPickerHost = $<HTMLElement>('#floor-picker-host');
const undoBtn = $<HTMLButtonElement>('#btn-undo');
const redoBtn = $<HTMLButtonElement>('#btn-redo');
const deleteBtn = $<HTMLButtonElement>('#btn-delete');
const hintsToggle = $<HTMLButtonElement>('#hints-toggle');
const snapToggle = $<HTMLButtonElement>('#snap-toggle');
const dimensionsToggle = $<HTMLButtonElement>('#dimensions-toggle');
const themeToggle = $<HTMLButtonElement>('#theme-toggle');
const backgroundMenuHost = $<HTMLElement>('#background-menu-host');
const centerBtn = $<HTMLButtonElement>('#btn-center');
const scaleReadout = $<HTMLSpanElement>('#scale-readout');

const settingsBtn = $<HTMLButtonElement>('#btn-settings');
const settingsModal = $<HTMLElement>('#modal-settings');
const planNameInput = $<HTMLInputElement>('#input-plan-name');

// ─── Инструменты ───────────────────────────────────────────────

const HINTS: Record<CanvasMode, string> = {
  select:
    'Выбор: клик — выделить стену или стол, перетаскивание — переместить. ' +
    'Shift+клик — добавить к выделению, Shift+рамка по пустому месту — выделить несколько. ' +
    'Колесо — масштаб, перетаскивание пустого места — сдвиг плана. Delete — удалить.',
  'draw-wall':
    'Стена: протяните от точки до точки. Shift — без магнитов. ' +
    'Начните от торца или тела стены, чтобы примкнуть к ней.',
  view: '',
  'place-desk': 'Рабочее место: клик — поставить стол, R — повернуть на 90°, Esc — закончить.',
  calibrate:
    'Подложка: проведите отрезок вдоль известного размера, затем введите его длину. ' +
    'Shift — по горизонтали или вертикали, Esc — отмена.',
  'move-background': 'Подложка: перетащите картинку, чтобы совместить её со стенами. Esc — закончить.',
  'place-stairs': 'Лестница: клик — поставить марш, стрелка — направление подъёма. R — повернуть на 90°, Esc — закончить.',
  'place-elevator': 'Лифт: клик — поставить шахту. R — повернуть на 90°, Esc — закончить.',
  'place-window': 'Окно: наведите на стену и кликните. Esc — закончить.',
  'place-door':
    'Дверь: наведите на стену и кликните — откроется в сторону курсора. ' +
    'Выделенную дверь можно перевесить кнопками справа. Esc — закончить.',
};

let selectedWall: SelectedWallInfo | null = null;

function setTool(mode: CanvasMode): void {
  // Ушли из калибровки другим инструментом — калибровка отменяется.
  if (mode !== 'calibrate' && canvas.isCalibrating()) {
    canvas.cancelBackgroundCalibration();
    calibrationPanel.hide();
  }
  canvas.setMode(mode);
  refreshBackgroundMenu();
  cursorBtn.setAttribute('aria-pressed', String(mode === 'select'));
  wallBtn.setAttribute('aria-pressed', String(mode === 'draw-wall'));
  deskBtn.setAttribute('aria-pressed', String(mode === 'place-desk'));
  windowBtn.setAttribute('aria-pressed', String(mode === 'place-window'));
  doorBtn.setAttribute('aria-pressed', String(mode === 'place-door'));
  stairsBtn.setAttribute('aria-pressed', String(mode === 'place-stairs'));
  elevatorBtn.setAttribute('aria-pressed', String(mode === 'place-elevator'));
  hint.textContent = HINTS[mode];
  refreshSettingsPanel();
}

cursorBtn.addEventListener('click', () => setTool('select'));
wallBtn.addEventListener('click', () => setTool('draw-wall'));

deskBtn.addEventListener('click', () => setTool('place-desk'));
windowBtn.addEventListener('click', () => setTool('place-window'));
doorBtn.addEventListener('click', () => setTool('place-door'));
// «Лестница» — сначала выбор вида (меню как в RemPlanner), потом расстановка.
const stairsMenu = new StairsMenu((variant) => {
  canvas.setStairVariant(variant);
  setTool('place-stairs');
  hint.textContent = `${STAIR_VARIANTS[variant].name}: клик — поставить, стрелка — направление подъёма. R — повернуть на 90°, Esc — закончить.`;
});
document.body.append(stairsMenu.element);
stairsBtn.addEventListener('click', () => {
  if (stairsMenu.isOpen()) stairsMenu.close();
  else stairsMenu.open(stairsBtn);
});
elevatorBtn.addEventListener('click', () => setTool('place-elevator'));

/** Следующий номер «АРМ N» — после максимального среди уже стоящих столов, а не по их количеству. */
function nextDeskNumber(): number {
  let max = 0;
  // По всем этажам: номер «АРМ N» уникален в пределах плана, а не этажа.
  for (const workspace of collectPlan().floors.flatMap((floor) => floor.scene.workspaces)) {
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
  const opening = openingPanelTarget();
  const fixture = mode === 'select' ? canvas.getSelectedFixture() : null;

  wallSettings.hidden = !showNewWall;
  selectedWallSettings.hidden = !showSelectedWall;
  deskSettings.hidden = !showDesk;
  openingSettings.hidden = !opening;
  fixtureSettings.hidden = !fixture;
  toolSettings.style.display = showNewWall || showSelectedWall || showDesk || opening || fixture ? 'block' : 'none';

  if (fixture) {
    const stairs = fixture.kind === 'stairs';
    fixtureTitle.textContent = stairs ? 'Лестница' : 'Лифт';
    fixtureVariantSelect.hidden = !stairs;
    if (stairs) fixtureVariantSelect.value = fixture.variant ?? 'straight';
    fixtureWidthLabel.textContent = stairs ? 'Ширина марша, см' : 'Ширина шахты, см';
    fixtureHeightLabel.textContent = stairs ? 'Длина марша, см' : 'Глубина шахты, см';
    if (document.activeElement !== fixtureWidthInput) fixtureWidthInput.value = String(Math.round(fixture.width));
    if (document.activeElement !== fixtureHeightInput) fixtureHeightInput.value = String(Math.round(fixture.height));
  }

  if (opening) {
    renderOpeningSettings(opening.options, opening.tool);
  }

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

// Размеры лестницы/лифта — по change, как длину стены.
fixtureWidthInput.addEventListener('change', () => {
  canvas.updateSelectedFixture({ width: Number(fixtureWidthInput.value) });
  fixtureWidthInput.blur();
  refreshSettingsPanel();
});
fixtureHeightInput.addEventListener('change', () => {
  canvas.updateSelectedFixture({ height: Number(fixtureHeightInput.value) });
  fixtureHeightInput.blur();
  refreshSettingsPanel();
});
// Вид выделенной лестницы — те же группы, что в меню инструмента.
fixtureVariantSelect.replaceChildren(
  ...STAIR_MENU.map((group) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.title;
    group.items.forEach((variant) => {
      const option = document.createElement('option');
      option.value = variant;
      option.textContent = STAIR_VARIANTS[variant].name;
      optgroup.append(option);
    });
    return optgroup;
  }),
);
fixtureVariantSelect.addEventListener('change', () => {
  canvas.updateSelectedFixture({ variant: fixtureVariantSelect.value as StairVariant });
  refreshSettingsPanel();
});
$<HTMLButtonElement>('#btn-fixture-rotate').addEventListener('click', () => {
  const fixture = canvas.getSelectedFixture();
  if (fixture) canvas.updateSelectedFixture({ rotation: fixture.rotation + 90 });
});

// ─── Окно / дверь: одна панель и для инструмента, и для выделенного проёма ──

const WINDOW_KINDS: readonly OpeningKind[] = ['window', 'windowway'];
const OPENING_NAMES: Record<OpeningKind, string> = {
  door: 'Дверь',
  door_double: 'Двустворчатая дверь',
  doorway: 'Проём без двери',
  window: 'Окно',
  windowway: 'Окно без рамы',
};

/** Чьи параметры показывает панель: активного инструмента (tool) или выделенного проёма (tool = null). */
function openingPanelTarget(): { options: OpeningOptions; tool: OpeningToolMode | null } | null {
  const mode = canvas.getMode();
  if (mode === 'place-window' || mode === 'place-door') {
    return { options: canvas.getOpeningTool(mode), tool: mode };
  }
  const selected = mode === 'select' ? canvas.getSelectedOpening() : null;
  return selected ? { options: selected, tool: null } : null;
}

function renderOpeningSettings(options: OpeningOptions, tool: OpeningToolMode | null): void {
  const isWindow = WINDOW_KINDS.includes(options.kind);
  const limits = OPENING_DEFAULTS[options.kind];
  openingTitle.textContent = tool ? 'Ставим: ' + OPENING_NAMES[options.kind].toLowerCase() : OPENING_NAMES[options.kind];
  openingKindButtons.forEach((button) => {
    const kind = button.dataset.kind as OpeningKind;
    button.hidden = WINDOW_KINDS.includes(kind) !== isWindow;
    button.setAttribute('aria-pressed', String(kind === options.kind));
  });
  // Поле, в котором сейчас печатают, не трогаем — текст переписывался бы под курсором.
  const show = (input: HTMLInputElement, value: number): void => {
    if (document.activeElement !== input) input.value = String(Math.round(value));
  };
  show(openingWidthInput, options.width);
  openingWidthInput.min = String(limits.minWidth);
  openingWidthInput.max = String(limits.maxWidth);
  renderWidthPresets(options);
  openingDoorActions.hidden = tool !== null || (options.kind !== 'door' && options.kind !== 'door_double');
}

/** Кнопки стандартных ширин текущего вида; нажата та, что совпадает с шириной. */
function renderWidthPresets(options: OpeningOptions): void {
  const widths = OPENING_WIDTH_PRESETS[options.kind];
  if (openingWidthPresets.dataset.kind !== options.kind) {
    openingWidthPresets.dataset.kind = options.kind;
    openingWidthPresets.replaceChildren(
      ...widths.map((width) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'arm-chip preset-btn';
        button.textContent = String(width);
        button.addEventListener('click', () => applyOpeningPatch({ width }));
        return button;
      }),
    );
  }
  openingWidthPresets.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(Number(button.textContent) === Math.round(options.width)));
  });
}

function applyOpeningPatch(patch: Partial<OpeningOptions>): void {
  const target = openingPanelTarget();
  if (target?.tool) {
    canvas.setOpeningTool(target.tool, patch);
  } else if (target) {
    canvas.updateSelectedOpening(patch);
  }
  refreshSettingsPanel();
}

openingKindButtons.forEach((button) => {
  button.addEventListener('click', () => applyOpeningPatch({ kind: button.dataset.kind as OpeningKind }));
});
// Ширину — по change, как длину стены: промежуточное «8» при наборе «80» не нужно.
// Не прошедшее значение (не влезает в стену, вне пределов) панель вернёт к фактическому.
openingWidthInput.addEventListener('change', () => {
  openingWidthInput.blur();
  applyOpeningPatch({ width: Number(openingWidthInput.value) });
});
$<HTMLButtonElement>('#btn-flip-hinge').addEventListener('click', () => canvas.flipSelectedOpening('hinge'));
$<HTMLButtonElement>('#btn-flip-swing').addEventListener('click', () => canvas.flipSelectedOpening('swing'));

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

// ─── Калибровка подложки ───────────────────────────────────────
// Подложку сначала калибруют: отрезок по известному размеру + его длина,
// иначе картинка не совпала бы по масштабу со стенами (см. calibrateBackground).

const calibrationPanel = new CalibrationPanel({
  onApply: (lengthCm) => {
    if (!canvas.applyBackgroundCalibration(lengthCm)) return;
    calibrationPanel.hide();
    setTool('select');
    showStatus('Подложка откалибрована', false);
  },
  onRedraw: () => {
    canvas.redrawCalibrationLine();
    calibrationPanel.showDraw();
  },
  onCancel: () => {
    canvas.cancelBackgroundCalibration();
    calibrationPanel.hide();
    setTool('select');
  },
});
document.body.append(calibrationPanel.element);
canvas.setOnCalibrationLine(() => calibrationPanel.showLength());

function refreshBackgroundMenu(): void {
  backgroundMenu.render({
    has: canvas.hasBackground(),
    visible: canvas.isBackgroundVisible(),
    opacity: canvas.getBackgroundOpacity(),
    moving: canvas.getMode() === 'move-background',
  });
}

const backgroundMenu = new BackgroundMenu({
  onLoad: (file) => {
    canvas.calibrateBackground(URL.createObjectURL(file));
    setTool('calibrate');
    calibrationPanel.showDraw();
  },
  onCalibrate: () => {
    if (!canvas.recalibrateBackground()) return;
    setTool('calibrate');
    calibrationPanel.showDraw();
  },
  onMoveToggle: () => setTool(canvas.getMode() === 'move-background' ? 'select' : 'move-background'),
  onVisibleToggle: () => {
    canvas.setBackgroundVisible(!canvas.isBackgroundVisible());
    refreshBackgroundMenu();
  },
  onOpacity: (opacity) => canvas.setBackgroundOpacity(opacity),
  onRemove: () => {
    canvas.removeBackground();
    setTool('select');
  },
});
backgroundMenuHost.replaceChildren(backgroundMenu.element);

// ─── Этажи ─────────────────────────────────────────────────────
// На холсте всегда один этаж; сцены остальных лежат в floors и подставляются
// при переключении. Сцена текущего этажа в floors может отставать от холста —
// collectPlan() снимает её заново перед сохранением и переключением.

const newFloor = (name: string, scene: SceneData = emptyScene()): PlanFloor => ({
  id: generateId('floor'),
  name,
  scene,
});

let floors: PlanFloor[] = [newFloor(floorName(1))];
let currentFloorId = floors[0].id;
// У каждого этажа своя история отмены (см. FloorPlanCanvas.showFloor).
const floorHistory = new Map<string, SceneData[]>();
let showLowerSilhouette = false;

function collectPlan(): PlanData {
  const current = floors.find((floor) => floor.id === currentFloorId);
  if (current) current.scene = canvas.serialize();
  return { floors };
}

const isEmptyFloor = (floor: PlanFloor): boolean =>
  floor.scene.nodes.length === 0 && floor.scene.workspaces.length === 0;

function renderFloors(): void {
  collectPlan();
  floorPicker.render(
    floors.map((floor) => ({ id: floor.id, name: floor.name, removable: floors.length > 1 && isEmptyFloor(floor) })),
    currentFloorId,
  );
}

/** Нижний этаж — предыдущий в списке; его силуэт фоном, если включено. */
function applyUnderlay(): void {
  const index = floors.findIndex((floor) => floor.id === currentFloorId);
  canvas.setUnderlay(showLowerSilhouette && index > 0 ? floors[index - 1].scene : null);
}

function showFloor(floorId: string): void {
  const next = floors.find((floor) => floor.id === floorId);
  if (!next || floorId === currentFloorId) return;
  collectPlan();
  floorHistory.set(currentFloorId, canvas.getHistory());
  currentFloorId = floorId;
  // Вид не сбрасываем: этажи одного здания совпадают в плане.
  canvas.showFloor(next.scene, floorHistory.get(floorId) ?? []);
  applyUnderlay();
  selectedWall = null;
  refreshSettingsPanel();
  renderFloors();
}

/** Открытый или новый план: первый этаж на холсте, истории отмены — с нуля. */
function setPlan(plan: PlanData): void {
  floors = plan.floors.length > 0 ? plan.floors : [newFloor(floorName(1))];
  floorHistory.clear();
  currentFloorId = floors[0].id;
  canvas.showFloor(floors[0].scene);
  applyUnderlay();
  renderFloors();
}

/**
 * Новый этаж — пустой или копия текущего. У скопированных столов подписи
 * «АРМ N» продолжают нумерацию плана: два «АРМ 1» на разных этажах
 * путались бы в учёте.
 */
function createFloor(number: number, copy: FloorCopyMode | null): void {
  const current = collectPlan().floors.find((floor) => floor.id === currentFloorId);
  const scene = copy && current ? copyFloorScene(current.scene, copy, generateId) : emptyScene();
  let deskNumber = nextDeskNumber();
  scene.workspaces = scene.workspaces.map((workspace) =>
    /^АРМ \d+$/.test(workspace.label) ? { ...workspace, label: 'АРМ ' + deskNumber++ } : workspace,
  );
  const floor = newFloor(floorName(number), scene);
  // Список идёт снизу вверх — «нижний этаж» для силуэта это предыдущий в нём.
  floors.splice(floorInsertIndex(floors.map((f) => f.name), number), 0, floor);
  showFloor(floor.id);
}

const floorPicker = new FloorPicker({
  onSelect: showFloor,
  onCreate: createFloor,
  onRemove: (floorId) => {
    const index = floors.findIndex((floor) => floor.id === floorId);
    if (index < 0 || floors.length < 2 || !isEmptyFloor(collectPlan().floors[index])) return;
    floors.splice(index, 1);
    floorHistory.delete(floorId);
    const next = floors[Math.max(0, index - 1)];
    currentFloorId = next.id;
    canvas.showFloor(next.scene, floorHistory.get(next.id) ?? []);
    applyUnderlay();
    selectedWall = null;
    refreshSettingsPanel();
    renderFloors();
  },
  onZoom: (direction) => canvas.zoomBy(direction),
  onSilhouette: (visible) => {
    showLowerSilhouette = visible;
    collectPlan();
    applyUnderlay();
  },
});
floorPickerHost.replaceChildren(floorPicker.element);
renderFloors();
// «Удалить» доступно только у пустого этажа — сверяемся после правок на холсте.
canvasContainer.addEventListener('mouseup', () => window.setTimeout(renderFloors, 0));

// ─── Нижняя панель ─────────────────────────────────────────────

undoBtn.addEventListener('click', () => {
  canvas.undo();
  refreshSettingsPanel();
});
redoBtn.addEventListener('click', () => {
  canvas.redo();
  refreshSettingsPanel();
});
const refreshHistoryButtons = (): void => {
  undoBtn.disabled = !canvas.canUndo();
  redoBtn.disabled = !canvas.canRedo();
};
canvas.setOnHistoryChange(refreshHistoryButtons);
refreshHistoryButtons();
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
    const id = await saveFloorPlan(collectPlan(), currentFloorPlanId, name);
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
    setPlan(await loadFloorPlan(planId));
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
  setPlan({ floors: [] });
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

  const mode = canvas.getMode();
  if ((mode === 'calibrate' || mode === 'move-background') && event.key === 'Escape') {
    setTool('select');
    return;
  }
  if (mode === 'place-stairs' || mode === 'place-elevator') {
    if (event.code === 'KeyR') {
      canvas.rotateFixtureGhost();
      return;
    }
    if (event.key === 'Escape') {
      setTool('select');
      return;
    }
  }
  if ((mode === 'place-window' || mode === 'place-door') && event.key === 'Escape') {
    setTool('select');
    return;
  }

  if (mode === 'place-desk') {
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
  // Повтор — Ctrl+Y или Ctrl+Shift+Z, как в большинстве редакторов.
  if ((event.ctrlKey || event.metaKey) && (event.code === 'KeyY' || (event.code === 'KeyZ' && event.shiftKey))) {
    event.preventDefault();
    canvas.redo();
    refreshSettingsPanel();
    return;
  }
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
