import '../styles/tokens.css';
import '../styles/components.css';
import '../styles/base.css';
import './admin.css';

import { Button, Chip, TreeNav, captureLayout, slideFrom, type TreeNavGroup } from '../design/components';
import { currentTheme, initTheme, onThemeChange, setTheme } from '../theme';
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
import { MyEquipmentScreen } from './screens/MyEquipmentScreen';
import { NewTicketScreen } from './screens/NewTicketScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SchemasScreen } from './screens/SchemasScreen';
import { TicketCardScreen } from './screens/TicketCardScreen';
import { TicketListScreen } from './screens/TicketListScreen';
import { UsersScreen } from './screens/UsersScreen';
import type { RouteContext, Screen } from './screens/Screen';
import { h } from './ui/dom';
import { toast } from './ui/toast';

initTheme();

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
  // Главная у всех — «Мой профиль»; сводка по парку — отдельная вкладка.
  { pattern: /^\/$/, create: () => new ProfileScreen() },
  { pattern: /^\/profile$/, create: () => new ProfileScreen() },
  { pattern: /^\/summary$/, create: () => new DashboardScreen() },
  { pattern: /^\/my-equipment$/, create: (context) => new MyEquipmentScreen(context) },
  { pattern: /^\/equipment$/, create: (context) => new EquipmentListScreen(context) },
  { pattern: /^\/equipment\/(\d+)$/, create: (context) => new EquipmentCardScreen(context) },
  { pattern: /^\/tickets$/, create: (context) => new TicketListScreen(context) },
  { pattern: /^\/tickets\/new$/, permission: 'create_tickets', create: (context) => new NewTicketScreen(context) },
  { pattern: /^\/tickets\/(\d+)$/, create: (context) => new TicketCardScreen(context) },
  { pattern: /^\/map$/, create: (context) => new MapScreen(context) },
  { pattern: /^\/schemas$/, permission: 'edit_floor_plans', create: (context) => new SchemasScreen(context) },
  { pattern: /^\/catalogs$/, permission: 'view_catalogs', create: () => new CatalogScreen(CATALOG_DEFS[0]) },
  ...CATALOG_DEFS.map((def) => ({ pattern: new RegExp(`^/catalogs/${def.path}$`), permission: 'view_catalogs' as const, create: () => new CatalogScreen(def) })),
  { pattern: /^\/users$/, permission: 'manage_users', create: () => new UsersScreen() },
  { pattern: /^\/audit-log$/, permission: 'view_audit_log', create: () => new AuditLogScreen() },
];

interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
}

/** Группы дерева навигации — по разделам приложения и с учётом прав роли. */
function navGroups(): TreeNavGroup[] {
  const personal = isPersonalView();
  const groups: { title: string; items: NavItem[]; href?: string }[] = [
    {
      title: 'Кабинет',
      items: [
        { href: '#/profile', label: 'Мой профиль' },
        { href: '#/my-equipment', label: 'Моё имущество' },
        ...(personal ? [] : [{ href: '#/summary', label: 'Сводка' }]),
        { href: '#/tickets/new', label: 'Новая заявка', permission: 'create_tickets' },
      ],
    },
    // Карта территорий — самостоятельный пункт на уровне групп, без подпунктов.
    { title: 'Карта', href: '#/map', items: [] },
    {
      title: 'Учёт',
      items: [
        // Сотруднику реестр не нужен: всё его — в «Моём имуществе».
        ...(personal ? [] : [{ href: '#/equipment', label: 'Реестр оборудования' }]),
        { href: '#/tickets', label: personal ? 'Мои заявки' : 'Заявки' },
        { href: '#/schemas', label: 'Редактор схем', permission: 'edit_floor_plans' },
        // Справочники — одним пунктом; рабочий инструмент тех, кто видит весь парк,
        // сотруднику и руководителю подразделения не нужны.
        ...(currentUser().scope === 'all' ? [{ href: '#/catalogs', label: 'Справочники', permission: 'view_catalogs' as const }] : []),
      ],
    },
    {
      title: 'Администрирование',
      items: [
        { href: '#/users', label: 'Пользователи', permission: 'manage_users' },
        { href: '#/audit-log', label: 'Журнал действий', permission: 'view_audit_log' },
      ],
    },
  ];
  return groups
    .map((group) => ({
      title: group.title,
      href: group.href,
      links: group.items.filter((item) => !item.permission || can(item.permission)).map(({ href, label }) => ({ href, label })),
    }))
    .filter((group) => group.href || group.links.length > 0);
}

const root = document.getElementById('admin-root')!;
let current: Screen | null = null;
let contentArea: HTMLElement | null = null;
let shell: HTMLElement | null = null;
let tree: TreeNav | null = null;

function showLogin(): void {
  current?.destroy?.();
  current = null;
  contentArea = null;
  shell = null;
  tree = null;
  document.title = 'Вход — АРМ Монитор';
  root.replaceChildren(new LoginScreen(() => showShell()).element);
}

function themeChip(): HTMLButtonElement {
  const chip = Chip('Тёмная тема', currentTheme() === 'dark');
  chip.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'));
  onThemeChange(() => chip.setAttribute('aria-pressed', String(currentTheme() === 'dark')));
  return chip;
}

function showShell(): void {
  const user = currentUser();
  // Меню открывает и сворачивает сам знак «АРМ Монитор». На телефоне меню
  // стартует свёрнутым, на широком экране — как оставили в прошлый раз.
  // Свёрнутое меню — знак в шапке перед названием отделения; по нажатию он
  // отъезжает влево к корню дерева, а контент сдвигается, открывая панель.
  const brandSlot = h('div', { class: 'brand-slot' });
  let mainBefore: DOMRect | null = null;
  let settleBlocks: () => void = () => undefined;
  const mainCol = h('div', { class: 'main-col' });
  tree = new TreeNav('АРМ Монитор', navGroups(), {
    collapsed: narrowScreen.matches || readNavCollapsed(),
    collapsedSlot: brandSlot,
    // Снимок до того, как знак уйдёт из шапки или придёт в неё: иначе сдвиг
    // надписи отделения рядом со знаком не попал бы в анимацию.
    onBeforeToggle: () => {
      mainBefore = mainCol.getBoundingClientRect();
      settleBlocks = captureLayout(mainCol, REFLOWING_BLOCKS);
    },
    onToggle: (collapsed) => {
      // Колонка меняет ширину — блоки внутри перестраиваются; пусть доезжают плавно, а не прыгают.
      shell?.classList.toggle('nav-collapsed', collapsed);
      settleBlocks();
      if (mainBefore) slideFrom(mainCol, mainBefore);
      if (!narrowScreen.matches) saveNavCollapsed(collapsed);
    },
  });
  contentArea = h('main', { class: 'content', id: 'content' });

  shell = h('div', { class: `shell${tree.collapsed ? ' nav-collapsed' : ''}` },
    h('aside', { class: 'sidebar' }, tree.element),
    mainCol,
  );
  mainCol.append(
    h('header', { class: 'topbar' },
      h('div', { class: 'org-line' },
        brandSlot,
        h('span', { class: 'muted t-caption org' }, 'Отделение СФР по г. Москве и Московской области'),
      ),
      h('div', { class: 'user' },
        h('div', null, h('div', { class: 't-heading' }, user.employee.full_name), h('div', { class: 'muted t-caption' }, user.role.name)),
        themeChip(),
        Button('Выйти', {
          variant: 'light',
          onClick: () => {
            logout();
            location.hash = '#/';
            showLogin();
          },
        }),
      ),
    ),
    contentArea,
  );
  root.replaceChildren(shell);
  route();
}

// Блоки контента, которые перестраиваются при смене ширины колонки. Сам знак
// в шапке не входит — его анимирует TreeNav, а надпись отделения рядом с ним
// входит. Ряды (шапка страницы, фильтры) берутся поэлементно — у них прижатые
// вправо кнопки сдвигаются внутри ряда.
const REFLOWING_BLOCKS = [
  '.org-line > .org', '.topbar > .user', '.back', '.page-head > *', '.profile-head', '.filters > *',
  '.spec-row > *', '.tiles > *', '.quick-links > *', '.cards > *', '.card',
  '.equipment-cards > *', '.map-wrap', '.territory-explorer', '.table-wrap', '.pager > *',
].join(', ');

// Свёрнутое меню на широком экране запоминается (только в этом браузере).
const narrowScreen = window.matchMedia('(max-width: 860px)');
const NAV_COLLAPSED_KEY = 'arm-monitor.nav-collapsed';

function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveNavCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // без хранилища состояние просто не запомнится
  }
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
  document.title = `${screen.title} — АРМ Монитор`;
  // На телефоне меню закрывается после перехода — иначе оно заслоняет открытый раздел.
  if (narrowScreen.matches && tree && !tree.collapsed) {
    tree.setCollapsed(true);
    shell?.classList.add('nav-collapsed');
  }

  // Подсвечивается самый точный пункт: на /tickets/new — «Новая заявка», а не ещё и «Заявки».
  const effectivePath = path === '/' ? '/profile' : path;
  const matches = (target: string) => effectivePath === target || effectivePath.startsWith(`${target}/`);
  const best = (tree?.links ?? [])
    .map((link) => link.getAttribute('href')!)
    .filter((href) => href.startsWith('#') && matches(href.slice(1)))
    .sort((a, b) => b.length - a.length)[0];
  tree?.setCurrent(best ?? null);
}

setUnauthorizedHandler(() => {
  logout();
  toast('Сессия завершена — войдите снова', 'error');
  showLogin();
});
window.addEventListener('hashchange', route);

void restoreSession().then((user) => (user ? showShell() : showLogin()));
