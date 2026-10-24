import './admin.css';

import { setUnauthorizedHandler } from './api/client';
import type { Permission } from './api/types';
import { can, currentUser, logout, restoreSession } from './auth';
import { AuditLogScreen } from './screens/AuditLogScreen';
import { CatalogScreen } from './screens/CatalogScreen';
import { CATALOG_DEFS } from './screens/catalogDefs';
import { DashboardScreen } from './screens/DashboardScreen';
import { EquipmentCardScreen } from './screens/EquipmentCardScreen';
import { EquipmentListScreen } from './screens/EquipmentListScreen';
import { LoginScreen } from './screens/LoginScreen';
import { MapScreen } from './screens/MapScreen';
import { NewTicketScreen } from './screens/NewTicketScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { TicketCardScreen } from './screens/TicketCardScreen';
import { TicketListScreen } from './screens/TicketListScreen';
import { UsersScreen } from './screens/UsersScreen';
import type { RouteContext, Screen } from './screens/Screen';
import { h } from './ui/dom';
import { toast } from './ui/toast';

interface Route {
  pattern: RegExp;
  permission?: Permission;
  create: (context: RouteContext) => Screen;
}

/** Сотрудник (видит только своё) работает «от себя»: старт с профиля, без справочников. */
function isPersonalView(): boolean {
  return currentUser().scope === 'own';
}

const ROUTES: Route[] = [
  { pattern: /^\/$/, create: () => (isPersonalView() ? new ProfileScreen() : new DashboardScreen()) },
  { pattern: /^\/profile$/, create: () => new ProfileScreen() },
  { pattern: /^\/equipment$/, create: (context) => new EquipmentListScreen(context) },
  { pattern: /^\/equipment\/(\d+)$/, create: (context) => new EquipmentCardScreen(context) },
  { pattern: /^\/tickets$/, create: (context) => new TicketListScreen(context) },
  { pattern: /^\/tickets\/new$/, permission: 'create_tickets', create: (context) => new NewTicketScreen(context) },
  { pattern: /^\/tickets\/(\d+)$/, create: (context) => new TicketCardScreen(context) },
  { pattern: /^\/map$/, create: (context) => new MapScreen(context) },
  ...CATALOG_DEFS.map((def) => ({ pattern: new RegExp(`^/catalogs/${def.path}$`), permission: 'view_catalogs' as const, create: () => new CatalogScreen(def) })),
  { pattern: /^\/users$/, permission: 'manage_users', create: () => new UsersScreen() },
  { pattern: /^\/audit-log$/, permission: 'view_audit_log', create: () => new AuditLogScreen() },
];

interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
}

function navSections(): { title: string | null; items: NavItem[] }[] {
  const personal = isPersonalView();
  return [
    {
      title: null,
      items: [
        ...(personal ? [] : [{ href: '#/', label: 'Главная' }]),
        { href: '#/profile', label: 'Мой профиль' },
        { href: '#/equipment', label: personal ? 'Моя техника' : 'Реестр оборудования' },
        { href: '#/tickets', label: personal ? 'Мои заявки' : 'Заявки' },
        { href: '#/tickets/new', label: 'Новая заявка', permission: 'create_tickets' },
        { href: '#/map', label: 'Карта этажа' },
      ],
    },
    // Справочники — рабочий инструмент тех, кто видит весь парк; сотруднику и руководителю подразделения не нужны.
    ...(currentUser().scope === 'all' && can('view_catalogs')
      ? [{ title: 'Справочники', items: CATALOG_DEFS.map((def) => ({ href: `#/catalogs/${def.path}`, label: def.title })) }]
      : []),
    {
      title: 'Администрирование',
      items: [
        { href: '#/users', label: 'Пользователи', permission: 'manage_users' },
        { href: '#/audit-log', label: 'Журнал действий', permission: 'view_audit_log' },
      ],
    },
  ];
}

const root = document.getElementById('admin-root')!;
let current: Screen | null = null;
let contentArea: HTMLElement | null = null;
let navLinks: HTMLAnchorElement[] = [];

function showLogin(): void {
  current?.destroy?.();
  current = null;
  contentArea = null;
  document.title = 'Вход — АРМ-Монитор';
  root.replaceChildren(new LoginScreen(() => showShell()).element);
}

function showShell(): void {
  const user = currentUser();
  navLinks = [];
  const nav = h('nav', { class: 'nav', 'aria-label': 'Разделы' });
  for (const section of navSections()) {
    const items = section.items.filter((item) => !item.permission || can(item.permission));
    if (items.length === 0) continue;
    if (section.title) nav.append(h('div', { class: 'nav-title' }, section.title));
    for (const item of items) {
      const link = h('a', { href: item.href, class: 'nav-link' }, item.label);
      navLinks.push(link);
      nav.append(link);
    }
  }

  contentArea = h('main', { class: 'content' });
  root.replaceChildren(
    h('div', { class: 'shell' },
      h('aside', { class: 'sidebar' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo' }, 'АРМ'), 'АРМ-Монитор'),
        nav,
      ),
      h('div', { class: 'main-col' },
        h('header', { class: 'topbar' },
          h('span', { class: 'muted' }, 'Отделение СФР по г. Москве и Московской области'),
          h('div', { class: 'user' },
            h('div', null, h('strong', null, user.employee.full_name), h('div', { class: 'muted small' }, user.role.name)),
            h('button', {
              type: 'button', class: 'btn btn--plain btn--small',
              onclick: () => {
                logout();
                location.hash = '#/';
                showLogin();
              },
            }, 'Выйти'),
          ),
        ),
        contentArea,
      ),
    ),
  );
  route();
}

function route(): void {
  if (!contentArea) return;
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = raw.split('?');
  const match = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m !== null);

  current?.destroy?.();
  let screen: Screen;
  if (!match) {
    screen = { title: 'Не найдено', element: h('div', null, h('h1', null, 'Страница не найдена'), h('a', { href: '#/' }, 'На главную')) };
  } else if (match.r.permission && !can(match.r.permission)) {
    screen = { title: 'Нет доступа', element: h('div', null, h('h1', null, 'Недостаточно прав'), h('p', { class: 'muted' }, 'Раздел недоступен для вашей роли.')) };
  } else {
    screen = match.r.create({ params: match.m!.slice(1), query: new URLSearchParams(queryString) });
  }
  current = screen;
  contentArea.replaceChildren(screen.element);
  document.title = `${screen.title} — АРМ-Монитор`;

  // Подсвечивается самый точный пункт: на /tickets/new — «Новая заявка», а не ещё и «Заявки».
  const effectivePath = path === '/' && isPersonalView() ? '/profile' : path;
  const matches = (target: string) =>
    target === '/' ? effectivePath === '/' : effectivePath === target || effectivePath.startsWith(`${target}/`);
  const best = navLinks
    .map((link) => link.getAttribute('href')!.slice(1))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  for (const link of navLinks) {
    const active = link.getAttribute('href')!.slice(1) === best;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

setUnauthorizedHandler(() => {
  logout();
  toast('Сессия завершена — войдите снова', 'error');
  showLogin();
});
window.addEventListener('hashchange', route);

void restoreSession().then((user) => (user ? showShell() : showLogin()));
