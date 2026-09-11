import './styles.css';
import { FloorPlanCanvas } from './components/FloorPlanCanvas';

const canvas = new FloorPlanCanvas('app', window.innerWidth, window.innerHeight);

canvas.addWorkspace({
  id: 'ws-1',
  x: 300,
  y: 260,
  width: 120,
  height: 80,
  rotation: 0,
  label: 'Стол №1',
  status: 'free',
});

const selectBtn = document.querySelector<HTMLButtonElement>('#btn-select')!;
const drawWallBtn = document.querySelector<HTMLButtonElement>('#btn-draw-wall')!;
const planInput = document.querySelector<HTMLInputElement>('#input-plan')!;
const thicknessInput = document.querySelector<HTMLInputElement>('#input-thickness')!;
const scaleReadout = document.querySelector<HTMLSpanElement>('#scale-readout')!;

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

  if (event.ctrlKey && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    canvas.undo();
  }
});
