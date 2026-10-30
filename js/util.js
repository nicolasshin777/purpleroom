// Общие утилиты СпектрОптик CRM
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** replaceChildren без null/false в детях */
export function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false && k !== '')); return el; }

export function uid(prefix = '') {
  const s = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  return prefix + s;
}

/** Короткий «системный» ID для правки: 7F-C2 */
export function shortId(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hex = h.toString(16).toUpperCase().padStart(4, '0');
  return hex.slice(0, 2) + '-' + hex.slice(2, 4);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Мини-гиперскрипт: h('div.cls#id', {attrs}, ...children) */
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m[1] || 'div');
  (m[2].match(/[.#][\w-]+/g) || []).forEach(p => p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1)));
  if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sv == null) continue; sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv); } }
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Таймкод ЧЧ:ММ:СС:КК (кадры) или ММ:СС.мс */
export function tc(sec, fps = 25, mode = 'frames') {
  if (!isFinite(sec) || sec < 0) sec = 0;
  if (mode === 'ms') {
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  }
  const f = Math.round(fps) || 25;
  let total = Math.floor(sec * fps + 1e-6);
  const fr = total % f; total = Math.floor(total / f);
  const s = total % 60, m = Math.floor(total / 60) % 60, hh = Math.floor(total / 3600);
  return [hh, m, s, fr].map(n => String(n).padStart(2, '0')).join(':');
}

/** Короткий таймкод для списков: 1:12 или 1:02:05 */
export function tcShort(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function relTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'только что';
  if (d < 3600) return `${Math.round(d / 60)} мин назад`;
  if (d < 86400) return `${Math.round(d / 3600)} ч назад`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} дн назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
}

// ——— Тосты ———
let toastWrap;
export function toast(text, kind = 'info') {
  if (!toastWrap) { toastWrap = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastWrap); }
  const t = h('div.toast.' + kind, text);
  toastWrap.append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ——— Модальные окна ———
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = h('div.modal-back');
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h2', title), h('button.icon-btn', { 'aria-label': 'Закрыть', onclick: close, html: icon('x') })),
    h('div.modal-body', body),
    actions.length ? h('div.modal-foot', actions.map(a => h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), {
      onclick: async () => { const r = await a.onClick?.(); if (r !== false) close(); }
    }, a.label))) : null
  );
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  back.append(box);
  document.body.append(back);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input,textarea,select,button.primary'))?.focus(), 30);
  return { close, box };
}

// ——— Всплывающее меню ———
export function popover(anchor, content, { align = 'left', onClose } = {}) {
  document.querySelectorAll('.popover').forEach(p => p._close?.());
  const pop = h('div.popover', content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let x = align === 'right' ? r.right - pr.width : r.left;
  let y = r.bottom + 6;
  if (y + pr.height > innerHeight - 8) y = r.top - pr.height - 6;
  x = clamp(x, 8, innerWidth - pr.width - 8);
  pop.style.left = x + 'px'; pop.style.top = Math.max(8, y) + 'px';
  const close = () => { pop.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); onClose?.(); };
  const out = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', key, true); });
  pop._close = close; pop.close = close;
  return { pop, close };
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, text); document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
}

// ——— Иконки (stroke 1.5, 20×20) ———
const P = {
  x: '<path d="M5 5l10 10M15 5L5 15"/>',
  back: '<path d="M12 4l-6 6 6 6"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  play: '<path d="M7 4.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M6.5 4.5h2.5v11H6.5zM11 4.5h2.5v11H11z" fill="currentColor" stroke="none"/>',
  stepb: '<path d="M14 5l-6 5 6 5zM5 5v10"/>',
  stepf: '<path d="M6 5l6 5-6 5zM15 5v10"/>',
  rew: '<path d="M4 10a6 6 0 1 0 2-4.5M4 3.5v3h3"/>',
  fwd: '<path d="M16 10a6 6 0 1 1-2-4.5M16 3.5v3h-3"/>',
  vol: '<path d="M4 8h3l4-3v10l-4-3H4zM14 7.5a3.5 3.5 0 0 1 0 5"/>',
  mute: '<path d="M4 8h3l4-3v10l-4-3H4zM14 8l4 4M18 8l-4 4"/>',
  full: '<path d="M4 8V4h4M16 8V4h-4M4 12v4h4M16 12v4h-4"/>',
  loop: '<path d="M5 9V8a3 3 0 0 1 3-3h7l-2-2M15 11v1a3 3 0 0 1-3 3H5l2 2"/>',
  cursor: '<path d="M5 3.5l10 5.5-4.5 1.2L8.8 15z"/>',
  pin: '<circle cx="10" cy="8.5" r="4"/><path d="M10 12.5V17"/>',
  rect: '<rect x="3.5" y="5" width="13" height="10" rx="1"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5"/>',
  arrow: '<path d="M4 16L15.5 4.5M9 4.5h6.5V11"/>',
  brush: '<path d="M3.5 15c2.5 0 3-4 5.5-4s2 3 4 3 2.5-6 3.5-8"/>',
  text: '<path d="M4 5h12M10 5v11M7.5 16h5"/>',
  blur: '<rect x="3.5" y="5" width="13" height="10" rx="1" stroke-dasharray="2 2"/><circle cx="8" cy="9" r=".6" fill="currentColor"/><circle cx="12" cy="11" r=".6" fill="currentColor"/>',
  undo: '<path d="M7 7H13a3.5 3.5 0 0 1 0 7H8M7 7l3-3M7 7l3 3"/>',
  redo: '<path d="M13 7H7a3.5 3.5 0 0 0 0 7h5M13 7l-3-3M13 7l-3 3"/>',
  grid: '<rect x="3.5" y="4.5" width="13" height="11" rx="1"/><path d="M7.8 4.5v11M12.2 4.5v11M3.5 8.2h13M3.5 11.8h13"/>',
  share: '<circle cx="14.5" cy="5" r="2"/><circle cx="5.5" cy="10" r="2"/><circle cx="14.5" cy="15" r="2"/><path d="M7.3 9l5.4-3M7.3 11l5.4 3"/>',
  download: '<path d="M10 3.5v9M6 9l4 4 4-4M4 16.5h12"/>',
  upload: '<path d="M10 13V4M6 8l4-4 4 4M4 16.5h12"/>',
  compare: '<rect x="3" y="4.5" width="14" height="11" rx="1"/><path d="M10 3v14"/>',
  search: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="M12 12l4.5 4.5"/>',
  filter: '<path d="M3.5 5h13M6 10h8M8.5 15h3"/>',
  check: '<path d="M4.5 10.5l3.5 3.5 7.5-8"/>',
  chat: '<path d="M4 5h12v8H9l-3 3v-3H4z"/>',
  mic: '<rect x="7.5" y="3" width="5" height="9" rx="2.5"/><path d="M5 10a5 5 0 0 0 10 0M10 15v2.5"/>',
  link: '<path d="M8.5 11.5l3-3M7 9.5L5.5 11a2.5 2.5 0 0 0 3.5 3.5L10.5 13M13 10.5l1.5-1.5A2.5 2.5 0 0 0 11 5.5L9.5 7"/>',
  trash: '<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>',
  more: '<circle cx="5" cy="10" r="1" fill="currentColor"/><circle cx="10" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/>',
  zoomin: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="M12 12l4.5 4.5M6.5 8.5h4M8.5 6.5v4"/>',
  zoomout: '<circle cx="8.5" cy="8.5" r="4.5"/><path d="M12 12l4.5 4.5M6.5 8.5h4"/>',
  keyboard: '<rect x="2.5" y="5.5" width="15" height="9" rx="1.5"/><path d="M5.5 8.5h1M9.5 8.5h1M13.5 8.5h1M6.5 11.5h7"/>',
  flag: '<path d="M5 17V3.5M5 4h9l-2 3 2 3H5"/>',
  list: '<path d="M7 5h9M7 10h9M7 15h9M4 5h.5M4 10h.5M4 15h.5"/>',
  user: '<circle cx="10" cy="7" r="3"/><path d="M4 16.5c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5"/>',
  video: '<rect x="3" y="5" width="10" height="10" rx="1.5"/><path d="M13 9l4-2.5v7L13 11"/>',
  folder: '<path d="M3 6.5V15h14V7.5H9.5L8 5.5H3z"/>',
  clock: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5V10l2.5 1.5"/>',
  eye: '<path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><circle cx="10" cy="10" r="2"/>',
  lock: '<rect x="5" y="9" width="10" height="7.5" rx="1"/><path d="M7 9V7a3 3 0 0 1 6 0v2"/>',
  sparkle: '<path d="M10 3v4M10 13v4M3 10h4M13 10h4M5.5 5.5l2 2M12.5 12.5l2 2M14.5 5.5l-2 2M7.5 12.5l-2 2"/>',
  pdf: '<path d="M5 2.5h7l3 3v12H5zM12 2.5v3h3"/><path d="M7.5 11h5M7.5 14h5M7.5 8h2"/>',
  home: '<path d="M3.5 9L10 3.5 16.5 9V16.5h-4.5v-4.5h-4v4.5H3.5z"/>',
  kanban: '<rect x="3" y="4" width="4" height="12" rx="1"/><rect x="8.5" y="4" width="4" height="8" rx="1"/><rect x="14" y="4" width="3" height="10" rx="1"/>',
  calendar: '<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
  chart: '<path d="M3.5 16.5h13M5.5 13.5V10M9 13.5V6M12.5 13.5v-5M16 13.5V4"/>',
  gear: '<circle cx="10" cy="10" r="2.6"/><path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4"/>',
  rocket: '<path d="M11.5 3.5c2.5 0 5 2.5 5 5l-6 6-5-5z"/><path d="M5.5 9.5l-2 1 3 3 1-2M10.5 14.5l1 2 2-1M12.5 7.5h.01"/>',
  send: '<path d="M3 10L17 3.5l-4 13-3.5-5z"/><path d="M9.5 11.5L17 3.5"/>',
  refresh: '<path d="M16 10a6 6 0 1 1-1.8-4.3M16 4v3.5h-3.5"/>',
  external: '<path d="M11 4h5v5M16 4l-7 7M14 11.5V16H4V6h4.5"/>',
  sun: '<circle cx="10" cy="10" r="3.2"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3L6 14M14 6l1.3-1.3"/>',
  moon: '<path d="M15.5 12.2A6.2 6.2 0 0 1 7.8 4.5a6.2 6.2 0 1 0 7.7 7.7z"/>',
};
export function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
export function iconEl(name, size) { const s = document.createElement('span'); s.className = 'ic-wrap'; s.innerHTML = icon(name, size); return s; }

/** Логотип: призма, раскладывающая луч в спектр */
export function logoSvg(size = 28) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">
    <path d="M2 16h9" stroke="currentColor" stroke-width="1.6"/>
    <path d="M11 6.5L19.5 25.5H2.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" transform="translate(4.5 -0.5)"/>
    <path d="M20 15.2L31 8" stroke="#E5484D" stroke-width="1.6"/>
    <path d="M20 15.8L31 12.5" stroke="#F59E0B" stroke-width="1.6"/>
    <path d="M20 16.4L31 17" stroke="#22A06B" stroke-width="1.6"/>
    <path d="M20 17L31 21.5" stroke="#3546E0" stroke-width="1.6"/>
    <path d="M20 17.6L31 26" stroke="#8E4EC6" stroke-width="1.6"/>
  </svg>`;
}

/** Кнопка темы: луна в светлой, солнце в тёмной */
export function themeIcons(size = 18) { return icon('moon', size).replace('class="ic"', 'class="ic ic-moon"') + icon('sun', size).replace('class="ic"', 'class="ic ic-sun"'); }
