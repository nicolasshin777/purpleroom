// Окно «Новая версия»: ссылка с Диска или файл с компьютера.
import { h, fill, modal, toast, icon, esc } from './util.js';
import { detectSource, resolveLink, registerLocalFile } from './sources.js';
import { addVersion, me, can, ROLES, addUser, setMe, getState, roleName, touch, commit, projects, importNotes, readProjectJson, authorMapFor, RESOLVED, deleteProject, exportProjectJson } from './store.js';
import { cloudOn, projectForExport } from './cloud.js';
import { tcShort, download } from './util.js';
import * as cloud from './cloud.js';

export function openAddVersion(p, { onAdded } = {}) {
  const u = me();
  if (!can.addVersion(u)) { toast('Новые версии добавляет монтажёр или продюсер'); return; }
  let picked = null;      // { type, url, path, file, name }
  const nextN = p.versions.length + 1;

  const urlInput = h('input.input', { type: 'url', placeholder: 'https://disk.yandex.ru/i/…  или  https://drive.google.com/file/d/…', autofocus: true, 'aria-label': 'Ссылка на видео' });
  const badge = h('div.hint');
  const folderBox = h('div');
  const titleInput = h('input.input', { placeholder: nextN === 1 ? 'Например: первая сборка' : 'Что изменилось в этой версии' });
  const fileInput = h('input', { type: 'file', accept: 'video/*', class: 'sr', id: 'fpick' });
  const status = h('div.hint', { style: { minHeight: '18px' } });

  const update = () => {
    const s = detectSource(urlInput.value);
    folderBox.innerHTML = '';
    if (!urlInput.value.trim()) { badge.textContent = 'Поддерживаются публичные ссылки Яндекс Диска (файл или папка), Google Диска с доступом по ссылке и прямые ссылки на mp4/webm/m3u8.'; picked = null; return; }
    badge.innerHTML = s.type === 'invalid' ? `<span style="color:var(--danger)">${esc(s.name)}</span>` : `Источник: <b>${esc(s.name)}</b>`;
    picked = s.type === 'invalid' ? null : { type: s.type, url: urlInput.value.trim(), name: s.name };
  };
  urlInput.addEventListener('input', update); update();

  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; if (!f) return;
    picked = { type: 'file', file: f, name: f.name };
    urlInput.value = ''; badge.innerHTML = `Файл: <b>${esc(f.name)}</b> · ${(f.size / 1048576).toFixed(1)} МБ. Он будет доступен в этой вкладке; заказчику отправьте ссылку с Диска.`;
  });

  const body = h('div',
    h('div.field', h('label', { for: 'vurl' }, 'Ссылка на видео'), Object.assign(urlInput, { id: 'vurl' }), badge),
    folderBox,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '-4px 0 14px' } },
      h('label.btn.sm', { for: 'fpick', html: icon('upload', 16) + 'Файл с компьютера' }), fileInput),
    h('div.field', h('label', `Название версии V${nextN}`), titleInput),
    status,
  );

  const submit = async () => {
    if (!picked) { status.innerHTML = '<span style="color:var(--danger)">Вставьте ссылку или выберите файл.</span>'; return false; }
    const base = { title: titleInput.value.trim() };
    try {
      if (picked.type === 'file') {
        const v = addVersion(p, { ...base, sourceType: 'file', sourceUrl: picked.file.name });
        registerLocalFile(v.id, picked.file); finish(v); return;
      }
      status.textContent = 'Проверяю ссылку…';
      const r = await resolveLink(picked.url, picked.path);
      if (r.kind === 'folder') {
        status.textContent = '';
        fill(folderBox, h('div.field', h('label', 'В папке несколько видео — выберите файл'),
          h('div', { style: { display: 'grid', gap: '6px', maxHeight: '220px', overflow: 'auto' } },
            r.items.map(it => h('button.menu-item', { style: { border: '1px solid var(--line)', background: 'var(--surface)' }, type: 'button',
              onclick: e => { picked.path = it.path; [...folderBox.querySelectorAll('.menu-item')].forEach(b => b.style.borderColor = ''); e.currentTarget.style.borderColor = 'var(--ink)'; status.textContent = `Выбран: ${it.name}`; } },
              h('span', { html: icon('video', 16) }), it.name, h('span.sub', it.size ? (it.size / 1048576).toFixed(0) + ' МБ' : ''))))));
        return false;
      }
      const v = addVersion(p, { ...base, sourceType: r.source.type === 'hls' ? 'hls' : r.source.type, sourceUrl: picked.url, sourcePath: picked.path || r.meta.path || '', driveId: r.meta.driveId, fileName: r.meta.name });
      finish(v);
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
      return false;
    }
  };
  const finish = v => {
    const carried = p.notes.filter(n => n.versionId === v.id).length;
    toast(`Версия V${v.number} добавлена` + (carried ? ` · перенесено правок: ${carried}` : ''));
    onAdded?.(v);
  };
  modal({ title: nextN === 1 ? 'Добавить видео' : `Новая версия V${nextN}`, body, actions: [{ label: 'Отмена' }, { label: 'Добавить версию', primary: true, onClick: submit }] });
}

/**
 * Заменить источник видео у существующей версии: ссылка на облако вместо файла с компьютера
 * (или новая ссылка). Правки, таймкоды и номер версии не меняются.
 */
export function openRelinkVersion(p, v, { onDone } = {}) {
  if (!can.addVersion(me())) { toast('Видео меняет монтажёр или продюсер'); return; }
  let picked = null;
  const urlInput = h('input.input', { type: 'url', placeholder: 'https://disk.yandex.ru/i/…  или  https://drive.google.com/file/d/…', 'aria-label': 'Ссылка на видео' });
  const badge = h('div.hint');
  const folderBox = h('div');
  const status = h('div.hint', { style: { minHeight: '18px' } });
  const update = () => {
    const s = detectSource(urlInput.value);
    folderBox.innerHTML = '';
    if (!urlInput.value.trim()) { badge.textContent = 'Публичная ссылка Яндекс Диска (файл или папка), Google Диска с доступом по ссылке или прямая ссылка на mp4.'; picked = null; return; }
    badge.innerHTML = s.type === 'invalid' ? `<span style="color:var(--danger)">${esc(s.name)}</span>` : `Источник: <b>${esc(s.name)}</b>`;
    picked = s.type === 'invalid' ? null : { type: s.type, url: urlInput.value.trim() };
  };
  urlInput.addEventListener('input', update); update();
  const body = h('div',
    h('p.muted', { style: { margin: '0 0 12px', fontSize: '13.5px' } }, v.sourceType === 'file'
      ? `Сейчас V${v.number} — файл с вашего компьютера${v.fileName ? ` («${v.fileName}»)` : ''}: команда его не видит. Загрузите тот же рендер в облако и вставьте ссылку — все правки останутся на своих местах.`
      : `Новая ссылка для V${v.number}. Правки и таймкоды останутся.`),
    h('div.field', h('label', 'Ссылка на видео в облаке'), urlInput, badge),
    folderBox, status);
  const submit = async () => {
    if (!picked) { status.innerHTML = '<span style="color:var(--danger)">Вставьте ссылку на видео.</span>'; return false; }
    try {
      status.textContent = 'Проверяю ссылку…';
      const r = await resolveLink(picked.url, picked.path);
      if (r.kind === 'folder') {
        status.textContent = '';
        fill(folderBox, h('div.field', h('label', 'В папке несколько видео — выберите файл'),
          h('div', { style: { display: 'grid', gap: '6px', maxHeight: '220px', overflow: 'auto' } },
            r.items.map(it => h('button.menu-item', { style: { border: '1px solid var(--line)', background: 'var(--surface)' }, type: 'button',
              onclick: e => { picked.path = it.path; [...folderBox.querySelectorAll('.menu-item')].forEach(b => b.style.borderColor = ''); e.currentTarget.style.borderColor = 'var(--ink)'; status.textContent = `Выбран: ${it.name}`; } },
              h('span', { html: icon('video', 16) }), it.name, h('span.sub', it.size ? (it.size / 1048576).toFixed(0) + ' МБ' : ''))))));
        return false;
      }
      for (const k of ['rawLink', 'mime', 'size', 'driveId', 'sourcePath', 'picked']) delete v[k];
      Object.assign(v, { sourceType: r.source.type === 'hls' ? 'hls' : r.source.type, sourceUrl: picked.url, sourcePath: picked.path || r.meta.path || '', fileName: r.meta.name || v.fileName });
      if (r.meta.driveId) v.driveId = r.meta.driveId;
      touch(p); commit();
      toast(`V${v.number}: видео теперь по ссылке — команда его увидит`);
      onDone?.(v);
    } catch (e) { status.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`; return false; }
  };
  modal({ title: `Ссылка на облако для V${v.number}`, body, actions: [{ label: 'Отмена' }, { label: 'Сохранить ссылку', primary: true, onClick: submit }] });
  setTimeout(() => urlInput.focus(), 40);
}

/** Перенести правки из другого проекта CRM или из файла в этот проект — на текущую версию */
export function openImportNotes(p, v, { onDone } = {}) {
  if (!can.addVersion(me())) { toast('Правки переносит монтажёр или продюсер'); return; }
  const dur = x => x?.versions?.[x.versions.length - 1]?.duration || 0;
  const notesOf = x => (x.notes || []).filter(n => n.kind !== 'approval');
  const pick = h('div', { style: { display: 'grid', gap: '6px', maxHeight: '280px', overflow: 'auto' } });
  const status = h('div.hint', { style: { minHeight: '18px' } });
  let m;
  const row = (src, users) => {
    const n = notesOf(src).length, d = dur(src), diff = v.duration && d ? Math.abs(d - v.duration) : 0;
    const open = notesOf(src).filter(x => !RESOLVED.has(x.status)).length;
    return h('button.menu-item', { type: 'button', style: { border: '1px solid var(--line)', background: 'var(--surface)', alignItems: 'flex-start' }, onclick: () => run(src, users) },
      h('span', { html: icon('folder', 16) }),
      h('span', { style: { display: 'grid', gap: '2px', textAlign: 'left' } },
        h('b', src.title || 'Без названия'),
        h('span.muted', { style: { fontSize: '12px' } }, `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'правка' : 'правок'}${open ? `, открытых ${open}` : ''}${d ? ` · видео ${tcShort(d)}` : ''}`),
        diff > 1 ? h('span', { style: { fontSize: '12px', color: 'var(--danger)' } }, `Длительность отличается на ${tcShort(diff)} — таймкоды могут не совпасть с кадрами`) : null));
  };
  const run = (src, users = []) => {
    const map = authorMapFor(users);
    const r = importNotes(p, src, v.id, map);
    m.close();
    toast(r.added ? `Перенесено правок: ${r.added}` + (r.skipped ? ` · уже были: ${r.skipped}` : '') : 'Новых правок нет — все уже в проекте');
    onDone?.(r);
  };
  const others = projects().filter(x => x.id !== p.id && notesOf(x).length);
  fill(pick, others.length ? others.map(x => row(x)) : h('p.muted', { style: { fontSize: '13px', margin: 0 } }, 'В CRM нет других проектов с правками — выберите файл.'));
  const file = h('input.sr', { type: 'file', accept: '.json,application/json', onchange: e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      const d = readProjectJson(t);
      if (d.project) return run(d.project, d.users);
      status.textContent = 'В копии несколько проектов — выберите, откуда перенести правки:';
      fill(pick, d.projects.filter(x => notesOf(x).length).map(x => row(x, d.users)));
    }).catch(err => { status.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`; });
    e.target.value = '';
  } });
  const body = h('div',
    h('p.muted', { style: { margin: '0 0 12px', fontSize: '13.5px' } }, `Правки лягут на V${v.number}${v.duration ? ` (${tcShort(v.duration)})` : ''} с теми же таймкодами, рисунками и обсуждением. Исходный проект не меняется. Повторный перенос дублей не создаёт.`),
    h('div.section-t', 'Из проекта в CRM'), pick, status,
    h('div', { style: { marginTop: '12px' } }, h('label.btn', { html: icon('upload', 16) + 'Из файла JSON' }, file)));
  m = modal({ title: `Перенести правки в «${p.title}»`, body, actions: [{ label: 'Закрыть' }] });
}

/** Удалить проект целиком (только продюсер). Перед удалением — копия в файл одним нажатием. */
export function openDeleteProject(p, { onDone } = {}) {
  if (!can.manageProject(me())) { toast('Удалять проекты может только продюсер'); return; }
  const notes = (p.notes || []).filter(n => n.kind !== 'approval').length, vers = (p.versions || []).length;
  const save = async () => { toast('Собираю копию проекта…'); const full = await projectForExport(p); download(`${(p.title || 'проект').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.spectroptik.json`, exportProjectJson(full), 'application/json'); saved = true; toast('Копия проекта скачана'); };
  let saved = false;
  const body = h('div',
    h('p', { style: { margin: '0 0 10px' } }, `«${p.title}»: ${notes} ${notes % 10 === 1 && notes % 100 !== 11 ? 'правка' : 'правок'}, ${vers} ${vers === 1 ? 'версия' : 'версий'}, главы и чеклист удалятся${cloudOn ? ' у всей команды' : ''}. Отменить это нельзя.`),
    h('p.muted', { style: { margin: '0 0 10px', fontSize: '13px' } }, 'Видео на Яндекс Диске или Google Диске не трогаются — удаляются только правки и записи CRM.'),
    h('button.btn', { type: 'button', onclick: save, html: icon('download', 15) + 'Скачать копию проекта' }));
  modal({ title: 'Удалить проект?', body, actions: [{ label: 'Отмена' }, { label: 'Удалить проект', danger: true, onClick: () => {
    deleteProject(p.id);
    toast(`Проект «${p.title}» удалён` + (saved ? ' · копия скачана' : ''));
    onDone?.();
  } }] });
}

/** Кто работает в этом браузере: выбор человека и роли */
export function openIdentity() {
  if (cloud.cloudOn) return openAccount();
  const st = getState();
  const name = h('input.input', { placeholder: 'Имя и фамилия' });
  const role = h('select.select', ROLES.map(r => h('option', { value: r.id }, r.name)));
  const body = h('div',
    h('p.muted', { style: { margin: '0 0 12px', fontSize: '13.5px' } }, 'Правки подписываются этим именем. Роль определяет, какие статусы можно ставить: монтажёр отмечает «Исправлено», заказчик и продюсер — «Принято».'),
    h('div', { style: { display: 'grid', gap: '6px', marginBottom: '16px' } },
      st.users.map(u => h('button.menu-item', { type: 'button', style: { border: '1px solid ' + (u.id === st.meId ? 'var(--ink)' : 'var(--line)'), background: 'var(--surface)' }, onclick: () => { setMe(u.id); m.close(); toast(`Вы работаете как ${u.name}`); } },
        h('span.avatar', { style: { '--c': u.color } }, u.name.split(' ').map(w => w[0]).join('').slice(0, 2)), u.name, h('span.sub', roleName(u.role))))),
    h('div.section-t', 'Новый участник'),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 150px', gap: '8px', marginTop: '6px' } }, name, role),
  );
  const m = modal({ title: 'Кто вы в этом проекте?', body, actions: [{ label: 'Добавить и войти', primary: true, onClick: () => { if (!name.value.trim()) { name.focus(); return false; } addUser(name.value, role.value); toast('Участник добавлен'); } }] });
}

/** С общей базой: свой аккаунт вместо выбора «кто я» */
function openAccount() {
  const a = cloud.account(); if (!a) return;
  const name = h('input.input', { value: a.name || '', placeholder: 'Имя и фамилия' });
  const pass = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: 'новый пароль, от 8 символов' });
  const body = h('div',
    h('p.muted', { style: { margin: '0 0 12px', fontSize: '13.5px' } }, `${a.email} · ${roleName(a.role)}. Роль выдаёт продюсер в «Настройки → Команда».`),
    h('div.field', h('label', 'Имя в правках'), name),
    h('div.field', h('label', 'Сменить пароль'), pass),
    h('button.btn.ghost.danger', { type: 'button', onclick: () => cloud.signOut() }, 'Выйти из аккаунта'));
  modal({ title: 'Ваш аккаунт', body, actions: [{ label: 'Отмена' }, { label: 'Сохранить', primary: true, onClick: async () => {
    try {
      if (name.value.trim() && name.value.trim() !== a.name) await cloud.renameMe(name.value);
      if (pass.value) { if (pass.value.length < 8) { toast('Пароль — не короче 8 символов', 'error'); return false; } await cloud.changePassword(pass.value); toast('Пароль изменён'); }
    } catch (e) { toast(e.message, 'error'); return false; }
  } }] });
}
