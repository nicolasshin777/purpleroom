// Хранилище данных. Сейчас — localStorage этого браузера + синхронизация вкладок.
// Слой написан так, чтобы заменить persist()/load() на Data API layero без правки экранов.
import { uid } from './util.js';

const KEY = 'spectroptik.v4';
try { ['spectroptik.v1', 'spectroptik.v2', 'spectroptik.v3'].forEach(k => localStorage.removeItem(k)); } catch { }
export const START_LINK = 'https://disk.yandex.ru/d/LJBJe1jgmj9JGA';
const chan = 'BroadcastChannel' in window ? new BroadcastChannel('spectroptik') : null;
const listeners = new Set();

// Ярлыки: порядок — спектр (красный → фиолетовый), цвета — по ТЗ
export const LABELS = [
  { id: 'content', name: 'Контент', color: '#E5484D' },
  { id: 'color', name: 'Цвет', color: '#F2711C' },
  { id: 'thumb', name: 'Превью', color: '#D9A400' },
  { id: 'sound', name: 'Звук', color: '#22A06B' },
  { id: 'subs', name: 'Субтитры', color: '#12A5A5' },
  { id: 'cut', name: 'Монтаж', color: '#3546E0' },
  { id: 'titles', name: 'Титры', color: '#8E4EC6' },
  { id: 'fx', name: 'Эффекты', color: '#D6409F' },
  { id: 'q', name: 'Вопрос', color: '#8B8D98' },
];
export const labelById = id => LABELS.find(l => l.id === id) || LABELS[LABELS.length - 1];

export const STATUSES = [
  { id: 'open', name: 'Открыто', short: 'Открыто' },
  { id: 'progress', name: 'В работе', short: 'В работе' },
  { id: 'question', name: 'Нужно уточнение', short: 'Уточнить' },
  { id: 'fixed', name: 'Исправлено', short: 'Исправлено' },
  { id: 'accepted', name: 'Принято', short: 'Принято' },
  { id: 'rejected', name: 'Отклонено', short: 'Отклонено' },
];
export const statusById = id => STATUSES.find(s => s.id === id) || STATUSES[0];
export const RESOLVED = new Set(['accepted', 'rejected']);
export const CARRY = new Set(['open', 'progress', 'question', 'fixed']);

export const PRIORITIES = [
  { id: 'critical', name: 'Критично' },
  { id: 'important', name: 'Важно' },
  { id: 'wish', name: 'Желательно' },
];
export const KINDS = [
  { id: 'fix', name: 'Правка' },
  { id: 'question', name: 'Вопрос' },
  { id: 'approval', name: 'Одобрение' },
];
export const ROLES = [
  { id: 'producer', name: 'Продюсер' },
  { id: 'editor', name: 'Монтажёр' },
  { id: 'client', name: 'Заказчик' },
];
export const roleName = id => ROLES.find(r => r.id === id)?.name || id;
export const STAGES = ['Сценарий', 'Съёмка', 'Монтаж', 'Ревью', 'Готов к публикации', 'Опубликован'];
export const VERSION_STATUSES = ['Черновик', 'На ревью', 'Правки', 'Утверждена'];
const USER_COLORS = ['#3546E0', '#E5484D', '#22A06B', '#8E4EC6', '#F2711C', '#12A5A5', '#D6409F'];

export const DEFAULT_CHECKLIST = [
  'Финальная версия утверждена', 'Превью (обложка) загружено', 'Название и описание готовы',
  'Таймкоды глав в описании', 'Субтитры загружены', 'Конечная заставка и подсказки',
  'Музыка проверена на авторские права', 'Возрастные ограничения выставлены',
];

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Не удалось прочитать данные', e); }
  return seed();
}
function migrate(s) { s.users ||= []; s.projects ||= []; s.prefs ||= {}; return s; }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.error(e); window.dispatchEvent(new CustomEvent('store-error', { detail: 'Место в браузере закончилось: удалите старые проекты или экспортируйте их.' })); }
  chan?.postMessage({ t: Date.now() });
}
chan && (chan.onmessage = () => { state = load(); emit('remote'); });
window.addEventListener('storage', e => { if (e.key === KEY) { state = load(); emit('remote'); } });

function emit(reason) { listeners.forEach(fn => fn(reason)); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function commit(reason = 'local') { persist(); emit(reason); }
export const getState = () => state;

// ——— Пользователи и права ———
export function me() { return state.users.find(u => u.id === state.meId) || state.users[0]; }
export function userById(id) { return state.users.find(u => u.id === id); }
export function setMe(id) { state.meId = id; commit(); }
export function addUser(name, role) {
  const u = { id: uid('u_'), name: name.trim(), role, color: USER_COLORS[state.users.length % USER_COLORS.length] };
  state.users.push(u); state.meId = u.id; commit(); return u;
}

export const can = {
  seePrivate: u => u.role !== 'client',
  edit: (u, n) => u.role === 'producer' || n.authorId === u.id,
  manageProject: u => u.role === 'producer',
  addVersion: u => u.role !== 'client',
  approveVersion: u => u.role === 'producer' || u.role === 'client',
  /** Какие статусы пользователь может поставить правке */
  statuses(u, n) {
    if (u.role === 'producer') return STATUSES.map(s => s.id);
    if (u.role === 'editor') return ['open', 'progress', 'question', 'fixed'];
    // заказчик: принять своё/чужое исправленное или вернуть в работу
    return n.status === 'fixed' || n.status === 'accepted' ? ['accepted', 'open'] : n.status === 'question' ? ['question', 'open'] : [n.status];
  },
};

// ——— Проекты ———
export const projects = () => state.projects;
export const getProject = id => state.projects.find(p => p.id === id);

export function createProject({ title, deadline, template = 'youtube' }) {
  const p = {
    id: uid('p_'), title: title.trim() || 'Без названия', stage: 'Монтаж', deadline: deadline || '', template,
    createdAt: Date.now(), updatedAt: Date.now(), seq: 0,
    versions: [], notes: [], chapters: [],
    checklist: DEFAULT_CHECKLIST.map(t => ({ id: uid('c_'), title: t, done: false })),
  };
  state.projects.unshift(p); commit(); return p;
}
export function deleteProject(id) { state.projects = state.projects.filter(p => p.id !== id); commit(); }
export function touch(p) { p.updatedAt = Date.now(); }

/** Новая версия. Открытые правки прошлой версии переезжают на неё. */
export function addVersion(p, v) {
  const prev = p.versions[p.versions.length - 1];
  const ver = { id: uid('v_'), number: p.versions.length + 1, status: 'На ревью', fps: 25, createdAt: Date.now(), ...v };
  p.versions.push(ver);
  if (prev) {
    for (const n of p.notes) {
      if (n.versionId === prev.id && CARRY.has(n.status)) {
        n.versionId = ver.id;
        n.events.push(ev('carry', `Перенесена с V${prev.number} на V${ver.number}`));
      }
    }
  }
  touch(p); commit(); return ver;
}

export function ev(type, text, extra = {}) { const u = me(); return { id: uid('e_'), type, text, by: u?.name, at: Date.now(), ...extra }; }

export function addNote(p, data) {
  const u = me();
  p.seq = (p.seq || p.notes.reduce((m, n) => Math.max(m, n.seq), 0)) + 1;
  const n = {
    id: uid('n_'), seq: p.seq, authorId: u.id, status: 'open', kind: 'fix', priority: 'important', visibility: 'all',
    labels: [], shapes: [], replies: [], events: [ev('create', 'Создана')], createdAt: Date.now(), updatedAt: Date.now(),
    ...data,
  };
  if (n.kind === 'approval') n.status = 'accepted';
  p.notes.push(n); touch(p); commit(); return n;
}

export function updateNote(p, n, patch, eventText) {
  Object.assign(n, patch, { updatedAt: Date.now() });
  if (eventText) n.events.push(ev('update', eventText));
  touch(p); commit();
}
export function setStatus(p, n, status) {
  if (n.status === status) return;
  const from = statusById(n.status).name, to = statusById(status).name;
  updateNote(p, n, { status }, `Статус: ${from} → ${to}`);
}
export function deleteNote(p, n) { p.notes = p.notes.filter(x => x !== n); touch(p); commit(); }
export function addReply(p, n, text) {
  n.replies.push({ id: uid('r_'), authorId: me().id, text, at: Date.now() });
  n.updatedAt = Date.now(); touch(p); commit();
}

export function exportProjectJson(p) { return JSON.stringify({ format: 'spectroptik/project', version: 1, project: p, users: state.users }, null, 2); }
export function importProjectJson(text) {
  const data = JSON.parse(text);
  if (data.format !== 'spectroptik/project') throw new Error('Это не файл проекта СпектрОптик');
  for (const u of data.users || []) if (!userById(u.id)) state.users.push(u);
  const p = data.project;
  const existing = getProject(p.id);
  if (existing) Object.assign(existing, p); else state.projects.unshift(p);
  commit(); return p;
}

// ——— Стартовые данные: владелец и первый проект с видео из папки Яндекс Диска ———
function seed() {
  const now = Date.now();
  const users = [{ id: 'u_nik', name: 'Николай Зиганшин', role: 'producer', color: '#3546E0' }];
  const p = {
    id: 'p_first', title: 'Первый проект', stage: 'Ревью', deadline: '', template: 'youtube',
    createdAt: now, updatedAt: now, seq: 0,
    versions: [{ id: 'v_first', number: 1, title: 'Первая сборка', status: 'На ревью', fps: 25, createdAt: now, sourceType: 'yandex', sourceUrl: START_LINK, sourcePath: '' }],
    notes: [], chapters: [],
    checklist: DEFAULT_CHECKLIST.map(t => ({ id: uid('c_'), title: t, done: false })),
  };
  const s = { users, meId: 'u_nik', projects: [p], prefs: {} };
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { }
  return s;
}

export function resetAll() { localStorage.removeItem(KEY); state = seed(); commit(); }
