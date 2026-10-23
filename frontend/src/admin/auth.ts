import { api, setToken } from './api/client';
import type { CurrentUser, Permission, TokenResponse } from './api/types';

const STORAGE_KEY = 'arm-monitor.session';

interface Session {
  token: string;
  user: CurrentUser;
}

let session: Session | null = null;

function save(): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage может быть недоступен (приватный режим) — сессия живёт до перезагрузки
  }
}

/** Восстанавливает сессию и сверяет её с сервером: права могли поменяться. */
export async function restoreSession(): Promise<CurrentUser | null> {
  let stored: Session | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    stored = null;
  }
  if (!stored) return null;

  setToken(stored.token);
  try {
    const user = await api.get<CurrentUser>('/auth/me');
    session = { token: stored.token, user };
    save();
    return user;
  } catch {
    logout();
    return null;
  }
}

export async function login(loginName: string, password: string): Promise<CurrentUser> {
  const response = await api.post<TokenResponse>('/auth/login', { login: loginName, password });
  session = { token: response.access_token, user: response.user };
  setToken(response.access_token);
  save();
  return response.user;
}

export function logout(): void {
  session = null;
  setToken(null);
  save();
}

export function currentUser(): CurrentUser {
  if (!session) throw new Error('Нет активной сессии');
  return session.user;
}

export function can(permission: Permission): boolean {
  return session?.user.permissions.includes(permission) ?? false;
}
