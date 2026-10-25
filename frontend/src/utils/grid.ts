import { palette, withAlpha } from '../theme';

const cachedTiles = new Map<string, HTMLImageElement>();

export const GRID_MINOR_SPACING_PX = 40;
export const GRID_MAJOR_EVERY = 5;

/**
 * Тайл мелкой сетки (линии по правому/нижнему краю тайла — стандартный
 * приём для бесшовного fillPatternRepeat). Крупная сетка рисуется поверх
 * отдельными Konva.Line, т.к. тайлом с двумя видами линий получить чистый
 * бесшовный стык сложнее.
 */
export function getGridTilePattern(): HTMLImageElement {
  // Мелкая сетка — вполовину слабее волосяной линии line; кэш по цвету, т.к. он зависит от темы.
  const color = withAlpha(palette().line, 0.5);
  const cached = cachedTiles.get(color);
  if (cached) {
    return cached;
  }

  const size = GRID_MINOR_SPACING_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.stroke();
  }

  const tile = canvas as unknown as HTMLImageElement;
  cachedTiles.set(color, tile);
  return tile;
}
