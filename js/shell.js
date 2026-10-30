// Оболочка CRM: боковое меню и область страницы. Экран ревью открывается без неё — на весь экран.
import { h, fill, icon, logoSvg, initials, themeIcons } from './util.js';
import { toggleTheme } from './theme.js';
import { me, roleName } from './store.js';
import { openIdentity } from './versions.js';
import { crm, todayStr } from './data.js';

export const NAV = [
  { id: 'home', name: 'Обзор', icon: 'home' },
  { id: 'releases', name: 'Выпуски', icon: 'rocket' },
  { id: 'board', name: 'Задачи', icon: 'kanban' },
  { id: 'calendar', name: 'Календарь', icon: 'calendar' },
  { id: 'reviews', name: 'Правки', icon: 'video' },
  { id: 'analytics', name: 'Аналитика', icon: 'chart' },
  { id: 'settings', name: 'Настройки', icon: 'gear' },
];

/** Рисует меню и возвращает контейнер для страницы */
export function mountShell(root, active) {
  const side = h('nav.side', { 'aria-label': 'Разделы' });
  const main = h('main.main');
  root.append(h('div.shell', side, main));
  const draw = () => {
    const u = me(), s = crm();
    const overdue = s.tasks.filter(t => t.due && t.due < todayStr() && !isDone(t, s)).length;
    const openNotes = s.projects.flatMap(p => p.notes).filter(n => n.status === 'fixed').length;
    const badge = { board: overdue, reviews: openNotes };
    fill(side,
      h('a.side-brand', { href: '#/', html: logoSvg(28) + '<b>СпектрОптик</b>' }),
      h('div.side-nav', NAV.map(n => h('a.side-link' + (n.id === active ? '.on' : ''), { href: n.id === 'home' ? '#/' : `#/${n.id}`, 'aria-current': n.id === active ? 'page' : null },
        h('span', { html: icon(n.icon, 18) }), h('span.lbl', n.name), badge[n.id] ? h('span.side-badge', String(badge[n.id])) : null))),
      h('div.grow'),
      h('div.side-tools',
        h('button.side-who', { onclick: openIdentity, title: 'Сменить пользователя' },
          h('span.avatar', { style: { '--c': u.color } }, initials(u.name)), h('span.lbl', h('b', u.name.split(' ')[0]), h('span', roleName(u.role)))),
        h('button.icon-btn.theme-btn', { onclick: toggleTheme, title: 'Светлая / тёмная тема', 'aria-label': 'Переключить тему', html: themeIcons() })),
    );
  };
  draw();
  return { main, redraw: draw };
}

export const isDone = (t, s = crm()) => s.columns[s.columns.length - 1]?.id === t.col;

/** Заголовок страницы в едином стиле */
export function pageHead(title, sub, ...actions) {
  return h('header.page-head', h('div', h('h1', title), sub ? h('p.page-sub', sub) : null), h('div.page-actions', actions));
}
