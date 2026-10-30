// Правая панель: правки (список, фильтры, тред), композер новой правки, главы YouTube, чеклист и сводка.
import { h, fill, icon, esc, relTime, popover, toast, modal, copyText, initials, tcShort, uid } from './util.js';
import {
  LABELS, labelById, STATUSES, statusById, PRIORITIES, KINDS, RESOLVED, userById, can, setStatus, updateNote, deleteNote,
  addReply, commit, touch, roleName, getState,
} from './store.js';
import { noteThumbSvg } from './shapes.js';

export function mountPanel(root, ctx) {
  const tabsEl = h('div.tabs', { role: 'tablist' });
  const body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } });
  root.append(tabsEl, body);
  let openId = null;       // раскрытая карточка
  let editingId = null;    // правка в режиме редактирования текста
  let listEl = null, composerEl = null;

  ctx.r.panel = () => {
    const vn = ctx.verNotes().filter(n => n.kind !== 'approval');
    const openCount = vn.filter(n => !RESOLVED.has(n.status)).length;
    fill(tabsEl, 
      tab('notes', 'Правки', openCount), tab('chapters', 'Главы', ctx.ver ? ctx.p.chapters.filter(c => c.versionId === ctx.ver.id).length : 0), tab('publish', 'Выпуск', null));
    if (ctx.tab === 'notes') renderNotes(); else if (ctx.tab === 'chapters') renderChapters(); else renderPublish();
  };
  function tab(id, name, count) {
    return h('button' + (ctx.tab === id ? '.on' : ''), { role: 'tab', 'aria-selected': String(ctx.tab === id), onclick: () => { ctx.tab = id; ctx.r.panel(); } }, name, count ? h('span.mono', String(count)) : null);
  }

  // ——— Вкладка «Правки» ———
  function renderNotes() {
    const vn = ctx.verNotes();
    const fixes = vn.filter(n => n.kind !== 'approval');
    const by = s => fixes.filter(n => n.status === s).length;
    const total = fixes.length || 1;
    const seg = (n, c) => n ? h('i', { style: { width: (n / total * 100) + '%', background: c } }) : null;
    const f = ctx.filters;
    const nf = f.labels.size + f.statuses.size + f.authors.size + f.priorities.size + (f.mine ? 1 : 0);
    const search = h('input.input', { placeholder: 'Поиск по правкам или #12', value: ctx.search, 'aria-label': 'Поиск по правкам' });
    search.addEventListener('input', () => { ctx.search = search.value; drawList(); ctx.render('timeline', 'overlay'); });

    const headEl = h('div.p-head',
      h('div.progress-row', h('div.bar', { title: 'Принято · Исправлено · В работе · Открыто' }, seg(by('accepted') + by('rejected'), '#000'), seg(by('fixed'), 'var(--ok)'), seg(by('progress'), 'var(--signal)'), seg(by('question'), '#E8A400')),
        h('span.mono', `${by('accepted') + by('rejected')}/${fixes.length}`)),
      h('div.counts',
        h('span', h('b', by('open')), 'открыто'), h('span', h('b', by('progress')), 'в работе'), by('question') ? h('span', h('b', by('question')), 'уточнить') : null,
        h('span', h('b', by('fixed')), 'исправлено'), h('span', h('b', by('accepted')), 'принято')),
      h('div.p-tools',
        h('div.search', { html: icon('search', 16) }, search),
        h('button.btn.sm' + (nf ? '.primary' : ''), { onclick: e => filterMenu(e.currentTarget), 'aria-label': 'Фильтры', html: icon('filter', 15) + (nf ? String(nf) : '') }),
        h('button.icon-btn', { title: 'Сортировка', 'aria-label': 'Сортировка', onclick: e => sortMenu(e.currentTarget), html: icon('list') }),
        h('button.btn.sm' + (ctx.showResolved ? '.primary' : ''), { title: 'Показывать принятые и отклонённые', onclick: () => { ctx.showResolved = !ctx.showResolved; ctx.render('panel', 'timeline', 'overlay'); }, html: icon('check', 15) }),
      ),
      nf ? h('div.active-filters',
        [...f.labels].map(id => fchip(labelById(id).name, () => f.labels.delete(id))),
        [...f.statuses].map(id => fchip(statusById(id).name, () => f.statuses.delete(id))),
        [...f.authors].map(id => fchip(userById(id)?.name.split(' ')[0] || '?', () => f.authors.delete(id))),
        [...f.priorities].map(id => fchip(PRIORITIES.find(p => p.id === id).name, () => f.priorities.delete(id))),
        f.mine ? fchip('Мои', () => f.mine = false) : null,
        h('button.btn.sm.ghost', { onclick: () => { f.labels.clear(); f.statuses.clear(); f.authors.clear(); f.priorities.clear(); f.mine = false; ctx.render('panel', 'timeline', 'overlay'); } }, 'Сбросить')) : null,
    );
    listEl = h('div.list', { role: 'list' });
    composerEl = h('div.composer');
    fill(body, headEl, listEl, composerEl);
    drawList();
    ctx.r.composer();
  }
  function fchip(text, remove) { return h('button.chip.on', { onclick: () => { remove(); ctx.render('panel', 'timeline', 'overlay'); }, 'aria-label': `Убрать фильтр ${text}` }, text, h('span', { html: icon('x', 12) })); }

  function sorted() {
    const list = ctx.filtered();
    const pr = { critical: 0, important: 1, wish: 2 };
    if (ctx.sort === 'created') return list.sort((a, b) => b.createdAt - a.createdAt);
    if (ctx.sort === 'priority') return list.sort((a, b) => pr[a.priority] - pr[b.priority] || a.t0 - b.t0);
    return list.sort((a, b) => a.t0 - b.t0);
  }

  function drawList() {
    if (!listEl) return;
    const list = sorted();
    if (!ctx.ver) { fill(listEl, h('div.empty', 'Правки появятся после того, как вы добавите видео.')); return; }
    if (!list.length) {
      const any = ctx.verNotes().length;
      fill(listEl, h('div.empty', { html: '<svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="#85857C"><circle cx="36" cy="36" r="27"/><path d="M24 37l8 8 16-18"/></svg>' },
        h('div', any ? 'По этим условиям правок нет.' : 'Правок пока нет.'),
        h('div', any ? 'Сбросьте фильтры или включите показ принятых.' : 'Поставьте видео на паузу и нажмите C — или обведите зону в кадре инструментом слева.')));
      return;
    }
    fill(listEl, ...list.map(card));
    ctx.r.live();
  }

  function card(n) {
    const u = userById(n.authorId);
    const lbl = labelById(n.labels[0]);
    const isOpen = openId === n.id || ctx.sel === n.id;
    const resolved = RESOLVED.has(n.status);
    const range = n.t1 > n.t0 + 0.05;
    const cls = ['card', isOpen && 'open', ctx.sel === n.id && 'sel', resolved && 'resolved'].filter(Boolean).join('.');
    const el = h('article.' + cls, { role: 'listitem', dataset: { id: n.id, t0: n.t0, t1: range ? n.t1 : n.t0 + 0.6 }, style: { '--c': lbl.color }, tabindex: '0', 'aria-label': `Правка #${n.seq}` },
      h('div.row1',
        h('span.seq', `#${n.seq}`),
        h('button.tcb', { title: 'Перейти к кадру', onclick: e => { e.stopPropagation(); ctx.select(n.id); } }, ctx.tc(n.t0) + (range ? ' → ' + ctx.tc(n.t1) : '')),
        n.kind === 'question' ? h('span.chip', { style: { height: '20px' } }, 'вопрос') : n.kind === 'approval' ? h('span.chip', { style: { height: '20px' } }, 'одобрение') : null,
        n.visibility === 'team' ? h('span.priv', { title: 'Видит только команда', html: icon('lock', 13) }) : null,
        h('div.grow'),
        h('span.when', relTime(n.updatedAt || n.createdAt))),
      (n.shapes.length || n.snap) ? h('div.thumbw', { html: noteThumbSvg(n, ctx.aspect(), 192) }) : null,
      editingId === n.id ? editBox(n) : h('div.txt', { html: richText(n.text) }),
      h('div.row3',
        h('span.who2', h('span.avatar.sm', { style: { '--c': u?.color || '#888' } }, initials(u?.name || 'Г')), u?.name.split(' ')[0] || 'Гость'),
        n.labels.map(l => h('span.chip.lbl.on', { style: { '--c': labelById(l).color, height: '20px', fontSize: '11.5px' } }, h('span.dot'), labelById(l).name)),
        n.priority && n.priority !== 'important' && PRIORITIES.some(p => p.id === n.priority) ? h('span.prio.' + n.priority, PRIORITIES.find(p => p.id === n.priority).name) : null,
        h('div', { style: { flex: 1 } }),
        n.replies.length ? h('span.priv', { html: icon('chat', 13) + n.replies.length }) : null,
        statusButton(n)),
      isOpen ? thread(n) : null,
    );
    el.addEventListener('click', e => { if (e.target.closest('button, input, textarea, a, select, .thread')) return; openId = n.id; ctx.select(n.id); });
    el.addEventListener('mouseenter', () => { ctx.hover = n.id; ctx.r.overlay(); });
    el.addEventListener('mouseleave', () => { ctx.hover = null; ctx.r.overlay(); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) { openId = n.id; ctx.select(n.id); } });
    return el;
  }

  function richText(t) {
    return esc(t).replace(/(^|\s)@([\wА-Яа-яЁё]+)/g, '$1<b>@$2</b>').replace(/\n/g, '<br>');
  }

  function statusButton(n) {
    const allowed = can.statuses(ctx.u(), n);
    const s = statusById(n.status);
    const btn = h('button.stbtn.st-' + n.status, { 'aria-label': `Статус: ${s.name}`, disabled: allowed.length < 2 && allowed[0] === n.status,
      onclick: e => {
        e.stopPropagation();
        const { pop } = popover(e.currentTarget, [h('div.menu-title', 'Статус правки'), ...STATUSES.filter(x => allowed.includes(x.id)).map(x =>
          h('button.menu-item.st-' + x.id, { onclick: () => { pop.close(); changeStatus(n, x.id); } }, h('span.stbtn.st-' + x.id, { style: { border: 0, padding: 0 } }, h('span.dot')), x.name, x.id === n.status ? h('span.sub', { html: icon('check', 14) }) : null)),
          allowed.length < STATUSES.length ? h('div.menu-title', { style: { maxWidth: '230px', whiteSpace: 'normal' } }, roleHint(ctx.u().role)) : null], { align: 'right' });
      } }, h('span.dot'), s.short);
    return btn;
  }
  function roleHint(role) {
    return role === 'editor' ? 'Монтажёр отмечает «Исправлено». Принимает правку автор или продюсер.' : role === 'client' ? 'Вы можете принять исправленную правку или вернуть её в работу.' : '';
  }
  function changeStatus(n, s) {
    if (s === 'rejected') {
      const reason = h('textarea.textarea', { placeholder: 'Почему не делаем эту правку', autofocus: true });
      modal({ title: `Отклонить правку #${n.seq}`, body: h('div.field', reason), actions: [{ label: 'Отмена' }, { label: 'Отклонить', danger: true, onClick: () => {
        if (!reason.value.trim()) { reason.focus(); return false; }
        addReply(ctx.p, n, 'Отклонено: ' + reason.value.trim()); setStatus(ctx.p, n, 'rejected'); toast(`#${n.seq} отклонена`);
      } }] });
      return;
    }
    setStatus(ctx.p, n, s);
    toast(`#${n.seq}: ${statusById(s).name}`);
  }

  function thread(n) {
    const u = ctx.u();
    const inp = h('input.input', { placeholder: 'Ответить… (@имя — упомянуть)', 'aria-label': 'Ответ' });
    const send = () => { const t = inp.value.trim(); if (!t) return; addReply(ctx.p, n, t); inp.value = ''; };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') send(); if (e.key === 'Escape') inp.blur(); });
    return h('div.thread',
      n.replies.map(r => { const a = userById(r.authorId); return h('div.reply', h('span.avatar.sm', { style: { '--c': a?.color || '#888' } }, initials(a?.name || 'Г')),
        h('div', h('div.n', a?.name || 'Гость', h('span', relTime(r.at))), h('div', { html: richText(r.text) }))); }),
      h('div.reply-form', inp, h('button.btn.sm', { onclick: send }, 'Отправить')),
      h('div.card-actions',
        can.edit(u, n) ? h('button.btn.sm.ghost', { onclick: () => { editingId = n.id; drawList(); } }, 'Изменить текст') : null,
        n.t1 > n.t0 + 0.05 ? h('button.btn.sm.ghost', { onclick: () => { ctx.select(n.id); ctx.loop = true; ctx.video.play(); ctx.render('transport'); }, html: icon('loop', 14) + 'Повтор' }) : null,
        h('button.btn.sm.ghost', { onclick: async () => { await copyText(`${location.href.split('#')[0]}#/p/${ctx.p.id}?v=${n.versionId}&n=${n.id}`); toast('Ссылка на правку скопирована'); }, html: icon('link', 14) + 'Ссылка' }),
        can.edit(u, n) ? h('button.btn.sm.ghost.danger', { onclick: () => modal({ title: `Удалить правку #${n.seq}?`, body: h('p', 'Правка и её обсуждение удалятся без возможности восстановления.'), actions: [{ label: 'Отмена' }, { label: 'Удалить', danger: true, onClick: () => { deleteNote(ctx.p, n); ctx.sel = null; toast(`#${n.seq} удалена`); } }] }), html: icon('trash', 14) + 'Удалить' }) : null,
      ),
      n.events.length ? h('details.history', h('summary', `История · ${n.events.length}`), n.events.slice().reverse().map(e => h('div', `${new Date(e.at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${e.by || ''} — ${e.text}`))) : null,
    );
  }

  function editBox(n) {
    const ta = h('textarea.textarea', { 'aria-label': 'Текст правки' }, n.text);
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') { editingId = null; drawList(); } });
    const save = () => { const t = ta.value.trim(); editingId = null; if (t && t !== n.text) updateNote(ctx.p, n, { text: t }, 'Текст изменён'); else drawList(); };
    setTimeout(() => ta.focus(), 0);
    return h('div', { style: { margin: '8px 0', display: 'grid', gap: '6px' } }, ta, h('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
      h('button.btn.sm.ghost', { onclick: () => { editingId = null; drawList(); } }, 'Отмена'), h('button.btn.sm.primary', { onclick: save }, 'Сохранить')));
  }

  function filterMenu(anchor) {
    const f = ctx.filters;
    const tog = (set, id) => () => { set.has(id) ? set.delete(id) : set.add(id); ctx.render('panel', 'timeline', 'overlay'); filterMenu(anchor); };
    const authors = [...new Set(ctx.verNotes().map(n => n.authorId))].map(userById).filter(Boolean);
    popover(anchor, h('div', { style: { padding: '6px', display: 'grid', gap: '10px', width: '300px' } },
      h('div', h('div.section-t', 'Ярлык'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' } },
        LABELS.map(l => h('button.chip.lbl' + (f.labels.has(l.id) ? '.on' : ''), { style: { '--c': l.color }, onclick: tog(f.labels, l.id) }, h('span.dot'), l.name)))),
      h('div', h('div.section-t', 'Статус'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' } },
        STATUSES.map(s => h('button.chip' + (f.statuses.has(s.id) ? '.on' : ''), { onclick: tog(f.statuses, s.id) }, s.name)))),
      h('div', h('div.section-t', 'Приоритет'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' } },
        PRIORITIES.map(s => h('button.chip' + (f.priorities.has(s.id) ? '.on' : ''), { onclick: tog(f.priorities, s.id) }, s.name)))),
      h('div', h('div.section-t', 'Автор'), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' } },
        authors.map(a => h('button.chip' + (f.authors.has(a.id) ? '.on' : ''), { onclick: tog(f.authors, a.id) }, a.name.split(' ')[0])),
        h('button.chip' + (f.mine ? '.on' : ''), { onclick: () => { f.mine = !f.mine; ctx.render('panel', 'timeline', 'overlay'); filterMenu(anchor); } }, 'Только мои'))),
    ), { align: 'right' });
  }
  function sortMenu(anchor) {
    const { pop } = popover(anchor, [h('div.menu-title', 'Сортировка'), ...[['time', 'По таймкоду'], ['created', 'Сначала новые'], ['priority', 'По приоритету']].map(([id, name]) =>
      h('button.menu-item', { onclick: () => { ctx.sort = id; pop.close(); drawList(); } }, name, ctx.sort === id ? h('span.sub', { html: icon('check', 14) }) : null))], { align: 'right' });
  }

  // Подсветка правок, которые сейчас в кадре
  ctx.r.live = () => {
    if (!listEl) return;
    const t = ctx.t();
    for (const c of listEl.children) if (c.dataset?.t0) c.classList.toggle('live', t >= +c.dataset.t0 - 0.05 && t <= +c.dataset.t1);
  };
  ctx.on.scrollToSel = () => {
    const n = ctx.sel && ctx.note(ctx.sel);
    if (n) ctx.on.scrollMarker?.(n);
    requestAnimationFrame(() => listEl?.querySelector('.card.sel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  // ——— Композер ———
  let recog = null;
  ctx.r.composer = () => {
    if (!composerEl || ctx.tab !== 'notes') return;
    const d = ctx.draft;
    if (!ctx.ver) { fill(composerEl, ); return; }
    if (!d) {
      const ta = h('textarea.textarea', { rows: 1, placeholder: `Правка к ${ctx.tc(ctx.t())} · нажмите C`, style: { minHeight: '40px', resize: 'none' }, 'aria-label': 'Новая правка' });
      ta.addEventListener('focus', () => { ctx.startDraft(ctx.t()); ctx.focusComposer(); });
      composerEl.className = 'composer';
      fill(composerEl, ta);
      return;
    }
    composerEl.className = 'composer active';
    const range = d.t1 > d.t0 + 0.05;
    const ta = h('textarea.textarea', { placeholder: 'Что исправить? Например: «убрать паузу перед фразой», @Артём — упомянуть', 'aria-label': 'Текст правки' }, d.text);
    ta.addEventListener('input', () => { d.text = ta.value; });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ctx.saveDraft(); }
      if (e.key === 'Escape') { e.preventDefault(); ctx.cancelDraft(); }
      e.stopPropagation();
    });
    const u = ctx.u();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    fill(composerEl, 
      h('div.c-head',
        h('span.tcpill' + (range ? '.range' : ''), ctx.tc(d.t0) + (range ? ' → ' + ctx.tc(d.t1) : '')),
        h('button.btn.sm.ghost', { title: 'Начало диапазона по плейхеду · I', onclick: () => { d.t0 = ctx.t(); if (d.t1 < d.t0) d.t1 = d.t0; ctx.render('composer', 'timeline'); } }, 'I'),
        h('button.btn.sm.ghost', { title: 'Конец диапазона по плейхеду · O', onclick: () => { d.t1 = Math.max(ctx.t(), d.t0); ctx.render('composer', 'timeline'); } }, 'O'),
        d.shapes.length ? h('span.chip', `${d.shapes.length} ${d.shapes.length === 1 ? 'фигура' : d.shapes.length < 5 ? 'фигуры' : 'фигур'}`, h('button', { style: { border: 0, background: 'none', padding: 0, display: 'flex' }, 'aria-label': 'Убрать фигуры', onclick: () => { d.shapes = []; ctx.render('composer', 'overlay', 'tools'); }, html: icon('x', 12) })) : h('span.muted', { style: { fontSize: '12px' } }, 'обведите зону в кадре'),
        h('div.grow'),
        h('button.icon-btn', { 'aria-label': 'Отменить черновик (Esc)', title: 'Отменить · Esc', onclick: ctx.cancelDraft, html: icon('x', 16) })),
      ta,
      h('div.lbls', LABELS.map(l => h('button.chip.lbl' + (d.labels.includes(l.id) ? '.on' : ''), { style: { '--c': l.color }, onclick: () => {
        d.labels = d.labels.includes(l.id) ? d.labels.filter(x => x !== l.id) : [...d.labels, l.id];
        if (d.labels[0]) { ctx.color = labelById(d.labels[0]).color; d.shapes.forEach(s => s.color = ctx.color); }
        ctx.render('composer', 'timeline', 'overlay', 'tools');
      } }, h('span.dot'), l.name))),
      h('div.c-foot',
        h('div.seg', { role: 'group', 'aria-label': 'Приоритет' }, PRIORITIES.map(p => h('button' + (d.priority === p.id ? '.on' : ''), { onclick: () => { d.priority = p.id; ctx.r.composer(); } }, p.name))),
        h('select.select', { style: { width: 'auto', height: '30px', fontSize: '12.5px' }, 'aria-label': 'Тип', onchange: e => { d.kind = e.target.value; } }, KINDS.map(k => h('option', { value: k.id, selected: d.kind === k.id }, k.name))),
        can.seePrivate(u) ? h('button.icon-btn' + (d.visibility === 'team' ? '.on' : ''), { title: d.visibility === 'team' ? 'Видит только команда' : 'Видят все, включая заказчика', 'aria-label': 'Только для команды', onclick: () => { d.visibility = d.visibility === 'team' ? 'all' : 'team'; ctx.r.composer(); }, html: icon(d.visibility === 'team' ? 'lock' : 'eye', 16) }) : null,
        SR ? h('button.icon-btn' + (recog ? '.mic-on' : ''), { title: 'Надиктовать правку', 'aria-label': 'Надиктовать', onclick: () => toggleMic(SR), html: icon('mic', 16) }) : null,
        h('div.grow'),
        h('button.btn.sm.primary', { onclick: ctx.saveDraft }, 'Добавить правку'),
      ),
    );
  };
  ctx.focusComposer = () => {
    if (ctx.tab !== 'notes') { ctx.tab = 'notes'; ctx.r.panel(); }
    requestAnimationFrame(() => { const ta = composerEl?.querySelector('textarea'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } });
  };
  function toggleMic(SR) {
    if (recog) { recog.stop(); recog = null; ctx.r.composer(); return; }
    recog = new SR(); recog.lang = 'ru-RU'; recog.continuous = true; recog.interimResults = false;
    recog.onresult = e => {
      const txt = [...e.results].slice(e.resultIndex).map(r => r[0].transcript).join(' ').trim();
      if (ctx.draft && txt) { ctx.draft.text = (ctx.draft.text ? ctx.draft.text + ' ' : '') + txt; const ta = composerEl.querySelector('textarea'); if (ta) ta.value = ctx.draft.text; }
    };
    recog.onend = () => { recog = null; ctx.r.composer(); };
    recog.onerror = () => { toast('Микрофон недоступен — разрешите доступ в браузере', 'error'); };
    recog.start(); ctx.r.composer();
  }

  // ——— Вкладка «Главы» ———
  function renderChapters() {
    composerEl = null; listEl = null;
    if (!ctx.ver) { fill(body, h('div.empty', 'Сначала добавьте видео.')); return; }
    const chs = ctx.p.chapters.filter(c => c.versionId === ctx.ver.id).sort((a, b) => a.t - b.t);
    const editable = ctx.u().role !== 'client';
    const issues = [];
    if (chs.length && chs[0].t > 0.5) issues.push('Первая глава должна начинаться с 0:00.');
    if (chs.length && chs.length < 3) issues.push('YouTube показывает главы, если их не меньше трёх.');
    chs.forEach((c, i) => { if (chs[i + 1] && chs[i + 1].t - c.t < 10) issues.push(`«${c.title}» короче 10 секунд — YouTube не примет.`); });
    const yt = chs.map(c => `${tcShort(c.t)} ${c.title}`).join('\n');
    fill(body, h('div.side-pad',
      h('p.muted', { style: { margin: 0, fontSize: '13px' } }, 'Отметьте главы — получите готовый блок таймкодов для описания ролика. Главы видны на шкале таймлайна.'),
      ...chs.map(c => h('div.chap-row',
        h('button.tcb', { onclick: () => ctx.seek(c.t), title: 'Перейти' }, tcShort(c.t)),
        h('input.input', { value: c.title, disabled: !editable, 'aria-label': 'Название главы', onchange: e => { c.title = e.target.value.trim() || c.title; touch(ctx.p); commit(); }, onkeydown: e => e.stopPropagation() }),
        editable ? h('button.icon-btn', { 'aria-label': 'Удалить главу', onclick: () => { ctx.p.chapters = ctx.p.chapters.filter(x => x !== c); touch(ctx.p); commit(); }, html: icon('trash', 16) }) : h('span'))),
      editable ? h('button.btn', { onclick: () => { ctx.p.chapters.push({ id: uid('ch'), versionId: ctx.ver.id, t: Math.floor(ctx.t()), title: 'Новая глава' }); touch(ctx.p); commit(); }, html: icon('flag', 16) + `Глава на ${tcShort(ctx.t())}` }) : null,
      chs.length ? h('div', { style: { display: 'grid', gap: '6px', marginTop: '8px' } }, h('div.section-t', 'Для описания на YouTube'), h('div.code', yt),
        h('button.btn.sm', { onclick: async () => { await copyText(yt); toast('Таймкоды скопированы'); } }, 'Скопировать таймкоды')) : null,
      issues.length ? h('div', { style: { color: 'var(--danger)', fontSize: '12.5px', display: 'grid', gap: '4px' } }, issues.map(i => h('div', i))) : null,
    ));
  }

  // ——— Вкладка «Выпуск»: утверждение, сводка, чеклист ———
  function renderPublish() {
    composerEl = null; listEl = null;
    const u = ctx.u();
    const v = ctx.ver;
    const vn = ctx.verNotes().filter(n => n.kind !== 'approval');
    const open = vn.filter(n => !RESOLVED.has(n.status));
    const crit = open.filter(n => n.priority === 'critical');
    const byLabel = LABELS.map(l => [l, open.filter(n => n.labels[0] === l.id).length]).filter(([, c]) => c);
    const summary = v ? [
      `${ctx.p.title} — V${v.number}`,
      `Открыто правок: ${open.length} (критичных: ${crit.length}), исправлено и ждёт проверки: ${vn.filter(n => n.status === 'fixed').length}, принято: ${vn.filter(n => n.status === 'accepted').length}.`,
      byLabel.length ? 'По категориям: ' + byLabel.map(([l, c]) => `${l.name.toLowerCase()} — ${c}`).join(', ') + '.' : '',
      crit.length ? 'Критично:\n' + crit.map(n => `• #${n.seq} ${tcShort(n.t0)} — ${n.text}`).join('\n') : '',
    ].filter(Boolean).join('\n') : '';
    const cl = ctx.p.checklist;
    const editable = u.role !== 'client';
    const add = h('input.input', { placeholder: 'Добавить пункт', onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.value.trim()) { cl.push({ id: uid('c'), title: e.target.value.trim(), done: false }); touch(ctx.p); commit(); } } });
    fill(body, h('div.side-pad',
      v ? h('div', { style: { display: 'grid', gap: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '12px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('b.mono', `V${v.number}`), h('span', v.status), v.approvedBy && v.status === 'Утверждена' ? h('span.muted', `· утвердил ${v.approvedBy}`) : null),
        v.status === 'Утверждена' ? h('div', { style: { color: 'var(--ok)', fontWeight: 500 } }, 'Версия утверждена как финальная.')
          : can.approveVersion(u) ? h('button.btn.primary', { disabled: false, onclick: () => { const sel = document.querySelector('.topbar select[aria-label="Статус версии"]'); if (sel) { sel.value = 'Утверждена'; sel.dispatchEvent(new Event('change')); } }, html: icon('check', 16) + 'Утвердить версию' })
            : h('div.muted', { style: { fontSize: '13px' } }, 'Утверждает продюсер или заказчик.'),
        crit.length ? h('div', { style: { fontSize: '12.5px', color: 'var(--danger)' } }, `Открытых критичных правок: ${crit.length}`) : null) : null,
      v ? h('div', { style: { display: 'grid', gap: '6px' } }, h('div.section-t', 'Сводка для монтажёра'), h('div.code', summary),
        h('button.btn.sm', { onclick: async () => { await copyText(summary); toast('Сводка скопирована'); } }, 'Скопировать сводку')) : null,
      h('div.section-t', `Чеклист публикации · ${cl.filter(c => c.done).length}/${cl.length}`),
      ...cl.map(c => h('label.check-row' + (c.done ? '.done' : ''),
        h('input', { type: 'checkbox', checked: c.done, disabled: !editable, onchange: e => { c.done = e.target.checked; touch(ctx.p); commit(); } }), h('span', c.title))),
      editable ? add : null,
    ));
  }

  return { unmount() { recog?.stop(); } };
}
