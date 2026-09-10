/**
 * Курс перевода между единицами домена (сантиметры — то, что видит и вводит
 * пользователь, и то, что в итоге должно уходить на бэкенд) и экранными
 * пикселями Konva-сцены. В px переводим только на границе рендеринга.
 */
export const PIXELS_PER_CM = 2;

export function cmToPx(cm: number): number {
  return cm * PIXELS_PER_CM;
}

export function pxToCm(px: number): number {
  return px / PIXELS_PER_CM;
}
