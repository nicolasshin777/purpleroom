import { renderDashboard } from './dashboard.js';
import * as util from './util.js';
import * as store from './store.js';
import * as sources from './sources.js';
import * as shapes from './shapes.js';
import * as versions from './versions.js';
import * as data from './data.js';
import * as shell from './shell.js';
import * as cloud from './cloud.js';

const { getProject, subscribe } = store, { toast } = util, { mountShell } = shell, { crm } = data;

// Общие модули — для частей CRM, которые лежат на соседних сайтах (review и разделы канала)
window.SPO = { util, store, sources, shapes, versions, data, shell, cloud };
const CDN = window.SPO_CDN;
const scripts = {};
const loadScript = src => scripts[src] ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = src;
  s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error('Не удалось загрузить часть приложения. Проверьте интернет и обновите страницу.')); };
  document.head.append(s);
});
const reviewMod = () => CDN ? loadScript(`${CDN.review}review.bundle.js?v=${CDN.v}`).then(() => window.SPO_REVIEW) : import('./review.js');
const pageMod = id => CDN ? loadScript(`${CDN.ui}pages.bundle.js?v=${CDN.v}`).then(() => window.SPO_PAGES[id]) : LOCAL[id]();

const app = document.getElementById('app');
let current = null; // { kind, unmount }

// Локальная разработка: разделы как обычные модули
const LOCAL = {
  home: () => import('./overview.js').then(m => m.renderOverview),
  releases: () => import('./releases.js').then(m => m.renderReleases),
  board: () => import('./board.js').then(m => m.renderBoard),
  calendar: () => import('./calendar.js').then(m => m.renderCalendar),
  analytics: () => import('./analytics.js').then(m => m.renderAnalytics),
  settings: () => import('./settings.js').then(m => m.renderSettings),
};
const PAGES = Object.fromEntries(['home', 'releases', 'board', 'calendar', 'analytics', 'settings'].map(id => [id, () => pageMod(id)]));
PAGES.reviews = async () => renderDashboard;

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, q: Object.fromEntries(new URLSearchParams(query)) };
}

export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

let seq = 0;
async function route() {
  if (!cloud.isReady()) return;
  const my = ++seq;
  crm();
  const { parts, q } = parseHash();
  if (parts[0] === 'p' && parts[1]) {
    const p = getProject(parts[1]);
    if (!p) { toast('Проект не найден в этом браузере', 'error'); return go('#/reviews'); }
    if (current?.kind === 'review' && current.projectId === p.id) { current.applyQuery?.(q); return; }
    let mod;
    try { mod = await reviewMod(); } catch (e) { return toast(e.message, 'error'); }
    if (my !== seq) return;
    current?.unmount?.();
    app.innerHTML = '';
    current = { kind: 'review', projectId: p.id, ...mod.mountReview(app, p, q) };
    return;
  }
  const page = PAGES[parts[0]] ? parts[0] : 'home';
  let render;
  try { render = await PAGES[page](); } catch (e) { return toast(e.message, 'error'); }
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

// С общей базой — сначала вход; без неё CRM открывается сразу, как раньше
(async () => {
  if (cloud.cloudOn && !(await cloud.gate(app))) return;
  app.innerHTML = '';
  route();
})();
