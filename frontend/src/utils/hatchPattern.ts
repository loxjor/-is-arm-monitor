import { palette } from '../theme';

const cachedPatterns = new Map<string, HTMLCanvasElement>();

/**
 * Диагональная штриховка для отображения стен на плане (архитектурная
 * конвенция вместо сплошной заливки). Канвас рисуется один раз и
 * переиспользуется как fillPatternImage всеми стенами.
 *
 * Konva типизирует fillPatternImage как HTMLImageElement, хотя рантайм
 * (CanvasRenderingContext2D.createPattern) принимает любой CanvasImageSource,
 * включая HTMLCanvasElement — поэтому тип приводится явно в месте вызова.
 */
export function getWallHatchPattern(): HTMLImageElement {
  // Фон штриховки — ground-deep, штрихи — line-strong; кэш по паре цветов текущей темы.
  const { 'ground-deep': fill, 'line-strong': stroke } = palette();
  const key = `${fill}|${stroke}`;
  const cached = cachedPatterns.get(key);
  if (cached) {
    return cached as unknown as HTMLImageElement;
  }

  const size = 10;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    // Три параллельные диагонали (в т.ч. на краях тайла), чтобы штриховка
    // стыковалась бесшовно при fillPatternRepeat: 'repeat'.
    ctx.beginPath();
    ctx.moveTo(-size / 2, size / 2);
    ctx.lineTo(size / 2, -size / 2);
    ctx.moveTo(0, size);
    ctx.lineTo(size, 0);
    ctx.moveTo(size / 2, size * 1.5);
    ctx.lineTo(size * 1.5, size / 2);
    ctx.stroke();
  }

  cachedPatterns.set(key, canvas);
  return canvas as unknown as HTMLImageElement;
}
