// Общая база СпектрОптика: вход и синхронизация через Data API Layero (совместим с supabase-js).
// Браузер остаётся кэшем: всё видно сразу, изменения уходят на сервер в фоне,
// чужие изменения приходят каждые 15 секунд и при возврате на вкладку.
// Без адреса базы в config.js CRM работает как раньше — только в этом браузере.
import { CLOUD } from './config.js';
import { getState, commit, setSyncHook } from './store.js';
import { crm } from './data.js';
import { h, fill, toast, logoSvg } from './util.js';

export const cloudOn = !!(CLOUD.url && CLOUD.key);
const POLL_MS = 15000;
const BACKUP_KEY = 'spectroptik.v4.before-cloud';

let db = null, user = null, member = null, members = [], ready = false;
let meta = { sent: {}, known: {} };  // sent: id → отпечаток данных, согласованных с сервером; known: id → updated_at
let chain = Promise.resolve(), pushTimer = 0, lastError = '', rounds = 0;

export const isReady = () => !cloudOn || ready;
export const account = () => member && { ...member, email: user?.email };
export const team = () => members;

async function client() {
  if (db) return db;
  const { createClient } = await import('./vendor/supabase.js');
  db = createClient(CLOUD.url, CLOUD.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'spectroptik.auth' } });
  return db;
}

// ——— Вход ———

/** Показывает вход, пока человек не войдёт и не получит роль. true — можно открывать CRM. */
export async function gate(root) {
  const c = await client();
  c.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  let { data: { session } } = await c.auth.getSession();
  if (!session) session = await authScreen(root);
  try { return await enter(root); }
  catch (e) { failScreen(root, e); return false; }
}

export async function signOut() { await (await client()).auth.signOut(); }

function authScreen(root) {
  return new Promise(resolve => {
    let mode = 'in';
    const email = h('input.input', { type: 'email', autocomplete: 'email', placeholder: 'почта@пример.ru', required: true });
    const pass = h('input.input', { type: 'password', autocomplete: 'current-password', placeholder: 'не короче 8 символов', minlength: 8, required: true });
    const name = h('input.input', { autocomplete: 'name', placeholder: 'Имя и фамилия' });
    const msg = h('p.auth-msg', { role: 'status' });
    const say = (t, bad) => { msg.textContent = t; msg.classList.toggle('bad', !!bad); };
    const form = h('form.auth-card', { onsubmit: e => { e.preventDefault(); submit(); } });
    const draw = () => {
      pass.autocomplete = mode === 'up' ? 'new-password' : 'current-password';
      fill(form,
        h('div.auth-brand', { html: logoSvg(34) + '<b>СпектрОптик</b><span>CRM</span>' }),
        h('h1', mode === 'up' ? 'Регистрация' : mode === 'reset' ? 'Новый пароль' : 'Вход'),
        h('p.auth-sub', mode === 'up' ? 'После регистрации продюсер выдаст вам роль: монтажёр или заказчик.' : mode === 'reset' ? 'Пришлём ссылку для смены пароля.' : 'Проекты, правки и выпуски команды — в одном месте.'),
        mode === 'up' ? h('div.field', h('label', 'Имя'), name) : null,
        h('div.field', h('label', 'Почта'), email),
        mode !== 'reset' ? h('div.field', h('label', 'Пароль'), pass) : null,
        msg,
        h('button.btn.primary.auth-go', { type: 'submit' }, mode === 'up' ? 'Зарегистрироваться' : mode === 'reset' ? 'Прислать ссылку' : 'Войти'),
        h('div.auth-alt',
          mode !== 'in' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { mode = 'in'; say(''); draw(); } }, 'У меня есть аккаунт') : h('button.btn.ghost.sm', { type: 'button', onclick: () => { mode = 'up'; say(''); draw(); } }, 'Регистрация'),
          mode === 'in' ? h('button.btn.ghost.sm', { type: 'button', onclick: () => { mode = 'reset'; say(''); draw(); } }, 'Забыли пароль?') : null),
      );
    };
    const submit = async () => {
      const c = await client(), em = email.value.trim(), pw = pass.value;
      if (!em) return email.focus();
      if (mode !== 'reset' && pw.length < 8) { say('Пароль — не короче 8 символов.', true); return pass.focus(); }
      const btn = form.querySelector('.auth-go'); btn.disabled = true; say('Секунду…');
      try {
        const back = location.origin + location.pathname;
        if (mode === 'in') {
          const { data, error } = await c.auth.signInWithPassword({ email: em, password: pw });
          if (error) throw error;
          return resolve(data.session);
        }
        if (mode === 'up') {
          const { data, error } = await c.auth.signUp({ email: em, password: pw, options: { data: { name: name.value.trim() }, emailRedirectTo: back } });
          if (error) throw error;
          if (data.session) return resolve(data.session);
          say('Готово. Откройте письмо и перейдите по ссылке, чтобы подтвердить почту, затем войдите.');
          mode = 'in'; btn.disabled = false; return;
        }
        const { error } = await c.auth.resetPasswordForEmail(em, { redirectTo: back });
        if (error) throw error;
        say('Письмо отправлено. Ссылка из него откроет CRM — пароль можно сменить в настройках.');
      } catch (e) { say(authError(e), true); }
      btn.disabled = false;
    };
    draw();
    fill(root, h('div.auth', form));
    setTimeout(() => email.focus(), 30);
  });
}

function authError(e) {
  const m = String(e?.message || e);
  if (/invalid login|invalid_credentials/i.test(m)) return 'Неверная почта или пароль.';
  if (/not confirmed/i.test(m)) return 'Почта ещё не подтверждена — перейдите по ссылке из письма.';
  if (/already registered|already exists/i.test(m)) return 'Такая почта уже зарегистрирована — войдите.';
  if (/rate limit|too many/i.test(m)) return 'Слишком много попыток. Подождите минуту.';
  if (/failed to fetch|network/i.test(m)) return 'Нет связи с сервером. Проверьте интернет.';
  return m;
}

function pendingScreen(root) {
  fill(root, h('div.auth', h('div.auth-card',
    h('div.auth-brand', { html: logoSvg(34) + '<b>СпектрОптик</b><span>CRM</span>' }),
    h('h1', 'Ждём подтверждения'),
    h('p.auth-sub', `Вы вошли как ${user.email}. Продюсер должен выдать вам роль в «Настройки → Команда». Как только выдаст — обновите страницу.`),
    h('div.auth-alt', h('button.btn.primary', { onclick: () => location.reload() }, 'Проверить ещё раз'), h('button.btn.ghost.sm', { onclick: signOut }, 'Выйти')))));
}

function failScreen(root, e) {
  console.error(e);
  fill(root, h('div.auth', h('div.auth-card',
    h('div.auth-brand', { html: logoSvg(34) + '<b>СпектрОптик</b><span>CRM</span>' }),
    h('h1', 'Не удалось открыть базу'),
    h('p.auth-sub', `${authError(e)} Данные в этом браузере не тронуты.`),
    h('div.auth-alt', h('button.btn.primary', { onclick: () => location.reload() }, 'Попробовать ещё раз'), h('button.btn.ghost.sm', { onclick: signOut }, 'Выйти')))));
}

// ——— Вход в команду и первая синхронизация ———

async function enter(root) {
  const c = await client();
  const { data: { user: u }, error: ue } = await c.auth.getUser();
  if (ue) throw ue;
  user = u;
  const { data: m, error } = await c.rpc('spo_join', { p_name: u.user_metadata?.name || '', p_email: u.email || '' });
  if (error) throw error;
  member = Array.isArray(m) ? m[0] : m;
  if (member.role === 'pending') { pendingScreen(root); return false; }
  loadMeta();
  await firstSync();
  ready = true;
  setSyncHook(reason => { if (reason !== 'remote') schedulePush(); });
  setInterval(() => sync(), POLL_MS);
  addEventListener('focus', () => sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  addEventListener('beforeunload', e => { if (pushTimer || dirtyIds().length) { flushSoon(); e.preventDefault(); e.returnValue = ''; } });
  return true;
}

async function fetchMembers() {
  const { data, error } = await db.from('spo_members').select('*').order('created_at');
  if (error) throw error;
  members = data;
  member = members.find(x => x.user_id === user.id) || member;
}

function applyUsers() {
  const s = getState();
  const active = members.filter(m => m.role !== 'pending').map(m => ({ id: m.user_id, name: m.name || m.email || 'Без имени', role: m.role, color: m.color, email: m.email }));
  const legacy = (s.legacyUsers || []).filter(l => !active.some(a => a.id === l.id)).map(l => ({ ...l, legacy: true }));
  s.users = [...active, ...legacy];
  s.meId = user.id;
}

async function firstSync() {
  const s = getState();
  const flag = 'spectroptik.cloud.migrated.' + user.id;
  if (!localStorage.getItem(flag)) {
    // Копия всего, что было в браузере до общей базы — на всякий случай
    try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(s)); } catch { }
    // Кто работал в этом браузере до входа — это вы: правки, выпуски и задачи переходят на ваш аккаунт
    const oldMe = s.meId && s.meId !== user.id ? s.meId : null;
    const others = (s.users || []).filter(u => !u.legacy && u.id !== oldMe && u.id !== user.id);
    s.legacyUsers = [...(s.legacyUsers || []), ...others.map(({ id, name, role, color }) => ({ id, name, role, color }))]
      .filter((u, i, a) => a.findIndex(x => x.id === u.id) === i);
    if (oldMe) remapUser(s, oldMe, user.id);
  }
  await fetchMembers();
  await doSync(true);
  applyUsers();
  commit('remote');
  try { localStorage.setItem(flag, '1'); } catch { }
}

function remapUser(s, from, to) {
  for (const p of s.projects || []) for (const n of p.notes || []) {
    if (n.authorId === from) n.authorId = to;
    for (const r of n.replies || []) if (r.authorId === from) r.authorId = to;
  }
  for (const r of s.releases || []) if (r.owner === from) r.owner = to;
  for (const t of s.tasks || []) if (t.assignee === from) t.assignee = to;
}

// ——— Синхронизация ———

function loadMeta() { try { meta = JSON.parse(localStorage.getItem('spectroptik.cloud.' + user.id)) || meta; } catch { } meta.sent ||= {}; meta.known ||= {}; }
function saveMeta() { try { localStorage.setItem('spectroptik.cloud.' + user.id, JSON.stringify(meta)); } catch { } }

function hash(str) { let x = 5381; for (let i = 0; i < str.length; i++) x = (x * 33 + str.charCodeAt(i)) | 0; return (x >>> 0).toString(36) + ':' + str.length; }

const SECRET_ID = 'secrets';
function crmDoc(s) {
  crm();
  const st = s.settings;
  return {
    releases: s.releases, tasks: s.tasks, columns: s.columns, analytics: s.analytics, history: s.history,
    legacyUsers: s.legacyUsers || [], tombs: s.tombs || {},
    settings: { ...st, yt: { ...st.yt, key: '' }, tg: { ...st.tg, token: '' } },
  };
}
const secretDoc = s => ({ yt: s.settings?.yt?.key || '', tg: s.settings?.tg?.token || '' });
const isProducer = () => member?.role === 'producer';

/** Локальные документы: id → { kind, data } */
function localDocs() {
  const s = getState(), out = new Map();
  out.set('crm', { kind: 'crm', data: crmDoc(s) });
  for (const p of s.projects) out.set(p.id, { kind: 'project', data: p });
  return out;
}
function dirtyIds() {
  if (!ready) return [];
  return [...localDocs()].filter(([id, d]) => meta.sent[id] !== hash(JSON.stringify(d.data))).map(([id]) => id);
}

function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => { pushTimer = 0; sync(); }, 800); }
function flushSoon() { clearTimeout(pushTimer); pushTimer = 0; sync(); }

export function sync() {
  if (!ready) return chain;
  chain = chain.then(() => doSync(false)).then(() => { if (lastError) { lastError = ''; toast('Связь с базой восстановлена'); } })
    .catch(e => { const m = authError(e); if (m !== lastError) { lastError = m; toast('Не сохранилось в общую базу: ' + m, 'error'); } console.error(e); });
  return chain;
}

async function doSync(first) {
  const s = getState();
  let changed = false;

  // 1. Что изменилось на сервере
  const { data: heads, error } = await db.from('spo_docs').select('id,kind,updated_at');
  if (error) throw error;
  const server = new Map(heads.map(r => [r.id, r]));
  const need = heads.filter(r => meta.known[r.id] !== r.updated_at).map(r => r.id);
  const incoming = new Map();
  for (let i = 0; i < need.length; i += 20) {
    const { data, error: e2 } = await db.from('spo_docs').select('id,kind,data,updated_at').in('id', need.slice(i, i + 20));
    if (e2) throw e2;
    for (const r of data) incoming.set(r.id, r);
  }

  // 2. Общий документ CRM — первым: в нём отметки об удалении
  const rc = incoming.get('crm');
  if (rc) {
    const local = crmDoc(s), clean = meta.sent.crm === hash(JSON.stringify(local));
    // браузер, который ещё ни разу не синхронизировался, берёт серверное за основу и только добавляет своё
    const next = clean ? rc.data : mergeCrm(local, rc.data, meta.sent.crm === undefined);
    applyCrm(s, next);
    meta.known.crm = rc.updated_at;
    meta.sent.crm = hash(JSON.stringify(clean ? crmDoc(s) : rc.data));
    changed = true;
  }
  const tombs = s.tombs || {};

  // 3. Проекты
  for (const [id, r] of incoming) {
    if (r.kind !== 'project') continue;
    const local = s.projects.find(p => p.id === id);
    if (tombs[id]) { meta.known[id] = r.updated_at; continue; }
    if (!local) { s.projects.push(r.data); meta.sent[id] = hash(JSON.stringify(r.data)); }
    else {
      const clean = meta.sent[id] === hash(JSON.stringify(local));
      patchInPlace(local, clean ? r.data : mergeProject(local, r.data, meta.sent[id] === undefined));
      meta.sent[id] = hash(JSON.stringify(clean ? local : r.data));
    }
    meta.known[id] = r.updated_at;
    changed = true;
  }
  // удалены на сервере — убираем и у себя (если мы их знали)
  const before = s.projects.length;
  s.projects = s.projects.filter(p => {
    if (tombs[p.id]) return false;
    if (!server.has(p.id) && meta.known[p.id]) { delete meta.known[p.id]; delete meta.sent[p.id]; return false; }
    return true;
  });
  if (s.projects.length !== before) changed = true;
  if (first) s.projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // 4. Отправляем своё
  for (const [id, d] of localDocs()) {
    const json = JSON.stringify(d.data), hs = hash(json);
    if (meta.sent[id] === hs) continue;
    let res;
    if (server.has(id) && meta.known[id]) res = await db.from('spo_docs').update({ data: d.data }).eq('id', id).eq('updated_at', meta.known[id]).select('id,updated_at');
    else if (!server.has(id)) res = await db.from('spo_docs').insert({ id, kind: d.kind, data: d.data }).select('id,updated_at');
    else res = { data: [] }; // есть на сервере, но мы его ещё не скачали — заберём на следующем круге
    if (res.error && res.error.code !== '23505') throw res.error;
    const row = res.data?.[0];
    if (row) { meta.sent[id] = hs; meta.known[id] = row.updated_at; }
    else { delete meta.known[id]; setTimeout(() => sync(), 300); } // кто-то успел раньше — сольём и отправим снова
  }
  // удаления — только у продюсера (у остальных отметка останется в общем документе)
  if (isProducer()) for (const id of Object.keys(tombs)) {
    if (server.has(id) && server.get(id).kind === 'project') {
      const { error: e3 } = await db.from('spo_docs').delete().eq('id', id);
      if (!e3) { delete meta.known[id]; delete meta.sent[id]; }
    }
  }

  // 5. Ключи площадок — только продюсеру
  if (isProducer()) {
    if (first) {
      const { data: sec } = await db.from('spo_secrets').select('data').eq('id', 'main').maybeSingle();
      if (sec?.data) { crm(); s.settings.yt.key ||= sec.data.yt || ''; s.settings.tg.token ||= sec.data.tg || ''; changed = true; }
    }
    const sd = secretDoc(s), hs = hash(JSON.stringify(sd));
    if (meta.sent[SECRET_ID] !== hs && (sd.yt || sd.tg || meta.sent[SECRET_ID])) {
      const { error: e4 } = await db.from('spo_secrets').upsert({ id: 'main', data: sd });
      if (e4) throw e4;
      meta.sent[SECRET_ID] = hs;
    }
  }

  // 6. Команда — каждый четвёртый круг (примерно раз в минуту)
  if (first || ++rounds % 4 === 0) { const was = JSON.stringify(members); await fetchMembers(); if (JSON.stringify(members) !== was) { applyUsers(); changed = true; } }

  saveMeta();
  if (changed && !first) commit('remote');
}

// ——— Слияние: чужое не затирает своё ———

function mergeList(a = [], b = [], tombs = {}, preferA = true) {
  const out = new Map();
  for (const x of b) if (x && !tombs[x.id]) out.set(x.id, x);
  for (const x of a) {
    if (!x || tombs[x.id]) continue;
    const y = out.get(x.id);
    if (!y) { out.set(x.id, x); continue; }
    const ta = x.updatedAt || 0, tb = y.updatedAt || 0;
    out.set(x.id, ta > tb ? x : tb > ta ? y : preferA ? x : y);
  }
  // порядок — как у своего списка, новые чужие — в конце
  const order = [...a.map(x => x?.id), ...b.map(x => x?.id)];
  return [...new Set(order)].filter(id => out.has(id)).map(id => out.get(id));
}

function mergeProject(local, remote, preferRemote = false) {
  const mine = !preferRemote && (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const base = mine ? local : remote;
  const tombs = { ...(remote.tombs || {}), ...(local.tombs || {}) };
  return {
    ...base, tombs,
    notes: mergeList(local.notes, remote.notes, tombs, true),
    versions: mergeList(local.versions, remote.versions, {}, mine),
    seq: Math.max(local.seq || 0, remote.seq || 0),
    updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
  };
}

function mergeCrm(local, remote, preferRemote = false) {
  const tombs = { ...(remote.tombs || {}), ...(local.tombs || {}) };
  return {
    ...(preferRemote ? { ...local, ...remote } : { ...remote, ...local }), tombs,
    releases: mergeList(local.releases, remote.releases, tombs, !preferRemote),
    tasks: mergeList(local.tasks, remote.tasks, tombs, !preferRemote),
    legacyUsers: mergeList(local.legacyUsers, remote.legacyUsers, {}, !preferRemote),
  };
}

function applyCrm(s, d) {
  const keep = { key: s.settings?.yt?.key || '', token: s.settings?.tg?.token || '' };
  for (const k of ['releases', 'tasks', 'columns', 'analytics', 'history', 'legacyUsers', 'tombs']) if (d[k] !== undefined) s[k] = d[k];
  if (d.settings) { s.settings = d.settings; crm(); s.settings.yt.key = keep.key; s.settings.tg.token = keep.token; }
  // задача из колонки, которой нет на общей доске, — в первую колонку, чтобы не пропала с доски
  const cols = new Set((s.columns || []).map(c => c.id));
  for (const t of s.tasks || []) if (!cols.has(t.col) && s.columns?.[0]) t.col = s.columns[0].id;
}

/** Обновляет объект на месте: открытые экраны держат ссылки на проект и правки */
function patchInPlace(target, src) {
  if (target === src) return;
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const t = target[k];
    if (Array.isArray(v) && Array.isArray(t) && v.every(x => x && typeof x === 'object' && 'id' in x)) {
      const byId = new Map(t.filter(x => x && typeof x === 'object').map(x => [x.id, x]));
      target[k] = v.map(x => { const o = byId.get(x.id); if (o && o !== x) { patchInPlace(o, x); return o; } return x; });
    } else if (v && typeof v === 'object' && !Array.isArray(v) && t && typeof t === 'object' && !Array.isArray(t)) patchInPlace(t, v);
    else target[k] = v;
  }
}

// ——— Команда (для настроек) ———

/** Свежий состав команды — при открытии настроек */
export async function refreshTeam() {
  if (!ready) return;
  const was = JSON.stringify([members, invites]);
  try { await fetchMembers(); await loadInvites(); } catch (e) { return; }
  if (JSON.stringify([members, invites]) !== was) { applyUsers(); commit('remote'); }
}

export async function setMemberRole(userId, role) {
  const { error } = await db.from('spo_members').update({ role }).eq('user_id', userId);
  if (error) throw error;
  await fetchMembers(); applyUsers(); commit('remote');
}
/** Доступы, выданные заранее: почта → роль (видит только продюсер) */
export let invites = [];
export async function loadInvites() {
  if (member?.role !== 'producer') { invites = []; return invites; }
  const { data, error } = await db.from('spo_invites').select('email,role,created_at').order('created_at');
  if (error) throw error;
  invites = data; return invites;
}
export async function grantAccess(email, role) {
  email = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Похоже, в почте опечатка.');
  // уже зарегистрировался и ждёт — выдаём роль сразу
  const m = members.find(x => (x.email || '').toLowerCase() === email);
  if (m) { await setMemberRole(m.user_id, role); return 'member'; }
  const { error } = await db.from('spo_invites').upsert({ email, role });
  if (error) throw error;
  await loadInvites(); commit('remote'); return 'invite';
}
export async function revokeInvite(email) {
  const { error } = await db.from('spo_invites').delete().eq('email', email);
  if (error) throw error;
  await loadInvites(); commit('remote');
}

export async function removeMember(userId) {
  const { error } = await db.from('spo_members').delete().eq('user_id', userId);
  if (error) throw error;
  await fetchMembers(); applyUsers(); commit('remote');
}
export async function renameMe(name) {
  const { error } = await db.from('spo_members').update({ name: name.trim() }).eq('user_id', user.id);
  if (error) throw error;
  await fetchMembers(); applyUsers(); commit('remote');
}
export async function changePassword(password) {
  const { error } = await (await client()).auth.updateUser({ password });
  if (error) throw new Error(authError(error));
}
export const hasBackup = () => { try { return !!localStorage.getItem(BACKUP_KEY); } catch { return false; } };
export const backupJson = () => localStorage.getItem(BACKUP_KEY);
