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

thicknessInput.addEventListener('change', () => {
  const value = Number(thicknessInput.value);
  if (Number.isFinite(value)) {
    canvas.setWallThickness(value);
  }
});

planInput.addEventListener('change', () => {
  const file = planInput.files?.[0];
  if (!file) {
    return;
  }
  const url = URL.createObjectURL(file);
  canvas.loadBackgroundPlan(url);
});
