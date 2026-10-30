import { h, fill, icon, logoSvg, relTime, fmtDate, tcShort, modal, toast, initials } from './util.js';
import { projects, me, roleName, createProject, STAGES, RESOLVED, labelById, importProjectJson, can } from './store.js';
import { openIdentity, openAddVersion, openDeleteProject } from './versions.js';

let filter = 'Все', query = '';

export function renderDashboard(root) {
  const wrap = h('div.dash');
  root.append(wrap);
  const draw = () => {
    const u = me();
    const list = projects();
    const visible = list.filter(p => (filter === 'Все' || p.stage === filter) && p.title.toLowerCase().includes(query.toLowerCase()));
    const openNotes = list.flatMap(p => p.notes).filter(n => !RESOLVED.has(n.status) && n.kind !== 'approval');
    const toCheck = openNotes.filter(n => n.status === 'fixed').length;
    const mine = u.role === 'editor' ? openNotes.filter(n => n.status !== 'fixed').length : toCheck;
    const headline = u.role === 'editor'
      ? (mine ? `${firstName(u.name)}, в работе ${mine} ${plural(mine, 'правка', 'правки', 'правок')}` : `${firstName(u.name)}, все правки закрыты`)
      : (mine ? `${firstName(u.name)}, ${mine} ${plural(mine, 'правка ждёт', 'правки ждут', 'правок ждут')} проверки` : `${firstName(u.name)}, проверять пока нечего`);

    const search = h('input.input', { placeholder: 'Найти проект', value: query, 'aria-label': 'Поиск проектов', oninput: e => { query = e.target.value; drawGrid(); } });
    const gridEl = h('div.grid');
    const drawGrid = () => {
      const vis = list.filter(p => (filter === 'Все' || p.stage === filter) && p.title.toLowerCase().includes(query.toLowerCase()));
      fill(gridEl, ...vis.map(p => can.manageProject(me())
        ? h('div.pcard-wrap', projectCard(p), h('button.icon-btn.pcard-del', { title: 'Удалить проект', 'aria-label': `Удалить проект «${p.title}»`, html: icon('trash', 16), onclick: e => { e.preventDefault(); e.stopPropagation(); openDeleteProject(p); } }))
        : projectCard(p)), newCard());
    };

    fill(wrap, 
      h('header.dash-top',
        h('a.brand', { href: '#/', html: logoSvg(30) + '<b>СпектрОптик</b><span>CRM</span>' }),
        h('div.grow'),
        h('div.search.hide-sm', { html: icon('search', 16) }, search),
        h('button.who', { onclick: openIdentity, title: 'Сменить пользователя' },
          h('span.avatar', { style: { '--c': u.color } }, initials(u.name)), h('span', firstName(u.name)), h('span.r', roleName(u.role))),
        can.manageProject(u) ? h('button.btn.primary', { onclick: openNewProject, html: icon('plus', 16) + 'Новый проект' }) : null,
      ),
      h('section.dash-hero',
        h('h1', headline),
        h('div.stats',
          stat(list.filter(p => p.stage !== 'Опубликован').length, 'проектов в работе'),
          stat(openNotes.length, 'открытых правок'),
          stat(toCheck, 'ждут проверки')),
      ),
      h('nav.dash-filter', { 'aria-label': 'Этап проекта' },
        ['Все', ...STAGES].map(s => h('button.chip' + (filter === s ? '.on' : ''), { onclick: () => { filter = s; draw(); } }, s,
          s !== 'Все' ? h('span.mono', { style: { opacity: .6 } }, list.filter(p => p.stage === s).length || '') : null))),
      gridEl,
      h('footer', { style: { padding: '0 clamp(16px,4vw,40px) 40px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', color: 'var(--ink-3)', fontSize: '13px' } },
        h('span', 'Проекты хранятся в этом браузере. Чтобы передать проект коллеге — экспортируйте его и пришлите файл.'),
        h('label.btn.sm', { html: icon('upload', 15) + 'Импорт проекта' }, h('input.sr', { type: 'file', accept: '.json,application/json', onchange: importFile })),
      ),
    );
    drawGrid();
  };
  draw();
  return { refresh: draw, unmount: () => wrap.remove() };
}

const firstName = n => n.split(' ')[0];
function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }
const stat = (n, l) => h('div.stat', h('div.n', String(n)), h('div.l', l));

function projectCard(p) {
  const v = p.versions[p.versions.length - 1];
  const notes = v ? p.notes.filter(n => n.versionId === v.id && n.kind !== 'approval') : [];
  const done = notes.filter(n => RESOLVED.has(n.status)).length;
  const open = notes.length - done;
  const dur = v?.duration || 0;
  const poster = h('div.poster',
    v?.poster ? h('img', { src: v.poster, alt: '', loading: 'lazy' }) : h('div.empty-poster', { html: schematic(!!v) }),
    h('span.chip.badge', p.stage),
    dur ? h('span.dur.mono', tcShort(dur)) : null,
    dur ? h('div.ticks', notes.map(n => h('i', { style: { left: `calc(${(n.t0 / dur) * 100}% - 1px)`, background: labelById(n.labels[0]).color } }))) : null,
  );
  return h('a.pcard', { href: `#/p/${p.id}` },
    poster,
    h('div.body',
      h('h3', p.title),
      h('div.meta',
        ring(done, notes.length),
        h('div', { style: { display: 'grid', gap: '2px' } },
          h('span', { style: { color: 'var(--ink)' } }, v ? `V${v.number} · ${!notes.length ? 'правок пока нет' : open ? open + ' ' + plural(open, 'открытая', 'открытые', 'открытых') : 'всё закрыто'}` : 'Видео ещё не добавлено'),
          h('span', `обновлён ${relTime(p.updatedAt)}`)),
        h('div.grow'),
        p.deadline ? h('span', { title: 'Дедлайн', style: { display: 'flex', gap: '5px', alignItems: 'center' }, html: icon('clock', 14) + fmtDate(p.deadline) }) : null),
    ));
}

function ring(done, total) {
  const r = 14, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return h('span', { html: `<svg class="ring" viewBox="0 0 34 34" aria-label="Закрыто ${done} из ${total}"><circle cx="17" cy="17" r="${r}" fill="none" stroke="#D5D5CE" stroke-width="2"/><circle cx="17" cy="17" r="${r}" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 17 17)" stroke-linecap="round"/><text x="17" y="20.5" text-anchor="middle" font-family="Martian Mono, monospace" font-size="8.5" fill="#000">${total ? Math.round(f * 100) : '—'}</text></svg>` });
}

/** Схематичная заглушка в духе приборной графики */
function schematic(hasVideo) {
  return `<svg width="160" height="90" viewBox="0 0 160 90" fill="none" stroke="#85857C" stroke-width="1">
    <circle cx="52" cy="45" r="22"/><circle cx="52" cy="45" r="3" fill="#85857C"/><path d="M74 45h60M126 39l8 6-8 6"/>
    <path d="M30 45h-14M52 23V12M52 67v11" stroke-dasharray="2 3"/>
    <text x="80" y="36" font-family="Martian Mono, monospace" font-size="7" fill="#85857C" stroke="none">${hasVideo ? 'SOURCE / LINK' : 'NO SIGNAL'}</text>
    <text x="80" y="62" font-family="Martian Mono, monospace" font-size="7" fill="#85857C" stroke="none">${hasVideo ? 'ДИСК → ПЛЕЕР' : 'ДОБАВЬТЕ ВИДЕО'}</text>
  </svg>`;
}

function newCard() {
  if (!can.manageProject(me())) return '';
  return h('button.pcard.new', { onclick: openNewProject }, h('span.plus', { html: icon('plus', 20) }), 'Новый проект');
}

function openNewProject() {
  const title = h('input.input', { placeholder: 'Например: Выпуск #43 — обзор камер', autofocus: true });
  const deadline = h('input.input', { type: 'date' });
  const tpl = h('select.select', h('option', { value: 'youtube' }, 'YouTube-ролик'), h('option', { value: 'shorts' }, 'Shorts / Reels'), h('option', { value: 'ad' }, 'Рекламная интеграция'));
  modal({
    title: 'Новый проект',
    body: h('div', h('div.field', h('label', 'Название'), title), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, h('div.field', h('label', 'Дедлайн'), deadline), h('div.field', h('label', 'Формат'), tpl))),
    actions: [{ label: 'Отмена' }, {
      label: 'Создать и добавить видео', primary: true, onClick: () => {
        if (!title.value.trim()) { title.focus(); return false; }
        const p = createProject({ title: title.value, deadline: deadline.value, template: tpl.value });
        location.hash = `#/p/${p.id}`;
        setTimeout(() => openAddVersion(p, { onAdded: v => { location.hash = `#/p/${p.id}?v=${v.id}`; } }), 60);
      },
    }],
  });
}

function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => { try { const p = importProjectJson(t); toast(`Проект «${p.title}» импортирован`); } catch (err) { toast(err.message, 'error'); } });
  e.target.value = '';
}
