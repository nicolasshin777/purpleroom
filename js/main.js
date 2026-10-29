import { renderDashboard } from './dashboard.js';
import { mountReview } from './review.js';
import { getProject, subscribe } from './store.js';
import { toast } from './util.js';
import { mountShell } from './shell.js';
import { crm } from './data.js';

const app = document.getElementById('app');
let current = null; // { kind, unmount }

// Разделы CRM грузятся по требованию — первый экран открывается быстрее
const PAGES = {
  home: () => import('./overview.js').then(m => m.renderOverview),
  releases: () => import('./releases.js').then(m => m.renderReleases),
  board: () => import('./board.js').then(m => m.renderBoard),
  calendar: () => import('./calendar.js').then(m => m.renderCalendar),
  reviews: async () => renderDashboard,
  analytics: () => import('./analytics.js').then(m => m.renderAnalytics),
  settings: () => import('./settings.js').then(m => m.renderSettings),
};

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, q: Object.fromEntries(new URLSearchParams(query)) };
}

export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

let seq = 0;
async function route() {
  const my = ++seq;
  crm();
  const { parts, q } = parseHash();
  if (parts[0] === 'p' && parts[1]) {
    const p = getProject(parts[1]);
    if (!p) { toast('Проект не найден в этом браузере', 'error'); return go('#/reviews'); }
    if (current?.kind === 'review' && current.projectId === p.id) { current.applyQuery?.(q); return; }
    current?.unmount?.();
    app.innerHTML = '';
    current = { kind: 'review', projectId: p.id, ...mountReview(app, p, q) };
    return;
  }
  const page = PAGES[parts[0]] ? parts[0] : 'home';
  const render = await PAGES[page]();
  if (my !== seq) return;
  current?.unmount?.();
  app.innerHTML = '';
  const shell = mountShell(app, page);
  const view = render(shell.main, { parts: parts.slice(1), q });
  current = { kind: 'page', page, ...view, refresh: () => { shell.redraw(); view.refresh?.(); }, unmount: () => view.unmount?.() };
}

window.addEventListener('hashchange', route);
window.addEventListener('store-error', e => toast(e.detail, 'error'));
subscribe(reason => { if (current?.kind === 'page') { if (reason !== 'quiet') current.refresh?.(); } else current?.onStore?.(reason); });
route();
