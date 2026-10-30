// Экран «Ревью»: плеер + холст правок, инструменты, транспорт, верхняя панель.
import { h, fill, $, icon, tc, clamp, toast, modal, popover, initials, logoSvg, uid, copyText, esc, themeIcons } from './util.js';
import { toggleTheme } from './theme.js';
import {
  getProject, me, can, commit, LABELS, labelById, RESOLVED, STAGES, VERSION_STATUSES, addNote, updateNote,
  roleName, getState, touch, ev, PRIORITIES,
} from './store.js';
import { playableUrl, explainMediaError, registerLocalFile, attachHls } from './sources.js';
import { shapeSvg, HATCH_DEF, hitShape, moveShape } from './shapes.js';
import { mountTimeline } from './timeline.js';
import { mountPanel } from './panel.js';
import { openAddVersion, openIdentity, openRelinkVersion, openImportNotes, openDeleteProject } from './versions.js';
import { openExportMenu, openCompare } from './export.js';

const TOOLS = [
  { id: 'cursor', name: 'Выбор и перемещение', key: 'V' },
  { id: 'pin', name: 'Пин', key: 'P' },
  { id: 'rect', name: 'Рамка', key: 'R' },
  { id: 'ellipse', name: 'Эллипс', key: 'E' },
  { id: 'arrow', name: 'Стрелка', key: 'A' },
  { id: 'brush', name: 'Кисть', key: 'B' },
  { id: 'text', name: 'Текст в кадре', key: 'T' },
  { id: 'blur', name: 'Зона размытия', key: 'M' },
];
const GUIDES = [
  { id: 'off', name: 'Без направляющих' },
  { id: 'safe', name: 'Безопасные зоны YouTube' },
  { id: 'thirds', name: 'Сетка третей' },
  { id: 'shorts', name: 'Маска Shorts 9:16' },
];
const SWATCHES = ['#E5484D', '#F2711C', '#D9A400', '#22A06B', '#12A5A5', '#3546E0', '#8E4EC6', '#D6409F', '#FFFFFF', '#000000'];

export function mountReview(root, project, query = {}) {
  const st = getState();
  const ctx = {
    p: project, ver: null, video: null,
    sel: null, hover: null, tool: 'cursor', color: '#E5484D', draft: null,
    tcMode: st.prefs.tcMode || 'frames', guides: 'off', group: st.prefs.group || 'label', zoom: 1,
    filters: { labels: new Set(), statuses: new Set(), authors: new Set(), priorities: new Set(), mine: false },
    showResolved: false, sort: 'time', search: '', tab: "notes", loop: false, r: {}, on: {}, mediaReady: false,
  };
  ctx.u = () => me();
  ctx.fps = () => ctx.ver?.fps || 25;
  ctx.dur = () => (ctx.video && isFinite(ctx.video.duration) && ctx.video.duration) || ctx.ver?.duration || 0;
  ctx.t = () => ctx.video?.currentTime || 0;
  ctx.aspect = () => (ctx.ver?.width && ctx.ver?.height) ? ctx.ver.width / ctx.ver.height : 16 / 9;
  ctx.tc = (t) => tc(t, ctx.fps(), ctx.tcMode);
  ctx.verNotes = () => ctx.ver ? ctx.p.notes.filter(n => n.versionId === ctx.ver.id && (n.visibility !== 'team' || can.seePrivate(ctx.u()))) : [];
  ctx.filtered = () => {
    const f = ctx.filters, q = ctx.search.trim().toLowerCase(), u = ctx.u();
    return ctx.verNotes().filter(n =>
      (ctx.showResolved || !RESOLVED.has(n.status) || n.id === ctx.sel) &&
      (!f.labels.size || n.labels.some(l => f.labels.has(l))) &&
      (!f.statuses.size || f.statuses.has(n.status)) &&
      (!f.authors.size || f.authors.has(n.authorId)) &&
      (!f.priorities.size || f.priorities.has(n.priority)) &&
      (!f.mine || n.authorId === u.id) &&
      (!q || n.text.toLowerCase().includes(q) || ('#' + n.seq) === q || n.replies.some(r => r.text.toLowerCase().includes(q))));
  };
  ctx.note = id => ctx.p.notes.find(n => n.id === id);
  ctx.render = (...parts) => { for (const k of (parts.length ? parts : Object.keys(ctx.r))) ctx.r[k]?.(); };

  // ——— Разметка ———
  const el = h('div.review');
  root.append(el);
  const top = h('header.topbar');
  const tools = h('nav.tools', { 'aria-label': 'Инструменты рисования' });
  const viewport = h('div.viewport');
  const transport = h('div.transport');
  const stage = h('main.stage', viewport, transport);
  const tlEl = h('section.timeline', { 'aria-label': 'Таймлайн правок' });
  const panelEl = h('aside.panel', { 'aria-label': 'Правки' });
  el.append(top, tools, stage, tlEl, panelEl);

  const video = h('video', { playsinline: true, preload: 'auto' });
  ctx.video = video;
  const guidesEl = h('div.guides');
  const svgNS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.classList.add('overlay');
  const stateEl = h('div.state');
  const hud = h('div.hud');
  viewport.append(video, guidesEl, overlay, hud, stateEl);

  // ——— Верхняя панель ———
  ctx.r.top = () => {
    const u = ctx.u(), v = ctx.ver;
    const title = h('div.title', { contenteditable: can.manageProject(u) ? 'plaintext-only' : 'false', spellcheck: 'false', title: 'Название проекта' }, ctx.p.title);
    title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } e.stopPropagation(); });
    title.addEventListener('blur', () => { const t = title.textContent.trim(); if (t && t !== ctx.p.title) { ctx.p.title = t; touch(ctx.p); commit(); } });
    const vbtn = h('button.vsel', { onclick: e => versionMenu(e.currentTarget), 'aria-label': 'Версия' },
      v ? [h('b', `V${v.number}`), h('span', v.title || 'без названия')] : h('span', 'Нет видео'), h('span', { html: icon('back', 12), style: { transform: 'rotate(-90deg)' } }));
    const vstat = v ? h('select.select.hide-sm', { style: { width: 'auto', height: '30px', fontSize: '12.5px' }, 'aria-label': 'Статус версии', disabled: !can.approveVersion(u),
      onchange: e => setVersionStatus(e.target.value) }, VERSION_STATUSES.map(s => h('option', { selected: v.status === s }, s))) : null;
    const others = st.users.filter(x => x.id !== u.id);
    fill(top, 
      h('a.icon-btn', { href: '#/reviews', 'aria-label': 'К проектам', html: icon('back') }),
      h('a', { href: '#/', html: logoSvg(24), class: 'hide-sm', 'aria-hidden': 'true', tabindex: '-1' }),
      title, vbtn, vstat,
      h('select.select.hide-md', { style: { width: 'auto', height: '30px', fontSize: '12.5px' }, 'aria-label': 'Этап проекта', disabled: !can.manageProject(u),
        onchange: e => { ctx.p.stage = e.target.value; touch(ctx.p); commit(); } }, STAGES.map(s => h('option', { selected: ctx.p.stage === s }, s))),
      h('div.grow'),
      h('div.online.hide-md', { title: 'Участники проекта' }, others.map(x => h('span.avatar', { style: { '--c': x.color }, title: `${x.name} · ${roleName(x.role)}` }, initials(x.name)))),
      ctx.p.versions.length > 1 ? h('button.btn.sm.hide-sm', { onclick: () => openCompare(ctx), html: icon('compare', 16) + 'Сравнить' }) : null,
      h('button.btn.sm.hide-sm', { onclick: e => openExportMenu(e.currentTarget, ctx), html: icon('download', 16) + 'Экспорт' }),
      h('button.btn.sm.primary', { onclick: openShare, html: icon('share', 16) + '<span class="hide-sm">Поделиться</span>' }),
      h('button.icon-btn.hide-sm', { onclick: openKeys, 'aria-label': 'Горячие клавиши', title: 'Горячие клавиши (?)', html: icon('keyboard') }),
      h('button.icon-btn.theme-btn.hide-sm', { onclick: toggleTheme, 'aria-label': 'Переключить тему', title: 'Светлая / тёмная тема', html: themeIcons() }),
      can.manageProject(u) ? h('button.icon-btn.hide-sm', { onclick: () => openDeleteProject(ctx.p, { onDone: () => { location.hash = '#/reviews'; } }), 'aria-label': 'Удалить проект', title: 'Удалить проект', html: icon('trash') }) : null,
      h('button.who', { onclick: openIdentity, title: `${u.name} · ${roleName(u.role)} — сменить` }, h('span.avatar', { style: { '--c': u.color } }, initials(u.name)), h('span.r.hide-sm', roleName(u.role))),
    );
  };

  function versionMenu(anchor) {
    const items = [...ctx.p.versions].reverse().map(v => {
      const open = ctx.p.notes.filter(n => n.versionId === v.id && !RESOLVED.has(n.status)).length;
      return h('button.menu-item', { onclick: () => { pop.close(); switchVersion(v.id); } },
        h('b.mono', `V${v.number}`), h('span', v.title || 'без названия'), h('span.sub', v.id === ctx.ver?.id ? 'открыта' : `${v.status} · ${open} откр.`));
    });
    const { pop } = popover(anchor, [h('div.menu-title', 'Версии ролика'), ...items, h('div.menu-sep'),
      can.addVersion(ctx.u()) && ctx.ver ? h('button.menu-item', { onclick: () => { pop.close(); openRelinkVersion(ctx.p, ctx.ver, { onDone: () => { retried = null; loadVersion(); } }); }, html: icon('link', 16) + (ctx.ver.sourceType === 'file' ? `Ссылка на облако для V${ctx.ver.number}` : `Заменить ссылку V${ctx.ver.number}`) }) : null,
      can.addVersion(ctx.u()) && ctx.ver ? h('button.menu-item', { onclick: () => { pop.close(); openImportNotes(ctx.p, ctx.ver, { onDone: () => ctx.render() }); }, html: icon('download', 16) + `Перенести правки в V${ctx.ver.number}…` }) : null,
      can.addVersion(ctx.u()) ? h('button.menu-item', { onclick: () => { pop.close(); openAddVersion(ctx.p, { onAdded: v => switchVersion(v.id) }); }, html: icon('plus', 16) + 'Новая версия' }) : h('div.menu-title', 'Версии добавляет монтажёр'),
      can.manageProject(ctx.u()) ? h('div.menu-sep') : null,
      can.manageProject(ctx.u()) ? h('button.menu-item', { style: { color: 'var(--danger)' }, onclick: () => { pop.close(); openDeleteProject(ctx.p, { onDone: () => { location.hash = '#/reviews'; } }); }, html: icon('trash', 16) + 'Удалить проект' }) : null]);
  }

  function setVersionStatus(s) {
    const v = ctx.ver;
    if (s === 'Утверждена') {
      const crit = ctx.p.notes.filter(n => n.versionId === v.id && n.priority === 'critical' && !RESOLVED.has(n.status));
      if (crit.length) {
        modal({ title: 'Есть открытые критичные правки', body: h('div', h('p', 'Перед утверждением закройте или отклоните:'), h('ul', crit.map(n => h('li', `#${n.seq} · ${ctx.tc(n.t0)} — ${n.text}`)))),
          actions: [{ label: 'Вернуться к правкам', primary: true }, { label: 'Утвердить всё равно', danger: true, onClick: () => { v.status = s; v.approvedBy = ctx.u().name; touch(ctx.p); commit(); toast(`V${v.number} утверждена`); } }] });
        ctx.r.top();
        return;
      }
      v.approvedBy = ctx.u().name;
    }
    v.status = s; touch(ctx.p); commit(); toast(`Статус V${v.number}: ${s}`);
  }

  // ——— Инструменты ———
  ctx.r.tools = () => {
    fill(tools, 
      ...TOOLS.map(t => h('button.icon-btn' + (ctx.tool === t.id ? '.on' : ''), { 'aria-label': `${t.name} (${t.key})`, title: `${t.name} · ${t.key}`, 'data-key': t.key, 'aria-pressed': String(ctx.tool === t.id), onclick: () => setTool(t.id), html: icon(t.id) })),
      h('div.sep'),
      h('button.icon-btn', { 'aria-label': 'Цвет фигуры', title: 'Цвет фигуры', onclick: e => colorMenu(e.currentTarget) }, h('span.swatch', { style: { background: ctx.color } })),
      h('button.icon-btn', { 'aria-label': 'Отменить фигуру (Ctrl+Z)', title: 'Отменить фигуру · Ctrl+Z', disabled: !ctx.draft?.shapes.length, onclick: undoShape, html: icon('undo') }),
      h('div.sep'),
      h('button.icon-btn' + (ctx.guides !== 'off' ? '.on' : ''), { 'aria-label': 'Направляющие (G)', title: 'Направляющие · G', onclick: e => guidesMenu(e.currentTarget), html: icon('grid') }),
    );
  };
  ctx.setTool = setTool;
  function setTool(id) {
    ctx.tool = id;
    viewport.classList.toggle('drawing', id !== 'cursor');
    if (id !== 'cursor') video.pause();
    ctx.render('tools');
  }
  function colorMenu(anchor) {
    const { pop } = popover(anchor, h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: '6px', padding: '6px' } },
      SWATCHES.map(c => h('button', { 'aria-label': c, style: { width: '28px', height: '28px', borderRadius: '50%', background: c, border: c === ctx.color ? '2px solid #000' : '1px solid #ccc' },
        onclick: () => { ctx.color = c; if (ctx.draft) ctx.draft.shapes.forEach(s => s.color = c); pop.close(); ctx.render('tools', 'overlay'); } }))));
  }
  function guidesMenu(anchor) {
    const { pop } = popover(anchor, GUIDES.map(g => h('button.menu-item', { onclick: () => { ctx.guides = g.id; pop.close(); ctx.render('guides', 'tools'); } }, g.name, ctx.guides === g.id ? h('span.sub', { html: icon('check', 14) }) : null)));
  }

  // ——— Плеер ———
  let rectBox = { x: 0, y: 0, w: 1, h: 1 };
  function layout() {
    const vw = viewport.clientWidth, vh = viewport.clientHeight, a = ctx.aspect();
    let w = vw, hh = vw / a;
    if (hh > vh) { hh = vh; w = vh * a; }
    rectBox = { x: (vw - w) / 2, y: (vh - hh) / 2, w, h: hh };
    for (const n of [overlay, guidesEl]) Object.assign(n.style, { left: rectBox.x + 'px', top: rectBox.y + 'px', width: w + 'px', height: hh + 'px' });
    overlay.setAttribute('viewBox', `0 0 ${w} ${hh}`);
    ctx.render('overlay', 'guides');
  }
  const ro = new ResizeObserver(layout); ro.observe(viewport);

  async function loadVersion() {
    const v = ctx.ver;
    ctx.mediaReady = false;
    video.removeAttribute('src'); video.load();
    if (!v) {
      showState(h('div.box', h('div', { html: emptySchematic() }), h('p', 'В проекте ещё нет видео. Добавьте ссылку на рендер с Яндекс Диска или Google Диска — правки можно будет ставить прямо в кадре.'),
        can.addVersion(ctx.u()) ? h('button.btn', { onclick: () => openAddVersion(ctx.p, { onAdded: x => switchVersion(x.id) }), html: icon('plus', 16) + 'Добавить видео' }) : h('p.muted', 'Видео добавит монтажёр или продюсер.')));
      ctx.render(); return;
    }
    showState(h('div.box', h('div.spinner'), h('p.mono', v.sourceType === 'yandex' ? 'Получаю поток с Яндекс Диска…' : v.sourceType === 'gdrive' ? 'Подключаю Google Диск…' : 'Загружаю видео…')));
    try {
      const url = await playableUrl(v);
      if (ctx.ver !== v) return;
      if (v.picked) { delete v.picked; commit('meta'); }
      if (v.sourceType === 'hls') await attachHls(video, url); else video.src = url;
    } catch (e) {
      if (e.code === 'pick') {
        showState(h('div.box', h('p', e.message), h('div', { style: { display: 'grid', gap: '6px', width: 'min(420px, 100%)', maxHeight: '260px', overflow: 'auto' } },
          e.items.map(it => h('button.btn', { style: { justifyContent: 'space-between' }, onclick: () => { v.sourcePath = it.path; v.fileName = it.name.split(' / ').pop(); commit('meta'); loadVersion(); } },
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, it.name), h('span.mono', it.size ? (it.size / 1048576).toFixed(0) + ' МБ' : ''))))));
      } else if (e.code === 'reselect') {
        const inp = h('input.sr', { type: 'file', accept: 'video/*', onchange: () => { const f = inp.files[0]; if (f) { registerLocalFile(v.id, f); loadVersion(); } } });
        showState(h('div.box', h('p', e.message + ' Чтобы видео видела вся команда, укажите ссылку на облако.'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
            can.addVersion(ctx.u()) ? h('button.btn', { onclick: () => openRelinkVersion(ctx.p, v, { onDone: () => { retried = null; loadVersion(); } }), html: icon('link', 16) + 'Ссылка на облако' }) : null,
            h('label.btn', { html: icon('upload', 16) + 'Выбрать файл' }, inp))));
      } else showError(e.message);
    }
  }
  /** Название проекта по имени файла, если оно ещё стартовое */
  function nameFromFile(v) {
    if (v.fileName && ctx.p.title === 'Первый проект') ctx.p.title = v.fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ');
  }
  function showState(node) { fill(stateEl, node); stateEl.hidden = false; }
  function hideState() { stateEl.hidden = true; fill(stateEl, ); }
  function showError(msg, code) {
    const dv = ctx.ver;
    const diag = dv ? [dv.fileName && `файл: ${dv.fileName}`, dv.mime && `тип: ${dv.mime}`, dv.size && `${(dv.size / 1048576).toFixed(0)} МБ`, code && `код плеера: ${code}`].filter(Boolean).join(' · ') : '';
    showState(h('div.box', h('div', { html: '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#777" stroke-width="1.2"><circle cx="32" cy="32" r="26"/><path d="M22 22l20 20M42 22L22 42"/></svg>' }),
      h('p', msg), diag ? h('p.mono', { style: { opacity: 0.7 } }, diag) : null,
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, h('button.btn', { onclick: () => { retried = null; loadVersion(); } }, 'Попробовать снова'),
        ctx.ver?.sourceType === 'yandex' && ctx.ver.sourcePath ? h('button.btn', { onclick: () => { ctx.ver.sourcePath = ''; ctx.ver.fileName = ''; commit('meta'); loadVersion(); } }, 'Выбрать другое видео') : null,
        ctx.ver?.sourceUrl?.startsWith('http') ? h('a.btn', { href: ctx.ver.sourceUrl, target: '_blank', rel: 'noopener' }, 'Открыть на Диске') : null,
        ctx.ver && can.addVersion(ctx.u()) ? h('button.btn', { onclick: () => openRelinkVersion(ctx.p, ctx.ver, { onDone: () => { retried = null; loadVersion(); } }), html: icon('link', 16) + 'Другая ссылка' }) : null,
        h('label.btn', { html: icon('upload', 16) + 'Файл с компьютера' }, h('input.sr', { type: 'file', accept: 'video/*', onchange: e => { const f = e.target.files[0]; if (f && ctx.ver) { ctx.ver.sourceType = 'file'; ctx.ver.fileName = f.name; registerLocalFile(ctx.ver.id, f); commit('meta'); loadVersion(); } } })))));
  }

  video.addEventListener('loadedmetadata', () => {
    const v = ctx.ver; if (!v) return;
    let changed = false;
    if (isFinite(video.duration) && Math.abs((v.duration || 0) - video.duration) > 0.05) { v.duration = video.duration; changed = true; }
    if (video.videoWidth && v.width !== video.videoWidth) { v.width = video.videoWidth; v.height = video.videoHeight; changed = true; }
    if (v.fileName && v.sourceType !== 'file') { const before = ctx.p.title; nameFromFile(v); if (ctx.p.title !== before) changed = true; }
    hideState(); ctx.mediaReady = true; layout();
    if (pendingSeek != null) { seek(pendingSeek); pendingSeek = null; }
    if (changed) commit('meta');
    ctx.render();
    ctx.on.mediaLoaded?.();
  });
  video.addEventListener('loadeddata', () => {
    if (!ctx.ver.poster) {
      const snap = snapshot(320);
      if (snap) { ctx.ver.poster = snap; commit('meta'); }
    }
    detectFps();
  });
  // Временные ссылки Яндекса иногда не срабатывают с первого раза — один повтор со свежей ссылкой
  let retried = null;
  video.addEventListener('error', () => {
    const v = ctx.ver; if (!v) return;
    const code = video.error?.code;
    // повтор со свежей ссылкой; при ошибке формата — пробуем ссылку без правок
    if (v.sourceType === 'yandex' && retried !== v.id) { retried = v.id; if (code === 4) v.rawLink = !v.rawLink; loadVersion(); return; }
    showError(explainMediaError(v, video.error), code);
  });
  video.addEventListener('waiting', () => fill(hud, h('span.pill.mono', 'буферизация…')));
  video.addEventListener('playing', () => fill(hud, ));
  video.addEventListener('play', () => { ctx.render('transport'); loop(); });
  video.addEventListener('pause', () => ctx.render('transport', 'overlay', 'playhead'));
  video.addEventListener('seeked', () => ctx.render('overlay', 'playhead', 'transport', 'live'));
  video.addEventListener('timeupdate', () => { if (video.paused) ctx.render('playhead', 'transport'); });
  video.addEventListener('ratechange', () => ctx.render('transport'));
  video.addEventListener('volumechange', () => ctx.render('transport'));

  let raf = 0, lastLive = 0;
  function loop() {
    cancelAnimationFrame(raf);
    const step = () => {
      ctx.r.overlay(); ctx.r.playhead?.(); ctx.r.tcOnly?.();
      // Повтор диапазона выбранной правки
      if (ctx.loop && ctx.sel) { const n = ctx.note(ctx.sel); if (n && n.t1 > n.t0 && video.currentTime > n.t1) video.currentTime = n.t0; }
      const now = performance.now(); if (now - lastLive > 250) { lastLive = now; ctx.r.live?.(); }
      if (!video.paused) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  /** Определяем fps по requestVideoFrameCallback во время воспроизведения */
  function detectFps() {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype) || ctx.ver.fpsLocked) return;
    const times = [];
    const cb = (_, meta) => {
      times.push(meta.mediaTime);
      if (times.length < 14) video.requestVideoFrameCallback(cb);
      else {
        const d = times.slice(1).map((t, i) => t - times[i]).filter(x => x > 0.005 && x < 0.1).sort((a, b) => a - b);
        if (!d.length) return;
        const est = 1 / d[Math.floor(d.length / 2)];
        const common = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].reduce((a, b) => Math.abs(b - est) < Math.abs(a - est) ? b : a);
        if (Math.abs(common - est) < 1.5 && common !== ctx.ver.fps) { ctx.ver.fps = common; commit('meta'); ctx.render('transport'); }
      }
    };
    video.requestVideoFrameCallback(cb);
  }

  let pendingSeek = null;
  function seek(t) {
    const d = ctx.dur();
    if (!ctx.mediaReady) { pendingSeek = t; return; }
    video.currentTime = clamp(t, 0, d ? d - 0.001 : t);
    ctx.render('overlay', 'playhead', 'transport');
  }
  ctx.seek = seek;
  function stepFrames(n) { video.pause(); const f = ctx.fps(); const cur = Math.round(video.currentTime * f); seek((cur + n) / f + 0.0005); }
  ctx.togglePlay = () => { if (!ctx.mediaReady) return; video.paused ? video.play().catch(() => { }) : video.pause(); };

  function snapshot(w = 240) {
    try {
      if (!video.videoWidth) return null;
      const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * video.videoHeight / video.videoWidth);
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.62);
    } catch { return null; } // кросс-доменный поток — снимок недоступен, это нормально
  }
  ctx.snapshot = snapshot;

  // ——— Транспорт ———
  ctx.r.transport = () => {
    const playing = !video.paused;
    const f = ctx.fps();
    fill(transport, 
      h('button.icon-btn', { 'aria-label': 'Назад 1 кадр (←)', title: '−1 кадр · ←', onclick: () => stepFrames(-1), html: icon('stepb') }),
      h('button.play', { 'aria-label': playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)', onclick: ctx.togglePlay, html: icon(playing ? 'pause' : 'play') }),
      h('button.icon-btn', { 'aria-label': 'Вперёд 1 кадр (→)', title: '+1 кадр · →', onclick: () => stepFrames(1), html: icon('stepf') }),
      h('button.icon-btn.hide-sm', { 'aria-label': 'Назад 5 секунд (J)', title: '−5 с · J', onclick: () => seek(ctx.t() - 5), html: icon('rew') }),
      h('button.icon-btn.hide-sm', { 'aria-label': 'Вперёд 5 секунд', title: '+5 с', onclick: () => seek(ctx.t() + 5), html: icon('fwd') }),
      h('button.tc#tc', { title: 'Переключить формат: кадры / миллисекунды', onclick: () => { ctx.tcMode = ctx.tcMode === 'frames' ? 'ms' : 'frames'; st.prefs.tcMode = ctx.tcMode; commit('prefs'); ctx.render(); } },
        h('span.cur', ctx.tc(ctx.t())), h('span.total', ' / ' + ctx.tc(ctx.dur()))),
      h('div.grow'),
      ctx.sel && ctx.note(ctx.sel)?.t1 > ctx.note(ctx.sel)?.t0 ? h('button.icon-btn' + (ctx.loop ? '.on' : ''), { 'aria-label': 'Повтор диапазона правки', title: 'Повтор диапазона выбранной правки', onclick: () => { ctx.loop = !ctx.loop; ctx.render('transport'); }, html: icon('loop') }) : null,
      h('select.hide-sm', { 'aria-label': 'Частота кадров', title: 'Частота кадров', onchange: e => { ctx.ver.fps = +e.target.value; ctx.ver.fpsLocked = true; commit('meta'); ctx.render(); } },
        [23.976, 24, 25, 29.97, 30, 50, 60].map(x => h('option', { value: x, selected: Math.abs(x - f) < 0.01 }, x + ' fps'))),
      h('select', { 'aria-label': 'Скорость', title: 'Скорость', onchange: e => video.playbackRate = +e.target.value },
        [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(x => h('option', { value: x, selected: video.playbackRate === x }, x + '×'))),
      h('button.icon-btn', { 'aria-label': video.muted ? 'Включить звук' : 'Выключить звук', onclick: () => video.muted = !video.muted, html: icon(video.muted ? 'mute' : 'vol') }),
      h('input.hide-sm', { type: 'range', min: 0, max: 1, step: 0.05, value: video.volume, 'aria-label': 'Громкость', oninput: e => { video.volume = +e.target.value; video.muted = false; } }),
      h('button.icon-btn', { 'aria-label': 'Во весь экран (F)', title: 'Во весь экран · F', onclick: toggleFull, html: icon('full') }),
    );
  };
  ctx.r.tcOnly = () => { const c = transport.querySelector('.cur'); if (c) c.textContent = ctx.tc(ctx.t()); };
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else (stage.requestFullscreen?.() || stage.webkitRequestFullscreen?.());
  }

  // ——— Направляющие ———
  ctx.r.guides = () => {
    const W = rectBox.w, H = rectBox.h;
    let s = '';
    if (ctx.guides === 'safe') {
      const r = (k, label) => `<rect x="${W * k}" y="${H * k}" width="${W * (1 - 2 * k)}" height="${H * (1 - 2 * k)}" fill="none" stroke="rgba(255,255,255,.55)" stroke-dasharray="4 4"/><text x="${W * k + 6}" y="${H * k + 14}" fill="rgba(255,255,255,.7)" font-size="10" font-family="Martian Mono, monospace">${label}</text>`;
      s = r(0.05, 'ACTION SAFE 90%') + r(0.1, 'TITLE SAFE 80%');
    } else if (ctx.guides === 'thirds') {
      s = [1, 2].map(i => `<line x1="${W * i / 3}" y1="0" x2="${W * i / 3}" y2="${H}" stroke="rgba(255,255,255,.5)"/><line x1="0" y1="${H * i / 3}" x2="${W}" y2="${H * i / 3}" stroke="rgba(255,255,255,.5)"/>`).join('')
        + `<circle cx="${W / 2}" cy="${H / 2}" r="4" fill="none" stroke="rgba(255,255,255,.6)"/>`;
    } else if (ctx.guides === 'shorts') {
      const sw = Math.min(W, H * 9 / 16), x = (W - sw) / 2;
      s = `<path d="M0 0H${W}V${H}H0Z M${x} 0V${H}H${x + sw}V0Z" fill="rgba(0,0,0,.55)" fill-rule="evenodd"/><rect x="${x}" y="0" width="${sw}" height="${H}" fill="none" stroke="rgba(255,255,255,.7)"/>`
        + `<rect x="${x + sw * 0.82}" y="${H * 0.42}" width="${sw * 0.14}" height="${H * 0.45}" fill="rgba(229,72,77,.18)" stroke="rgba(229,72,77,.7)" stroke-dasharray="3 3"/>`
        + `<rect x="${x + sw * 0.04}" y="${H * 0.8}" width="${sw * 0.74}" height="${H * 0.16}" fill="rgba(229,72,77,.18)" stroke="rgba(229,72,77,.7)" stroke-dasharray="3 3"/>`
        + `<text x="${x + 8}" y="16" fill="rgba(255,255,255,.75)" font-size="10" font-family="Martian Mono, monospace">SHORTS 9:16 · красным — кнопки и подпись</text>`;
    }
    guidesEl.innerHTML = s ? `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${s}</svg>` : '';
  };

  // ——— Холст правок ———
  ctx.r.overlay = () => {
    const W = rectBox.w, H = rectBox.h;
    if (!ctx.ver) { overlay.innerHTML = ''; return; }
    const t = ctx.t();
    const focus = ctx.hover || ctx.sel;
    const showRes = ctx.showResolved;
    const parts = [];
    for (const n of ctx.verNotes()) {
      if (!n.shapes.length) continue;
      const isFocus = n.id === ctx.sel || n.id === ctx.hover;
      const inWin = t >= n.t0 - 0.5 && t <= Math.max(n.t1, n.t0) + 0.5;
      if (!isFocus && (!inWin || (RESOLVED.has(n.status) && !showRes))) continue;
      if (isFocus && !inWin && !video.paused) continue;
      const dim = focus && !isFocus;
      n.shapes.forEach(s => parts.push(shapeSvg(s, W, H, { seq: n.seq, dim, sel: n.id === ctx.sel })));
    }
    if (ctx.draft) ctx.draft.shapes.forEach(s => parts.push(shapeSvg(s, W, H, { draft: true })));
    if (drawing) parts.push(shapeSvg(drawing, W, H, { draft: true }));
    overlay.innerHTML = HATCH_DEF + parts.join('');
  };

  // Рисование и перемещение
  let drawing = null, dragMove = null;
  const norm = e => { const r = overlay.getBoundingClientRect(); return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)]; };
  overlay.addEventListener('pointerdown', e => {
    if (!ctx.ver || !ctx.mediaReady || e.button !== 0) return;
    const [x, y] = norm(e);
    if (ctx.tool === 'cursor') {
      // Перемещение фигуры выбранной правки или черновика
      const pool = [...(ctx.draft ? [{ note: null, shapes: ctx.draft.shapes }] : []),
        ...ctx.verNotes().filter(n => n.id === ctx.sel || (!ctx.sel && Math.abs(ctx.t() - n.t0) < 0.6)).map(n => ({ note: n, shapes: n.shapes }))];
      for (const g of pool) {
        const s = [...g.shapes].reverse().find(s => hitShape(s, x, y, ctx.aspect()));
        if (!s) continue;
        if (g.note && ctx.sel !== g.note.id) { ctx.select(g.note.id, { seek: false }); return; }
        if (g.note && !can.edit(ctx.u(), g.note)) return;
        dragMove = { note: g.note, s, x, y, moved: false };
        overlay.setPointerCapture(e.pointerId); return;
      }
      if (ctx.sel) { ctx.select(null); }
      return;
    }
    video.pause();
    if (!ctx.draft) ctx.startDraft(ctx.t());
    const color = ctx.color;
    const base = { id: uid('s'), color };
    if (ctx.tool === 'pin') { ctx.draft.shapes.push({ ...base, type: 'pin', x, y }); afterShape(); return; }
    if (ctx.tool === 'text') { textInput(x, y, base); return; }
    if (ctx.tool === 'brush') drawing = { ...base, type: 'brush', pts: [[x, y]] };
    else if (ctx.tool === 'arrow') drawing = { ...base, type: 'arrow', x1: x, y1: y, x2: x, y2: y };
    else drawing = { ...base, type: ctx.tool, x, y, w: 0, h: 0, ox: x, oy: y };
    overlay.setPointerCapture(e.pointerId);
  });
  overlay.addEventListener('pointermove', e => {
    if (dragMove) {
      const [x, y] = norm(e);
      moveShape(dragMove.s, x - dragMove.x, y - dragMove.y); dragMove.x = x; dragMove.y = y; dragMove.moved = true;
      ctx.r.overlay(); return;
    }
    if (!drawing) {
      if (ctx.tool === 'cursor' && ctx.ver) {
        const [x, y] = norm(e);
        const over = ctx.verNotes().some(n => (n.id === ctx.sel || Math.abs(ctx.t() - n.t0) < 0.6) && n.shapes.some(s => hitShape(s, x, y, ctx.aspect())));
        overlay.style.cursor = over ? 'move' : 'default';
      }
      return;
    }
    const [x, y] = norm(e);
    if (drawing.type === 'brush') { const l = drawing.pts[drawing.pts.length - 1]; if (Math.hypot(l[0] - x, l[1] - y) > 0.004) drawing.pts.push([x, y]); }
    else if (drawing.type === 'arrow') { drawing.x2 = x; drawing.y2 = y; }
    else { drawing.x = Math.min(x, drawing.ox); drawing.y = Math.min(y, drawing.oy); drawing.w = Math.abs(x - drawing.ox); drawing.h = Math.abs(y - drawing.oy); }
    ctx.r.overlay();
  });
  const endPointer = () => {
    if (dragMove) {
      if (dragMove.moved && dragMove.note) updateNote(ctx.p, dragMove.note, {}, 'Фигура перемещена');
      dragMove = null; ctx.render('overlay', 'panel'); return;
    }
    if (!drawing) return;
    const d = drawing; drawing = null;
    const big = d.type === 'brush' ? d.pts.length > 2 : d.type === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 0.02 : d.w > 0.012 && d.h > 0.012;
    if (big) { delete d.ox; delete d.oy; ctx.draft.shapes.push(d); afterShape(); }
    else ctx.r.overlay();
  };
  overlay.addEventListener('pointerup', endPointer);
  overlay.addEventListener('pointercancel', endPointer);

  function afterShape() { ctx.render('overlay', 'tools', 'composer'); ctx.focusComposer?.(); }
  function undoShape() { if (ctx.draft?.shapes.length) { ctx.draft.shapes.pop(); ctx.render('overlay', 'tools', 'composer'); } }

  function textInput(x, y, base) {
    const inp = h('input.input', { placeholder: 'Текст в кадре', style: { position: 'absolute', left: (rectBox.x + x * rectBox.w) + 'px', top: (rectBox.y + y * rectBox.h - 34) + 'px', width: '200px', height: '32px', zIndex: 5 } });
    viewport.append(inp); inp.focus();
    const done = ok => { if (ok && inp.value.trim()) { ctx.draft.shapes.push({ ...base, type: 'text', x, y, text: inp.value.trim() }); afterShape(); } inp.remove(); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }

  // ——— Черновик правки ———
  ctx.startDraft = (t0, t1 = t0, labels = []) => {
    video.pause();
    const lbl = labels.length ? labels : (ctx.lastLabels || []);
    ctx.draft = { t0, t1, shapes: [], text: '', labels: [...lbl], priority: 'important', kind: 'fix', visibility: 'all' };
    if (lbl[0]) ctx.color = labelById(lbl[0]).color;
    ctx.render('composer', 'timeline', 'overlay', 'tools');
  };
  ctx.cancelDraft = () => { ctx.draft = null; drawing = null; ctx.render('composer', 'timeline', 'overlay', 'tools'); };
  ctx.saveDraft = () => {
    const d = ctx.draft; if (!d) return;
    if (!d.text.trim() && !d.shapes.length) { toast('Напишите, что исправить, или отметьте зону в кадре'); ctx.focusComposer?.(); return; }
    const labels = d.labels.length ? d.labels : [d.kind === 'question' ? 'q' : 'cut'];
    const near = Math.abs(ctx.t() - d.t0) < 0.08;
    const n = addNote(ctx.p, {
      versionId: ctx.ver.id, t0: Math.min(d.t0, d.t1), t1: Math.max(d.t0, d.t1), text: d.text.trim() || 'Правка в кадре', labels,
      priority: d.priority, kind: d.kind, visibility: d.visibility, shapes: d.shapes, snap: near ? snapshot(200) : null,
    });
    ctx.lastLabels = labels.filter(l => l !== 'q');
    ctx.draft = null; ctx.sel = n.id;
    if (ctx.tool !== 'cursor') setTool('cursor');
    toast(`Правка #${n.seq} добавлена`);
    ctx.render();
    ctx.on.scrollToSel?.();
  };

  // ——— Выбор правки ———
  ctx.select = (id, { seek: doSeek = true } = {}) => {
    ctx.sel = id; ctx.loop = false;
    const n = id && ctx.note(id);
    if (n && doSeek) { video.pause(); seek(n.t0 + 0.0005); }
    ctx.render('overlay', 'panel', 'timeline', 'transport');
    ctx.on.scrollToSel?.();
    const q = new URLSearchParams({ v: ctx.ver?.id || '', ...(id ? { n: id } : {}) });
    history.replaceState(null, '', `#/p/${ctx.p.id}?${q}`);
  };
  ctx.jumpNote = dir => {
    const list = ctx.filtered().filter(n => !RESOLVED.has(n.status)).sort((a, b) => a.t0 - b.t0);
    if (!list.length) return;
    const t = ctx.t();
    const n = dir > 0 ? (list.find(n => n.t0 > t + 0.04) || list[0]) : ([...list].reverse().find(n => n.t0 < t - 0.04) || list[list.length - 1]);
    ctx.select(n.id);
  };

  function switchVersion(id) {
    const v = ctx.p.versions.find(x => x.id === id) || ctx.p.versions[ctx.p.versions.length - 1] || null;
    if (v === ctx.ver && v) return;
    ctx.ver = v; ctx.sel = null; ctx.draft = null; ctx.zoom = 1;
    history.replaceState(null, '', `#/p/${ctx.p.id}${v ? '?v=' + v.id : ''}`);
    loadVersion();
    ctx.render();
    ctx.on.versionChanged?.();
  }
  ctx.switchVersion = switchVersion;

  // ——— Поделиться ———
  function openShare() {
    const base = location.href.split('#')[0];
    const frameLink = `${base}#/p/${ctx.p.id}?v=${ctx.ver?.id || ''}&t=${ctx.t().toFixed(2)}${ctx.sel ? '&n=' + ctx.sel : ''}`;
    const body = h('div',
      h('div.field', h('label', 'Ссылка на текущий кадр'),
        h('div', { style: { display: 'flex', gap: '8px' } }, h('input.input.mono', { value: frameLink, readonly: true, onfocus: e => e.target.select() }),
          h('button.btn', { onclick: async () => { await copyText(frameLink); toast('Ссылка скопирована'); } }, 'Копировать')),
        h('div.hint', 'Откроет проект на этом кадре' + (ctx.sel ? ' и выделит выбранную правку' : '') + '. Работает у тех, у кого проект есть в браузере.')),
      h('div.field', h('label', 'Передать проект целиком'),
        h('div.hint', 'Сейчас проекты хранятся в браузере. Отправьте коллеге файл проекта — он импортирует его на главной странице и увидит все версии, правки и обсуждения. Видео не передаётся: оно подтянется по ссылке с Диска.'),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '6px' } },
          h('button.btn', { onclick: () => import('./export.js').then(m => m.exportJson(ctx)), html: icon('download', 16) + 'Скачать файл проекта' }),
          ctx.ver?.sourceUrl?.startsWith('http') ? h('button.btn.ghost', { onclick: async () => { await copyText(ctx.ver.sourceUrl); toast('Ссылка на видео скопирована'); } }, 'Ссылка на видео') : null)),
    );
    modal({ title: 'Поделиться', body, actions: [{ label: 'Готово', primary: true }] });
  }

  function openKeys() {
    const K = [['Пробел / K', 'Пуск / пауза'], ['← →', '±1 кадр'], ['Shift + ← →', '±1 секунда'], ['J / L', '−5 с / воспроизведение'], ['C', 'Новая правка на этом кадре'],
      ['I / O', 'Начало / конец диапазона'], ['[ ]', 'Предыдущая / следующая правка'], ['Enter', 'Сохранить правку'], ['Esc', 'Отменить черновик'],
      ['V P R E A B T M', 'Инструменты'], ['Ctrl + Z', 'Отменить фигуру'], ['G', 'Направляющие'], ['F', 'Во весь экран'], ['+ / −', 'Масштаб таймлайна'], ['?', 'Эта шпаргалка']];
    modal({ title: 'Горячие клавиши', wide: true, body: h('div.keys', K.map(([k, d]) => h('div', h('span', d), h('kbd', k)))) });
  }

  // ——— Клавиатура ———
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (document.querySelector('.modal-back')) return;
    if (typing) {
      if (e.key === 'Escape') { e.target.blur(); if (ctx.draft && !ctx.draft.text && !ctx.draft.shapes.length) ctx.cancelDraft(); }
      return;
    }
    if (e.metaKey && e.key.toLowerCase() !== 'z') return;
    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === ' ' || k === 'k' || k === 'K' || k === 'л' || k === 'Л') { handled(); ctx.togglePlay(); }
    else if (k === 'ArrowLeft') { handled(); e.shiftKey ? seek(ctx.t() - 1) : stepFrames(-1); }
    else if (k === 'ArrowRight') { handled(); e.shiftKey ? seek(ctx.t() + 1) : stepFrames(1); }
    else if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'я')) { handled(); undoShape(); }
    else if (e.ctrlKey || e.altKey) return;
    else if (k === 'j' || k === 'J' || k === 'о') { handled(); seek(ctx.t() - 5); }
    else if (k === 'l' || k === 'L' || k === 'д') { handled(); if (video.paused) video.play(); else video.playbackRate = video.playbackRate >= 2 ? 1 : video.playbackRate + 0.5; }
    else if (k === 'c' || k === 'C' || k === 'с') { handled(); if (!ctx.draft) ctx.startDraft(ctx.t()); ctx.focusComposer?.(); }
    else if (k === 'i' || k === 'I' || k === 'ш') { handled(); if (!ctx.draft) ctx.startDraft(ctx.t()); else { ctx.draft.t0 = ctx.t(); if (ctx.draft.t1 < ctx.draft.t0) ctx.draft.t1 = ctx.draft.t0; } ctx.render('composer', 'timeline'); }
    else if (k === 'o' || k === 'O' || k === 'щ') { handled(); if (!ctx.draft) ctx.startDraft(Math.max(0, ctx.t() - 2), ctx.t()); else ctx.draft.t1 = Math.max(ctx.t(), ctx.draft.t0); ctx.render('composer', 'timeline'); }
    else if (k === '[' || k === 'х') { handled(); ctx.jumpNote(-1); }
    else if (k === ']' || k === 'ъ') { handled(); ctx.jumpNote(1); }
    else if (k === 'Escape') { if (ctx.draft) ctx.cancelDraft(); else if (ctx.tool !== 'cursor') setTool('cursor'); else if (ctx.sel) ctx.select(null); }
    else if (k === 'Enter' && ctx.draft) { handled(); ctx.saveDraft(); }
    else if (k === 'Backspace' || k === 'Delete') { if (ctx.draft?.shapes.length) { handled(); undoShape(); } }
    else if (k === 'g' || k === 'G' || k === 'п') { const i = GUIDES.findIndex(g => g.id === ctx.guides); ctx.guides = GUIDES[(i + 1) % GUIDES.length].id; ctx.render('guides', 'tools'); toast(GUIDES.find(g => g.id === ctx.guides).name); }
    else if (k === 'f' || k === 'F' || k === 'а') { handled(); toggleFull(); }
    else if (k === '?' || k === ',') { if (k === '?' || e.shiftKey) { handled(); openKeys(); } }
    else if (k === '+' || k === '=') { ctx.on.zoomBy?.(1.5); }
    else if (k === '-' || k === '_') { ctx.on.zoomBy?.(1 / 1.5); }
    else {
      const map = { v: 'cursor', м: 'cursor', p: 'pin', з: 'pin', r: 'rect', к: 'rect', e: 'ellipse', у: 'ellipse', a: 'arrow', ф: 'arrow', b: 'brush', и: 'brush', t: 'text', е: 'text', m: 'blur', ь: 'blur' };
      const tool = map[k.toLowerCase()];
      if (tool) { handled(); setTool(tool); }
    }
  }
  document.addEventListener('keydown', onKey);
  const onFs = () => setTimeout(layout, 50);
  document.addEventListener('fullscreenchange', onFs);

  // ——— Подключаем таймлайн и панель ———
  const tl = mountTimeline(tlEl, ctx);
  const panel = mountPanel(panelEl, ctx);

  // ——— Старт ———
  function applyQuery(q) {
    const vid = q.v && ctx.p.versions.find(v => v.id === q.v) ? q.v : ctx.p.versions[ctx.p.versions.length - 1]?.id;
    if (!ctx.ver || ctx.ver.id !== vid) { ctx.ver = ctx.p.versions.find(v => v.id === vid) || null; ctx.sel = null; ctx.draft = null; loadVersion(); }
    if (q.n && ctx.note(q.n)) { ctx.sel = q.n; const n = ctx.note(q.n); if (n.versionId !== ctx.ver?.id) { ctx.ver = ctx.p.versions.find(v => v.id === n.versionId); loadVersion(); } pendingSeek = n.t0 + 0.0005; }
    else if (q.t) pendingSeek = +q.t;
    if (pendingSeek != null && ctx.mediaReady) { seek(pendingSeek); pendingSeek = null; }
    ctx.render();
    ctx.on.scrollToSel?.();
  }
  applyQuery(query);

  return {
    applyQuery,
    onStore(reason) {
      if (reason === 'meta' || reason === 'prefs') { ctx.render('top', 'panel', 'timeline'); return; }
      const fresh = getProject(ctx.p.id);
      if (!fresh) { location.hash = '#/reviews'; return; }
      if (fresh !== ctx.p) { ctx.p = fresh; const vid = ctx.ver?.id; ctx.ver = fresh.versions.find(v => v.id === vid) || fresh.versions[fresh.versions.length - 1] || null; }
      if (reason === 'remote' && ctx.ver && ctx.mediaReady === false && !video.src) loadVersion();
      ctx.render();
    },
    unmount() {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      ro.disconnect(); cancelAnimationFrame(raf);
      video.pause(); video.removeAttribute('src'); video.load();
      tl.unmount?.(); panel.unmount?.();
      el.remove();
    },
  };
}

function emptySchematic() {
  return `<svg width="220" height="110" viewBox="0 0 220 110" fill="none" stroke="#6b6b66" stroke-width="1">
    <rect x="10" y="20" width="110" height="64" rx="6"/><path d="M58 42l18 10-18 10z" fill="#6b6b66" stroke="none"/>
    <path d="M120 52h60M172 46l8 6-8 6"/><circle cx="196" cy="52" r="14"/><path d="M190 52h12M196 46v12"/>
    <text x="10" y="102" font-family="Martian Mono, monospace" font-size="8" fill="#8a8a84" stroke="none">LINK → STREAM → REVIEW</text>
  </svg>`;
}
