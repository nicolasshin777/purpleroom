// Выпуски: список и карточка выпуска с подготовкой под YouTube, Rutube и Telegram.
import { h, fill, icon, toast, modal, copyText, tcShort, esc } from './util.js';
import { me, getState, createProject, RESOLVED, roleName } from './store.js';
import { crm, PLATFORMS, REL_STAGES, PUB_STATUS, KIND, stageById, createRelease, updateRelease, deleteRelease, releaseById, releaseProgress, fmtDay, createTask, ytId, fmtNum } from './data.js';
import { pageHead, isDone } from './shell.js';
import { tgSend } from './analytics.js';

let fKind = 'all', fStage = 'active', fQuery = '';


const open = r => { location.hash = `#/releases/${r.id}`; };

export function renderReleases(root, { parts }) {
  if (parts[0]) return renderRelease(root, parts[0]);
  const wrap = h('div'); root.append(wrap);
  const search = h('input.input', { placeholder: 'Поиск по названию', value: fQuery, style: { width: '220px', height: '32px' }, oninput: e => { fQuery = e.target.value; drawTable(); } });
  const tableBox = h('div');
  const draw = () => {
    fill(wrap,
      pageHead('Выпуски', 'Каждый ролик от идеи до публикации: этап, дата, площадки, чеклисты и связь с правками.',
        h('button.btn', { onclick: () => open(createRelease({ kind: 'short' })), html: icon('plus', 16) + 'Shorts' }),
        h('button.btn.primary', { onclick: () => open(createRelease({ kind: 'long' })), html: icon('plus', 16) + 'Выпуск' })),
      h('div.rel-filters',
        h('div.seg', [['all', 'Все'], ['long', 'Выпуски'], ['short', 'Shorts']].map(([id, n]) => h('button' + (fKind === id ? '.on' : ''), { onclick: () => { fKind = id; draw(); } }, n))),
        h('div.seg', [['active', 'В работе'], ['published', 'Вышли'], ['any', 'Все этапы']].map(([id, n]) => h('button' + (fStage === id ? '.on' : ''), { onclick: () => { fStage = id; draw(); } }, n))),
        h('div', { style: { flex: 1 } }), search),
      tableBox);
    drawTable();
  };
  const drawTable = () => {
    const s = crm(), q = fQuery.trim().toLowerCase();
    const list = s.releases.filter(r => (fKind === 'all' || r.kind === fKind) && (fStage === 'any' || (fStage === 'published' ? r.stage === 'published' : r.stage !== 'published')) && (!q || r.title.toLowerCase().includes(q)))
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    if (!list.length) { fill(tableBox, h('div.empty-state', h('div', { html: icon('rocket', 40) }), h('h3', s.releases.length ? 'Под фильтр ничего не попало' : 'Выпусков пока нет'), h('p', 'Заведите выпуск или Shorts — дальше отмечайте этапы, площадки и чеклисты публикации.'))); return; }
    fill(tableBox, h('div.table-wrap', h('table.rel-table',
      h('thead', h('tr', ['Дата', 'Название', 'Этап', 'Площадки', 'Готовность', 'Правки'].map((t, i) => h('th' + (i >= 4 ? '.hide-sm' : ''), t)))),
      h('tbody', list.map(r => {
        const st = stageById(r.stage), p = s.projects.find(x => x.id === r.projectId);
        const openCnt = p ? p.notes.filter(n => !RESOLVED.has(n.status) && n.kind !== 'approval').length : null;
        const pr = releaseProgress(r);
        return h('tr', { onclick: () => open(r) },
          h('td', { style: { whiteSpace: 'nowrap' } }, r.date ? fmtDay(r.date) : h('span.muted', 'без даты')),
          h('td', h('div.title', r.title), h('span.kind' + (r.kind === 'short' ? '.short' : ''), KIND[r.kind])),
          h('td', h('span.stage-pill', { style: { '--c': st.color } }, h('i'), st.name)),
          h('td', h('span.plats', PLATFORMS.map(pl => h('span.plat.st-' + (r.platforms[pl.id]?.status || 'off'), { style: { '--c': pl.color } }, h('i'), pl.name)))),
          h('td.hide-sm', h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('div.progress-mini', h('i', { style: { width: pr * 100 + '%' } })), h('span.mono', Math.round(pr * 100) + '%'))),
          h('td.hide-sm', p ? (openCnt ? `${openCnt} откр.` : 'закрыты') : h('span.muted', '—')));
      })))));
  };
  draw();
  return { refresh: draw };
}

function renderRelease(root, id) {
  const wrap = h('div'); root.append(wrap);
  const draw = () => {
    const r = releaseById(id);
    if (!r) { fill(wrap, h('div.empty-state', h('h3', 'Выпуск не найден'), h('a.btn', { href: '#/releases' }, 'К списку выпусков'))); return; }
    const s = crm(), u = me();
    const proj = s.projects.find(p => p.id === r.projectId);
    const save = (patch, quiet = true) => updateRelease(r, patch, quiet);
    const fit = el => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
    const title = h('textarea.title-input', { rows: 1, 'aria-label': 'Название выпуска', oninput: e => { fit(e.target); save({ title: e.target.value.replace(/\n/g, ' ') }); }, onchange: () => save({}, false), onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } });
    title.value = r.title; requestAnimationFrame(() => fit(title));
    const stIdx = REL_STAGES.findIndex(x => x.id === r.stage);
    const tasks = s.tasks.filter(t => t.releaseId === r.id);
    const chapters = proj ? proj.chapters.filter(c => c.versionId === proj.versions[proj.versions.length - 1]?.id).sort((a, b) => a.t - b.t) : [];
    const descLen = (r.description || '').length;

    fill(wrap,
      h('a.btn.sm.ghost', { href: '#/releases', html: icon('back', 14) + 'Все выпуски', style: { marginBottom: '10px' } }),
      title,
      h('div.stage-track', REL_STAGES.map((x, i) => h('button' + (i === stIdx ? '.on' : i < stIdx ? '.past' : ''), { style: { '--c': x.color }, onclick: () => save({ stage: x.id }, false) }, h('i'), x.name))),
      h('div.rel-grid',
        h('div',
          PLATFORMS.map(p => platCard(r, p, save, proj)),
          h('section.panel-box', { style: { marginTop: '12px' } }, h('h2', 'Описание и теги'),
            h('div.field', h('label', `Описание · ${descLen} / 5000`),
              h('textarea.textarea', { rows: 6, placeholder: 'Текст под видео. Таймкоды глав можно вставить кнопкой ниже.', oninput: e => save({ description: e.target.value }) }, r.description || '')),
            h('div.field', h('label', 'Теги через запятую'), h('input.input', { value: r.tags || '', placeholder: 'монтаж, обзор, камера', oninput: e => save({ tags: e.target.value }) })),
            h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              chapters.length >= 3 ? h('button.btn.sm', { onclick: () => { save({ description: (r.description ? r.description.trim() + '\n\n' : '') + chapters.map(c => `${tcShort(c.t)} ${c.title}`).join('\n') }, false); toast('Таймкоды добавлены'); } }, `Вставить таймкоды (${chapters.length})`) : h('span.note-line', 'Таймкоды появятся, когда в проекте правок будет 3+ глав.'),
              h('button.btn.sm', { onclick: async () => { await copyText(`${r.title}\n\n${r.description || ''}\n\n${(r.tags || '').split(',').map(t => t.trim()).filter(Boolean).map(t => '#' + t.replace(/\s+/g, '')).join(' ')}`); toast('Текст для публикации скопирован'); } }, 'Скопировать всё'))),
        ),
        h('aside', { style: { display: 'grid', gap: '12px' } },
          h('section.panel-box', h('h2', 'Параметры'),
            h('div.two',
              h('div.field.tight', h('label', 'Формат'), h('select.select', { onchange: e => save({ kind: e.target.value }, false) }, Object.entries(KIND).map(([k, n]) => h('option', { value: k, selected: r.kind === k }, n)))),
              h('div.field.tight', h('label', 'Дата выхода'), h('input.input', { type: 'date', value: r.date || '', onchange: e => save({ date: e.target.value }, false) }))),
            h('div.field', { style: { marginTop: '12px' } }, h('label', 'Ответственный'), h('select.select', { onchange: e => save({ owner: e.target.value }, false) },
              h('option', { value: '' }, '—'), getState().users.map(x => h('option', { value: x.id, selected: r.owner === x.id }, `${x.name} · ${roleName(x.role)}`)))),
            h('div.field', h('label', 'Заметка'), h('textarea.textarea', { rows: 3, placeholder: 'Идея, референсы, договорённости', oninput: e => save({ note: e.target.value }) }, r.note || ''))),
          h('section.panel-box', h('h2', 'Правки к монтажу'),
            proj ? h('div', { style: { display: 'grid', gap: '8px' } },
              h('a.row-item', { href: `#/p/${proj.id}` }, h('span', { html: icon('video', 18) }), h('div', h('div.t', proj.title), h('div.s', `${proj.versions.length} верс. · ${proj.notes.filter(n => !RESOLVED.has(n.status)).length} открытых правок`)), h('span', { html: icon('external', 16) })),
              h('button.btn.sm.ghost', { onclick: () => save({ projectId: '' }, false) }, 'Отвязать'))
              : h('div', { style: { display: 'grid', gap: '8px' } },
                h('select.select', { onchange: e => e.target.value && save({ projectId: e.target.value }, false) }, h('option', { value: '' }, 'Привязать проект правок…'), s.projects.map(p => h('option', { value: p.id }, p.title))),
                h('button.btn.sm', { onclick: () => { const p = createProject({ title: r.title, deadline: r.date }); save({ projectId: p.id }, false); location.hash = `#/p/${p.id}`; }, html: icon('plus', 15) + 'Создать проект правок' }))),
          h('section.panel-box', h('h2', `Задачи · ${tasks.length}`, h('span.grow'), h('a', { href: '#/board' }, 'доска →')),
            h('div.rows', tasks.map(t => h('label.row-item', h('input', { type: 'checkbox', checked: isDone(t, s), onchange: e => { t.col = e.target.checked ? s.columns[s.columns.length - 1].id : s.columns[0].id; updateRelease(r, {}, false); } }), h('div.t', t.title), h('span.s', t.due ? fmtDay(t.due) : '')))),
            h('form', { style: { display: 'flex', gap: '6px', marginTop: '8px' }, onsubmit: e => { e.preventDefault(); const i = e.target.elements[0]; if (i.value.trim()) { createTask({ title: i.value.trim(), releaseId: r.id, due: r.date || '' }); } } },
              h('input.input', { placeholder: 'Новая задача к выпуску', style: { height: '32px' } }), h('button.btn.sm', 'Добавить'))),
          h('button.btn.ghost.danger', { onclick: () => modal({ title: 'Удалить выпуск?', body: h('p', `«${r.title}» удалится вместе с чеклистами. Задачи и проект правок останутся.`), actions: [{ label: 'Отмена' }, { label: 'Удалить', danger: true, onClick: () => { deleteRelease(r); location.hash = '#/releases'; } }] }), html: icon('trash', 15) + 'Удалить выпуск' }),
        )));
  };
  draw();
  return { refresh: draw };
}

function platCard(r, p, save, proj) {
  const x = r.platforms[p.id] ||= { status: 'off', at: '', url: '', checks: [] };
  const done = x.checks.filter(c => c.done).length;
  const s = crm();
  const vid = p.id === 'youtube' ? ytId(x.url) : '';
  const stat = vid && s.analytics.videos?.find(v => v.id === vid);
  return h('section.plat-card' + (x.status === 'off' ? '.off' : ''), { style: { '--c': p.color } },
    h('div.ph', h('span.dot'), h('b', p.name),
      x.status !== 'off' ? h('span.mono.muted', `${done}/${x.checks.length}`) : null,
      h('span.grow'),
      h('select.select', { style: { width: 'auto', height: '30px', fontSize: '12.5px' }, 'aria-label': `Статус ${p.name}`, onchange: e => { x.status = e.target.value; if (x.status === 'published' && !Object.values(r.platforms).some(o => o.status !== 'published' && o.status !== 'off')) r.stage = 'published'; save({}, false); } },
        PUB_STATUS.map(o => h('option', { value: o.id, selected: x.status === o.id }, o.name)))),
    h('div.pb',
      h('div.two',
        h('div.field.tight', h('label', 'Публикация'), h('input.input', { type: 'datetime-local', value: x.at || '', onchange: e => { x.at = e.target.value; if (!r.date && x.at) r.date = x.at.slice(0, 10); save({}, false); } })),
        h('div.field.tight', h('label', 'Ссылка'), h('input.input', { type: 'url', value: x.url || '', placeholder: p.id === 'telegram' ? 'https://t.me/канал/123' : `https://${p.id}…`, onchange: e => { x.url = e.target.value.trim(); save({}, false); } }))),
      h('div.checks', x.checks.map(c => h('label.check-chip' + (c.done ? '.done' : ''), h('input', { type: 'checkbox', checked: c.done, onchange: e => { c.done = e.target.checked; save({}, false); } }), c.t))),
      stat ? h('div.note-line', `На канале: ${fmtNum(stat.views)} просмотров · ${fmtNum(stat.likes)} лайков · ${fmtNum(stat.comments)} комм.`) : null,
      p.id === 'telegram' ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.btn.sm', { onclick: () => announce(r), html: icon('send', 15) + 'Отправить анонс в канал' }),
        s.settings.tg.token ? null : h('span.note-line', 'Нужен бот — в настройках.')) : null,
    ));
}

/** Анонс в Telegram-канал через бота: название, текст, ссылки на площадки */
function announce(r) {
  const links = PLATFORMS.filter(p => p.id !== 'telegram' && r.platforms[p.id]?.url).map(p => `${p.name}: ${r.platforms[p.id].url}`);
  const ta = h('textarea.textarea', { rows: 8 }, `${r.title}\n\n${(r.description || '').split('\n\n')[0]}\n\n${links.join('\n')}`.trim());
  modal({ title: 'Анонс в Telegram', body: h('div', h('p.note-line', `Отправится в ${crm().settings.tg.chat || 'канал из настроек'} от имени бота.`), ta), actions: [{ label: 'Отмена' }, {
    label: 'Отправить', primary: true, onClick: async () => {
      try { const res = await tgSend(ta.value); const x = r.platforms.telegram; x.status = 'published'; if (res?.url) x.url = res.url; x.at ||= new Date().toISOString().slice(0, 16); updateRelease(r, {}, false); toast('Анонс отправлен'); }
      catch (e) { toast(e.message, 'error'); return false; }
    },
  }] });
}
