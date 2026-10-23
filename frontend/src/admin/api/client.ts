/**
 * HTTP-клиент учётной части. Адрес относительный: в dev-режиме Vite
 * проксирует /api на бэкенд (vite.config.ts), так что CORS не участвует.
 */
const API_BASE = '/api/v1';

export type QueryValue = string | number | boolean | null | undefined;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Ошибки по полям из ответа 422: имя поля → сообщение. */
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface ValidationItem {
  type?: string;
  loc?: (string | number)[];
  msg?: string;
  ctx?: Record<string, unknown>;
}

// Сообщения Pydantic приходят по-английски — переводим частые по коду ошибки.
function translate(item: ValidationItem): string {
  const ctx = item.ctx ?? {};
  switch (item.type) {
    case 'missing':
      return 'обязательное поле';
    case 'string_too_short':
      return ctx.min_length === 1 ? 'обязательное поле' : `не короче ${String(ctx.min_length)} символов`;
    case 'string_too_long':
      return `не длиннее ${String(ctx.max_length)} символов`;
    case 'string_pattern_mismatch':
      return 'неверный формат';
    case 'greater_than_equal':
      return `не меньше ${String(ctx.ge)}`;
    case 'less_than_equal':
      return `не больше ${String(ctx.le)}`;
    case 'int_parsing':
    case 'int_type':
      return 'нужно целое число';
    case 'decimal_parsing':
    case 'float_parsing':
      return 'нужно число';
    case 'decimal_max_places':
      return `не больше ${String(ctx.decimal_places)} знаков после запятой`;
    case 'decimal_max_digits':
      return 'слишком большое число';
    case 'date_from_datetime_parsing':
    case 'date_parsing':
      return 'неверная дата';
    default:
      return item.msg ?? 'неверное значение';
  }
}

async function buildError(response: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    detail = ((await response.json()) as { detail?: unknown }).detail;
  } catch {
    // тело не JSON — обойдёмся сообщением по коду
  }

  if (response.status === 401) {
    return new ApiError(typeof detail === 'string' ? detail : 'Требуется вход в систему', 401);
  }
  if (response.status === 403) {
    return new ApiError('Недостаточно прав для этого действия', 403);
  }
  if (response.status === 422 && Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const item of detail as ValidationItem[]) {
      const field = item.loc?.[item.loc.length - 1];
      if (typeof field === 'string' && !(field in fieldErrors)) {
        fieldErrors[field] = translate(item);
      }
    }
    return new ApiError('Проверьте заполнение полей', 422, fieldErrors);
  }
  if (typeof detail === 'string') {
    return new ApiError(detail, response.status);
  }
  if (response.status === 404) {
    return new ApiError('Не найдено', 404);
  }
  return new ApiError(`Ошибка сервера (HTTP ${response.status})`, response.status);
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: { query?: Record<string, QueryValue>; body?: unknown } = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== null && value !== undefined && value !== '') params.set(key, String(value));
  }
  const queryString = params.toString();
  const url = `${API_BASE}${path}${queryString ? `?${queryString}` : ''}`;

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError('Сервер недоступен', 0);
  }

  if (!response.ok) {
    const error = await buildError(response);
    // 401 на любом запросе, кроме самого входа, — сессия истекла или пользователя заблокировали.
    if (error.status === 401 && token) onUnauthorized?.();
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>('GET', path, { query }),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  delete: (path: string) => request<void>('DELETE', path),
};
