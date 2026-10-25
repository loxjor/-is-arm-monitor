// Единственный источник цветов для Konva: холст не видит CSS, поэтому значения
// токенов (styles/tokens.css) читаются из вычисленных стилей <html> и
// перечитываются при смене темы.

const COLOR_TOKENS = [
  'ground',
  'ground-deep',
  'surface',
  'surface-glass',
  'sky',
  'ink',
  'on-ink',
  'ink-muted',
  'ink-faint',
  'line',
  'line-strong',
  'accent',
  'on-accent',
  'status-free',
  'status-occupied',
  'status-reserved',
  'focus',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type ThemePalette = Record<ColorToken, string> & { fontSans: string; radiusMd: number };
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'arm-monitor.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

let cached: ThemePalette | null = null;
const listeners = new Set<() => void>();
let watching = false;

export function palette(): ThemePalette {
  if (cached) return cached;
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const colors = Object.fromEntries(COLOR_TOKENS.map((token) => [token, read(token)])) as Record<ColorToken, string>;
  cached = { ...colors, fontSans: read('font-sans'), radiusMd: parseFloat(read('radius-md')) || 0 };
  return cached;
}

/** Цвет токена с дополнительной прозрачностью — для полупрозрачных заливок на плане. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgba = /^rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)$/.exec(color.replace(/\s/g, ''));
  if (rgba) {
    const base = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${base * alpha})`;
  }
  return color;
}

function notify(): void {
  cached = null;
  listeners.forEach((listener) => listener());
}

/** Подписка на смену темы (системной или ручной) и на загрузку шрифта; возвращает отписку. */
export function onThemeChange(listener: () => void): () => void {
  if (!watching) {
    watching = true;
    window.matchMedia(DARK_QUERY).addEventListener('change', notify);
    new MutationObserver(notify).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // Konva меряет текст при отрисовке: после подгрузки Golos Text подписи надо перерисовать.
    void document.fonts?.ready.then(notify);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function storedTheme(): ThemeMode | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

/** Ручной выбор темы (если он был) — до первой отрисовки, чтобы не мигало. */
export function initTheme(): void {
  const stored = storedTheme();
  if (stored) document.documentElement.dataset.theme = stored;
}

export function currentTheme(): ThemeMode {
  const explicit = document.documentElement.dataset.theme;
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

export function setTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // без хранилища тема просто не запомнится
  }
}

export function toggleTheme(): ThemeMode {
  const next: ThemeMode = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
