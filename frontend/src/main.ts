import './styles.css';
import { FloorPlanCanvas } from './components/FloorPlanCanvas';
import { cm } from './utils/scale';
import type { WorkspaceStatus } from './types/workspace';

// #app больше не на весь экран — тулбар занимает свою полосу в потоке (см.
// styles.css), поэтому размер сцены берём из самого контейнера, а не из
// window.innerWidth/innerHeight (иначе сцена стартует шире/выше реального
// места и обрезается только на первый ResizeObserver-тик).
const appContainer = document.getElementById('app')!;
const canvas = new FloorPlanCanvas('app', appContainer.clientWidth, appContainer.clientHeight);

// 150×130 см координаты дают ту же экранную позицию, что и раньше (300,260 px
// при PIXELS_PER_CM=2); 120×80 см — правдоподобный размер офисного стола.
canvas.addWorkspace({
  id: 'ws-1',
  x: cm(150),
  y: cm(130),
  width: cm(120),
  height: cm(80),
  rotation: 0,
  label: 'Стол №1',
  status: 'free',
});

const selectBtn = document.querySelector<HTMLButtonElement>('#btn-select')!;
const drawWallBtn = document.querySelector<HTMLButtonElement>('#btn-draw-wall')!;
const planInput = document.querySelector<HTMLInputElement>('#input-plan')!;
const thicknessInput = document.querySelector<HTMLInputElement>('#input-thickness')!;
const scaleReadout = document.querySelector<HTMLSpanElement>('#scale-readout')!;
const resetViewBtn = document.querySelector<HTMLButtonElement>('#btn-reset-view')!;
const statusButtons: Array<[HTMLButtonElement, WorkspaceStatus]> = [
  [document.querySelector<HTMLButtonElement>('#btn-status-free')!, 'free'],
  [document.querySelector<HTMLButtonElement>('#btn-status-occupied')!, 'occupied'],
  [document.querySelector<HTMLButtonElement>('#btn-status-reserved')!, 'reserved'],
];

function setActiveButton(active: HTMLButtonElement): void {
  [selectBtn, drawWallBtn].forEach((btn) => btn.classList.toggle('active', btn === active));
}

selectBtn.addEventListener('click', () => {
  canvas.setMode('select');
  setActiveButton(selectBtn);
});

drawWallBtn.addEventListener('click', () => {
  canvas.setMode('draw-wall');
  setActiveButton(drawWallBtn);
});

// На input применяем значение сразу (по мере ввода), но НЕ переписываем
// поле — иначе при наборе "10" уже после первого "1" (обрезка в допустимый
// диапазон не меняет однозначные числа, но в общем случае могла бы) поле
// переписалось бы под курсором, и двузначные значения стало бы невозможно
// набрать. Нормализация видимого текста — только на change/blur, когда
// пользователь закончил ввод: 500 → 60 ровно так, как ожидает S11.
thicknessInput.addEventListener('input', () => {
  const value = Number(thicknessInput.value);
  if (Number.isFinite(value)) {
    canvas.setWallThickness(value);
  }
});

thicknessInput.addEventListener('change', () => {
  thicknessInput.value = String(canvas.getWallThickness());
});

planInput.addEventListener('change', () => {
  const file = planInput.files?.[0];
  if (!file) {
    return;
  }
  const url = URL.createObjectURL(file);
  canvas.loadBackgroundPlan(url);
});

canvas.setOnScaleChange((scale) => {
  scaleReadout.textContent = `Масштаб: ${Math.round(scale * 100)}%`;
});

resetViewBtn.addEventListener('click', () => {
  canvas.resetView();
});

statusButtons.forEach(([button, status]) => {
  button.addEventListener('click', () => {
    canvas.setSelectedWorkspaceStatus(status);
  });
});

function isTypingInField(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
}

window.addEventListener('keydown', (event) => {
  if (isTypingInField()) {
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    canvas.removeSelected();
    return;
  }

  // event.key зависит от раскладки — при русской раскладке Ctrl+Z даёт
  // key: 'я', а не 'z'. event.code — это физическая клавиша на клавиатуре,
  // от раскладки не зависит. metaKey — тот же жест на macOS (⌘Z).
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    event.preventDefault();
    canvas.undo();
  }
});
