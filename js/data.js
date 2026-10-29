// Данные CRM канала: выпуски, задачи, настройки площадок, снимки аналитики.
import { getState, commit, me } from './store.js';
import { uid } from './util.js';

export const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', color: '#E5484D' },
  { id: 'rutube', name: 'Rutube', color: '#12A5A5' },
  { id: 'telegram', name: 'Telegram', color: '#2AABEE' },
];
export const platformById = id => PLATFORMS.find(p => p.id === id);

export const REL_STAGES = [
  { id: 'idea', name: 'Идея', color: '#85857C' },
  { id: 'script', name: 'Сценарий', color: '#8E4EC6' },
  { id: 'shoot', name: 'Съёмка', color: '#D9A400' },
  { id: 'edit', name: 'Монтаж', color: '#3546E0' },
  { id: 'review', name: 'Ревью', color: '#F2711C' },
  { id: 'ready', name: 'Готов', color: '#22A06B' },
  { id: 'published', name: 'Вышел', color: '#000000' },
];
export const stageById = id => REL_STAGES.find(s => s.id === id) || REL_STAGES[0];

export const PUB_STATUS = [
  { id: 'off', name: 'Не публикуем' },
  { id: 'draft', name: 'Готовим' },
  { id: 'scheduled', name: 'Запланирован' },
  { id: 'published', name: 'Опубликован' },
];

export const KIND = { long: 'Выпуск', short: 'Shorts' };

const PLATFORM_CHECKS = {
  youtube: ['Название', 'Описание и таймкоды', 'Теги', 'Превью', 'Субтитры', 'Конечная заставка', 'Плейлист'],
  rutube: ['Название', 'Описание', 'Обложка', 'Категория'],
  telegram: ['Текст анонса', 'Обложка или кружок', 'Ссылки на площадки'],
};

const DEFAULT_COLS = ['Бэклог', 'Сценарий', 'Съёмка', 'Монтаж', 'Ревью', 'Публикация', 'Готово'];

/** Достраивает состояние до формата CRM (старые данные не теряются) */
export function crm() {
  const s = getState();
  s.releases ||= [];
  s.tasks ||= [];
  s.columns ||= DEFAULT_COLS.map(n => ({ id: uid('col_'), name: n }));
  s.settings ||= {};
  const st = s.settings;
  st.goals ||= { long: 4, short: 30 };
  st.yt ||= { key: '', channel: '' };
  st.rutube ||= { person: '' };
  st.tg ||= { token: '', chat: '' };
  s.analytics ||= {};
  s.history ||= [];
  return s;
}

// ——— Выпуски ———
export function createRelease(data = {}) {
  const s = crm();
  const kind = data.kind || 'long';
  const r = {
    id: uid('r_'), title: 'Новый выпуск', kind, stage: 'idea', date: '', projectId: '', owner: me()?.id,
    description: '', tags: '', note: '', createdAt: Date.now(), updatedAt: Date.now(),
    platforms: Object.fromEntries(PLATFORMS.map(p => [p.id, {
      status: p.id === 'rutube' && kind === 'short' ? 'off' : 'draft', at: '', url: '',
      checks: PLATFORM_CHECKS[p.id].map(t => ({ t, done: false })),
    }])),
    ...data,
  };
  s.releases.unshift(r); commit(); return r;
}
export function updateRelease(r, patch, quiet) { Object.assign(r, patch, { updatedAt: Date.now() }); commit(quiet ? 'quiet' : 'local'); }
export function deleteRelease(r) { const s = crm(); s.releases = s.releases.filter(x => x !== r); s.tasks.forEach(t => { if (t.releaseId === r.id) t.releaseId = ''; }); commit(); }
export const releaseById = id => crm().releases.find(r => r.id === id);

/** Прогресс подготовки: доля отмеченных пунктов по включённым площадкам */
export function releaseProgress(r) {
  let all = 0, done = 0;
  for (const p of PLATFORMS) {
    const x = r.platforms[p.id]; if (!x || x.status === 'off') continue;
    all += x.checks.length; done += x.checks.filter(c => c.done).length;
  }
  return all ? done / all : 0;
}

/** ID ролика YouTube из ссылки */
export function ytId(url = '') {
  const m = url.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{11})/);
  return m ? m[1] : '';
}

// ——— Задачи ———
export function createTask(data = {}) {
  const s = crm();
  const t = { id: uid('t_'), title: 'Новая задача', col: s.columns[0].id, assignee: '', due: '', priority: 'important', releaseId: '', desc: '', checks: [], createdAt: Date.now(), order: Date.now(), ...data };
  s.tasks.push(t); commit(); return t;
}
export function updateTask(t, patch, quiet) { Object.assign(t, patch); commit(quiet ? 'quiet' : 'local'); }
export function deleteTask(t) { const s = crm(); s.tasks = s.tasks.filter(x => x !== t); commit(); }

// ——— Даты ———
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayStr = () => ymd(new Date());
export function monthReleases(y, m) {
  const pre = `${y}-${String(m + 1).padStart(2, '0')}`;
  return crm().releases.filter(r => (r.date || '').startsWith(pre));
}
export const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const fmtDay = s => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS_GEN[m - 1]}`; };
export const fmtNum = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн' : n >= 1e4 ? Math.round(n / 1e3) + ' тыс' : n.toLocaleString('ru-RU');
