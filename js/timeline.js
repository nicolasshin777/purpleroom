// Таймлайн правок: шкала, лента кадров, звуковая волна, плотность, дорожки с маркерами.
import { h, fill, icon, clamp, tcShort, esc, relTime, initials } from './util.js';
import { LABELS, labelById, STATUSES, statusById, RESOLVED, userById, can, updateNote, getState, commit, roleName } from './store.js';
import { noteThumbSvg } from './shapes.js';

const GUT = 112;
const GROUPS = [
  { id: 'label', name: 'Ярлыки' }, { id: 'author', name: 'Авторы' }, { id: 'status', name: 'Статусы' }, { id: 'one', name: 'Одна' },
];

export function mountTimeline(root, ctx) {
  const head = h('div.tl-head');
  const scroller = h('div.tl-scroll');
  const content = h('div.tl-content');
  scroller.append(content);
  const resize = h('div.tl-resize', { title: 'Потяните, чтобы изменить высоту' });
  root.append(resize, head, h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, scroller));
  scroller.style.flex = '1';
  const playhead = h('div.playhead');
  const tip = h('div.tl-tip', { hidden: true });
  document.body.append(tip);

  let pps = 1, cw = 1;           // пикселей в секунде, ширина дорожек
  let atlas = null, atlasMeta = null, wave = null, stripToken = 0;
  let laneEls = [];

  const x = t => t * pps;
  const tAt = clientX => { const r = content.getBoundingClientRect(); return clamp((clientX - r.left - GUT) / pps, 0, ctx.dur()); };

  // ——— Шапка ———
  ctx.r.tlHead = () => {
    const d = ctx.dur();
    fill(head, 
      h('h3', 'Таймлайн'),
      ctx.ver ? h('span.mono.muted', `V${ctx.ver.number} · ${ctx.tc(d)} · ${ctx.fps()} fps`) : null,
      h('div.grow'),
      h('span.muted.hide-sm', { style: { fontSize: '12.5px' } }, 'Дорожки'),
      h('div.seg', { role: 'group', 'aria-label': 'Группировка дорожек' }, GROUPS.map(g => h('button' + (ctx.group === g.id ? '.on' : ''), { onclick: () => { ctx.group = g.id; getState().prefs.group = g.id; commit('prefs'); } }, g.name))),
      h('button.icon-btn', { 'aria-label': 'Уменьшить масштаб (−)', title: 'Уменьшить · −', onclick: () => zoomBy(1 / 1.6), html: icon('zoomout') }),
      h('span.mono', { style: { minWidth: '44px', textAlign: 'center' } }, Math.round(ctx.zoom * 100) + '%'),
      h('button.icon-btn', { 'aria-label': 'Увеличить масштаб (+)', title: 'Увеличить · +', onclick: () => zoomBy(1.6), html: icon('zoomin') }),
      h('button.btn.sm.ghost', { onclick: () => { ctx.zoom = 1; ctx.render('timeline'); } }, 'Весь ролик'),
    );
  };

  // ——— Дорожки ———
  function lanesFor(notes) {
    const g = ctx.group;
    if (g === 'label') return LABELS.map(l => ({ id: l.id, name: l.name, color: l.color, match: n => (n.labels[0] || 'q') === l.id, label: l.id }));
    if (g === 'status') return STATUSES.map(s => ({ id: s.id, name: s.name, color: { open: 'var(--ink)', progress: '#3546E0', question: '#E8A400', fixed: '#1F8F5F' }[s.id] || '#85857C', match: n => n.status === s.id }));
    if (g === 'author') {
      const ids = [...new Set([...notes.map(n => n.authorId), ctx.u().id])];
      return ids.map(id => { const u = userById(id); return { id, name: u?.name.split(' ')[0] || 'Гость', color: u?.color || '#888', match: n => n.authorId === id, sub: u ? roleName(u.role) : '' }; });
    }
    return [{ id: 'all', name: 'Все правки', color: 'var(--ink)', match: () => true }];
  }

  ctx.r.timeline = () => {
    ctx.r.tlHead();
    const d = ctx.dur();
    const viewW = Math.max(200, scroller.clientWidth - GUT);
    cw = viewW * ctx.zoom; pps = d ? cw / d : 1;
    fill(content, );
    content.style.width = (GUT + cw) + 'px';
    content.style.display = 'grid';
    content.style.gridTemplateColumns = `${GUT}px ${cw}px`;
    laneEls = [];
    if (!ctx.ver || !d) {
      content.style.display = 'block';
      content.append(h('div.empty', { style: { padding: '28px' } }, ctx.ver ? 'Таймлайн появится, когда видео загрузится.' : 'Добавьте видео — правки появятся здесь, на дорожках по ярлыкам.'));
      return;
    }
    const cell = (cls, children = [], style = {}) => h('div' + cls, { style }, children);
    const gl = (txt, extra = {}) => h('div.tl-gutter-cell', { style: { position: 'sticky', left: 0, zIndex: 3, background: 'var(--panel)', borderRight: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: '7px', padding: '0 10px 0 12px', fontSize: '12px', color: 'var(--ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', ...extra } }, txt);

    // Шкала
    const ruler = h('div.tl-ruler', { style: { position: 'sticky', top: 0, zIndex: 3 } });
    const step = pickStep(pps), minor = step / (step >= 60 ? 6 : step >= 10 ? 5 : step >= 1 ? 4 : 2);
    for (let t = 0; t <= d + 1e-6; t += minor) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ruler.append(h('i.tick.' + (major ? 'major' : 'minor'), { style: { left: x(t) + 'px' } }));
      if (major) ruler.append(h('span.tl-lbl', { style: { left: x(t) + 'px', transform: t === 0 ? 'none' : '' } }, fmtRuler(t, step, ctx.fps())));
    }

    ruler.addEventListener('pointerdown', e => {
      ctx.video.pause(); ctx.seek(tAt(e.clientX));
      ruler.setPointerCapture(e.pointerId);
      const mv = ev => ctx.seek(tAt(ev.clientX));
      const up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); };
      ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up);
    });
    content.append(gl(h('span.mono.muted', ctx.tcMode === 'frames' ? 'ЧЧ:ММ:СС:КК' : 'ММ:СС.мс'), { position: 'sticky', top: 0, zIndex: 4, height: '26px', fontSize: '9px' }), ruler);

    // Лента кадров
    const stripC = h('canvas', { width: Math.min(cw, 16000), height: 68, style: { width: Math.min(cw, 16000) + 'px', height: '34px' } });
    const chapTags = ctx.p.chapters.filter(c => c.versionId === ctx.ver.id).flatMap(ch => [
      h('span.chap-line', { style: { left: x(ch.t) + 'px' } }),
      h('span.chap-tag', { style: { left: x(ch.t) + 'px' }, title: `Глава: ${ch.title}`, onpointerdown: e => { e.stopPropagation(); ctx.video.pause(); ctx.seek(ch.t); } }, ch.title)]);
    content.append(gl('Кадры', { height: '34px' }), cell('.tl-strip', [stripC, ...chapTags]));
    drawStrip(stripC);
    // Волна
    if (wave) {
      const wc = h('canvas', { width: Math.min(cw, 16000), height: 44, style: { width: Math.min(cw, 16000) + 'px', height: '22px' } });
      content.append(gl('Волна', { height: '22px' }), cell('.tl-wave', [wc]));
      drawWave(wc);
    }
    // Плотность правок
    const all = ctx.filtered();
    const heat = h('canvas', { width: Math.min(cw, 16000), height: 5, style: { width: Math.min(cw, 16000) + 'px', height: '5px', display: 'block' } });
    content.append(gl('', { height: '5px' }), cell('.tl-heat', [heat]));
    drawHeat(heat, all);

    // Дорожки
    const lanes = lanesFor(all);
    for (const lane of lanes) {
      const notes = all.filter(lane.match);
      const draftHere = ctx.draft && lane.match({ labels: ctx.draft.labels, status: 'open', authorId: ctx.u().id });
      const track = h('div.tl-lane', { dataset: { lane: lane.id } });
      track._lane = lane;
      content.append(gl([h('span.sw', { style: { background: lane.color, width: '8px', height: '8px', borderRadius: '2px', flex: 'none' } }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, lane.name), h('span.mono', { style: { marginLeft: 'auto', color: 'var(--ink-3)', fontSize: '10px' } }, notes.length || '')],
        { height: '26px', borderTop: '1px solid var(--line-2)', opacity: notes.length || draftHere ? 1 : 0.55 }), track);
      placeMarkers(track, notes, lane);
      if (draftHere) track.append(draftMarker());
      laneEls.push(track);
      bindLane(track, lane);
    }
    // Диапазон черновика
    if (ctx.draft && ctx.draft.t1 > ctx.draft.t0) content.append(h('div.inout', { style: { left: GUT + x(ctx.draft.t0) + 'px', width: x(ctx.draft.t1 - ctx.draft.t0) + 'px', gridColumn: '1 / -1', position: 'absolute' } }));
    content.style.position = 'relative';
    content.append(playhead);
    ctx.r.playhead();
    fitHeight();
  };

  // Высота по содержимому: все дорожки видны целиком, плеер берёт остаток (не меньше 300 px).
  // Если высоту потянули рукой — больше не трогаем.
  let manualH = false;
  function fitHeight() {
    const review = root.closest('.review');
    if (!review || manualH || innerWidth <= 900) return;
    const last = laneEls[laneEls.length - 1];
    const rows = last ? last.offsetTop + last.offsetHeight : 120;
    const bar = scroller.offsetHeight - scroller.clientHeight;
    const need = head.offsetHeight + rows + bar + 2;
    const top = parseFloat(getComputedStyle(review).getPropertyValue('--top-h')) || 56;
    const want = Math.round(clamp(need, 180, Math.max(180, innerHeight - top - 300)));
    const cur = parseFloat(review.style.getPropertyValue('--tl-h')) || 0;
    if (Math.abs(cur - want) > 1) review.style.setProperty('--tl-h', want + 'px');
  }

  function placeMarkers(track, notes, lane) {
    const pts = notes.filter(n => !(n.t1 > n.t0 + 0.05)).sort((a, b) => a.t0 - b.t0);
    const rgs = notes.filter(n => n.t1 > n.t0 + 0.05);
    for (const n of rgs) track.append(marker(n, true));
    // кластеры для близких точек
    let group = [];
    const flush = () => {
      if (!group.length) return;
      if (group.length === 1 || group.some(n => n.id === ctx.sel)) group.forEach(n => track.append(marker(n, false)));
      else {
        const cx = x((group[0].t0 + group[group.length - 1].t0) / 2);
        const ids = group.map(n => n.id);
        track.append(h('div.cluster', { style: { left: cx + 'px' }, title: `${group.length} правки рядом — нажмите, чтобы приблизить`, onpointerdown: e => { e.stopPropagation(); zoomBy(3, (group[0].t0 + group[group.length - 1].t0) / 2); } }, String(group.length)));
      }
      group = [];
    };
    for (const n of pts) {
      if (group.length && x(n.t0) - x(group[group.length - 1].t0) < 10) group.push(n); else { flush(); group.push(n); }
    }
    flush();
  }

  function markerClass(n, range) {
    const c = ['mk', range ? 'rg' : 'pt'];
    if (n.priority === 'critical' && !RESOLVED.has(n.status)) c.push('crit');
    if (n.status === 'fixed') c.push('fixed');
    if (RESOLVED.has(n.status)) c.push('done');
    if (n.id === ctx.sel) c.push('sel');
    return c.join('.');
  }
  function noteColor(n) {
    if (ctx.group === 'status') return { open: 'var(--ink)', progress: '#3546E0', question: '#E8A400', fixed: '#1F8F5F' }[n.status] || '#85857C';
    if (ctx.group === 'author') return userById(n.authorId)?.color || '#888';
    return labelById(n.labels[0]).color;
  }
  function marker(n, range) {
    const style = { '--c': noteColor(n), left: x(n.t0) + 'px' };
    if (range) style.width = Math.max(6, x(n.t1 - n.t0)) + 'px';
    const m = h('div.' + markerClass(n, range), { style, role: 'button', tabindex: '-1', 'aria-label': `Правка #${n.seq}` },
      range ? [h('span.h.l'), h('span.h.r')] : h('i'));
    m.addEventListener('pointerenter', e => showTip(n, e));
    m.addEventListener('pointerleave', hideTip);
    m.addEventListener('pointerdown', e => dragMarker(e, n, m, range));
    return m;
  }
  function draftMarker() {
    const d = ctx.draft, range = d.t1 > d.t0 + 0.05;
    const style = { '--c': d.labels[0] ? labelById(d.labels[0]).color : 'var(--ink)', left: x(d.t0) + 'px' };
    if (range) style.width = Math.max(6, x(d.t1 - d.t0)) + 'px';
    return h('div.mk.draft.' + (range ? 'rg' : 'pt'), { style, title: 'Новая правка — черновик' }, range ? null : h('i'));
  }

  // Перетаскивание маркера: сдвиг или изменение диапазона
  function dragMarker(e, n, m, range) {
    e.stopPropagation(); hideTip();
    const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
    const startX = e.clientX, t0 = n.t0, t1 = n.t1;
    const allowed = can.edit(ctx.u(), n);
    let moved = false;
    m.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = (ev.clientX - startX) / pps;
      if (!moved && Math.abs(ev.clientX - startX) < 4) return;
      if (!allowed) return;
      moved = true;
      const d = ctx.dur();
      if (mode === 'move') { const len = t1 - t0; n.t0 = clamp(t0 + dx, 0, d - len); n.t1 = n.t0 + len; }
      else if (mode === 'l') n.t0 = clamp(t0 + dx, 0, n.t1 - 0.1);
      else n.t1 = clamp(t1 + dx, n.t0 + 0.1, d);
      m.style.left = x(n.t0) + 'px'; if (range) m.style.width = Math.max(6, x(n.t1 - n.t0)) + 'px';
      ctx.seek(mode === 'r' ? n.t1 : n.t0);
    };
    const up = () => {
      m.removeEventListener('pointermove', mv); m.removeEventListener('pointerup', up);
      if (moved) updateNote(ctx.p, n, {}, `Таймкод: ${ctx.tc(n.t0)}${n.t1 > n.t0 ? ' → ' + ctx.tc(n.t1) : ''}`);
      else ctx.select(n.id);
    };
    m.addEventListener('pointermove', mv); m.addEventListener('pointerup', up);
  }

  // Создание правки на дорожке: клик — перемотка, протяжка — диапазон, двойной клик — точка
  function bindLane(track, lane) {
    track.addEventListener('pointerdown', e => {
      if (e.target !== track || e.button !== 0) return;
      const t0 = tAt(e.clientX), sx = e.clientX;
      let tmp = null;
      track.setPointerCapture(e.pointerId);
      const mv = ev => {
        if (Math.abs(ev.clientX - sx) < 5) return;
        const t1 = tAt(ev.clientX);
        if (!tmp) { tmp = h('div.mk.rg.draft', { style: { '--c': lane.color } }); track.append(tmp); }
        tmp.style.left = x(Math.min(t0, t1)) + 'px'; tmp.style.width = x(Math.abs(t1 - t0)) + 'px';
      };
      const up = ev => {
        track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up);
        if (tmp) {
          const t1 = tAt(ev.clientX);
          ctx.seek(Math.min(t0, t1));
          ctx.startDraft(Math.min(t0, t1), Math.max(t0, t1), lane.label ? [lane.label] : []);
          ctx.focusComposer?.();
        } else { ctx.video.pause(); ctx.seek(t0); }
      };
      track.addEventListener('pointermove', mv); track.addEventListener('pointerup', up);
    });
    track.addEventListener('dblclick', e => {
      if (e.target !== track) return;
      const t = tAt(e.clientX); ctx.seek(t);
      ctx.startDraft(t, t, lane.label ? [lane.label] : []);
      ctx.focusComposer?.();
    });
  }

  // ——— Подсказка при наведении ———
  function showTip(n, e) {
    const u = userById(n.authorId);
    tip.innerHTML = '';
    tip.append(
      (n.shapes.length || n.snap) ? h('div.thumb', { html: noteThumbSvg(n, ctx.aspect(), 238) }) : null,
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('b.mono', `#${n.seq}`), h('span.mono.muted', ctx.tc(n.t0) + (n.t1 > n.t0 ? ' → ' + ctx.tc(n.t1) : '')), h('span', { style: { marginLeft: 'auto' }, class: 'stbtn st-' + n.status }, h('span.dot'), statusById(n.status).short)),
      h('div', n.text),
      h('div.muted', { style: { fontSize: '12px' } }, `${u?.name || 'Гость'} · ${n.labels.map(l => labelById(l).name).join(', ')}`),
    );
    tip.hidden = false;
    const r = e.target.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    tip.style.left = clamp(r.left + r.width / 2 - 130, 8, innerWidth - 270) + 'px';
    tip.style.top = Math.max(8, r.top - tr.height - 10) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  // ——— Плейхед и следование ———
  ctx.r.playhead = () => {
    const t = ctx.t();
    playhead.style.left = (GUT + x(t)) + 'px';
    playhead.style.height = content.scrollHeight + 'px';
    if (!ctx.video.paused) {
      const px = x(t), sl = scroller.scrollLeft, vw = scroller.clientWidth - GUT;
      if (px < sl || px > sl + vw - 20) scroller.scrollLeft = px - vw * 0.1;
    }
  };

  // ——— Масштаб ———
  function zoomBy(f, anchor = ctx.t()) {
    const d = ctx.dur(); if (!d) return;
    const viewW = Math.max(200, scroller.clientWidth - GUT);
    const maxZ = Math.max(1, (d * ctx.fps() * 14) / viewW);
    const screenX = x(anchor) - scroller.scrollLeft;
    ctx.zoom = clamp(ctx.zoom * f, 1, maxZ);
    ctx.render('timeline');
    scroller.scrollLeft = x(anchor) - screenX;
  }
  ctx.on.zoomBy = zoomBy;
  scroller.addEventListener('wheel', e => {
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.25 : 0.8, tAt(e.clientX)); }
  }, { passive: false });

  // ——— Высота таймлайна ———
  resize.addEventListener('pointerdown', e => {
    manualH = true;
    const review = root.closest('.review'); const sy = e.clientY, h0 = root.getBoundingClientRect().height;
    resize.setPointerCapture(e.pointerId);
    const mv = ev => review.style.setProperty('--tl-h', clamp(h0 - (ev.clientY - sy), 140, innerHeight * 0.6) + 'px');
    const up = () => { resize.removeEventListener('pointermove', mv); resize.removeEventListener('pointerup', up); ctx.render('timeline'); };
    resize.addEventListener('pointermove', mv); resize.addEventListener('pointerup', up);
  });
  const ro = new ResizeObserver(() => ctx.r.timeline()); ro.observe(scroller);

  // ——— Лента кадров (скрытый второй плеер) ———
  function drawStrip(c) {
    const g = c.getContext('2d');
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--strip').trim() || '#DCDCD6'; g.fillRect(0, 0, c.width, c.height);
    if (!atlas || !atlasMeta) return;
    const { n, fw, fh, have } = atlasMeta;
    const slotW = fw * (68 / fh);
    const d = ctx.dur();
    for (let sx = 0; sx < c.width; sx += slotW) {
      const t = ((sx + slotW / 2) / pps);
      let i = clamp(Math.floor((t / d) * n), 0, n - 1);
      // ближайший готовый кадр
      let k = i; for (let r = 0; r < n && !have[k]; r++) k = have[i + r] ? i + r : have[i - r] ? i - r : k;
      if (!have[k]) continue;
      try { g.drawImage(atlas, k * fw, 0, fw, fh, sx, 0, slotW - 2, 68); } catch { }
    }
  }
  async function generateStrip() {
    const token = ++stripToken;
    atlas = null; atlasMeta = null;
    const src = ctx.video.currentSrc; const d = ctx.dur();
    if (!src || !d || ctx.ver.sourceType === 'hls') return;
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = src; v.playsInline = true;
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 8000); });
    if (token !== stripToken || !v.videoWidth) return;
    const n = clamp(Math.ceil(d / 1.5), 8, 40);
    const fh = 68, fw = Math.round(fh * v.videoWidth / v.videoHeight);
    atlas = document.createElement('canvas'); atlas.width = fw * n; atlas.height = fh;
    atlasMeta = { n, fw, fh, have: new Array(n).fill(false) };
    const g = atlas.getContext('2d');
    for (let i = 0; i < n; i++) {
      if (token !== stripToken) return;
      v.currentTime = Math.min(d - 0.05, (i + 0.5) * d / n);
      await new Promise(r => { const done = () => { v.removeEventListener('seeked', done); r(); }; v.addEventListener('seeked', done); setTimeout(done, 5000); });
      try { g.drawImage(v, i * fw, 0, fw, fh); atlasMeta.have[i] = true; } catch { }
      if (i % 4 === 3 || i === n - 1) { const c = content.querySelector('.tl-strip canvas'); if (c) drawStrip(c); }
    }
    v.removeAttribute('src'); v.load();
  }

  // ——— Звуковая волна (для файлов с компьютера) ———
  async function generateWave() {
    wave = null;
    const v = ctx.ver; const src = ctx.video.currentSrc;
    if (!src || v.sourceType !== 'file') return;
    try {
      const buf = await (await fetch(src)).arrayBuffer();
      if (buf.byteLength > 400 * 1048576) return;
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const audio = await ac.decodeAudioData(buf); ac.close?.();
      const ch = audio.getChannelData(0), N = 2000, size = Math.floor(ch.length / N) || 1;
      const peaks = new Float32Array(N);
      for (let i = 0; i < N; i++) { let m = 0; for (let j = i * size, e = Math.min(ch.length, j + size); j < e; j += 4) m = Math.max(m, Math.abs(ch[j])); peaks[i] = m; }
      const max = Math.max(...peaks) || 1;
      if (ctx.ver !== v) return;
      wave = { peaks: peaks.map(p => p / max) };
      ctx.render('timeline');
    } catch { /* звук недоступен — строку не показываем */ }
  }
  function drawWave(c) {
    const g = c.getContext('2d'), H = c.height, pk = wave.peaks;
    g.fillStyle = '#85857C';
    const bw = 2;
    for (let px = 0; px < c.width; px += bw + 1) {
      const i = Math.floor((px / c.width) * pk.length);
      const a = Math.max(1, pk[i] * (H / 2 - 2));
      g.fillRect(px, H / 2 - a, bw, a * 2);
    }
  }
  function drawHeat(c, notes) {
    const g = c.getContext('2d'), N = 160, bins = new Float32Array(N), d = ctx.dur();
    for (const n of notes) if (!RESOLVED.has(n.status)) {
      const a = Math.floor((n.t0 / d) * N), b = Math.floor((Math.max(n.t1, n.t0) / d) * N);
      for (let i = Math.max(0, a - 1); i <= Math.min(N - 1, b + 1); i++) bins[i] += (i >= a && i <= b ? 1 : 0.4) * (n.priority === 'critical' ? 1.6 : 1);
    }
    const max = Math.max(1, ...bins);
    const w = c.width / N;
    for (let i = 0; i < N; i++) { if (!bins[i]) continue; g.fillStyle = `rgba(229,72,77,${0.15 + 0.85 * bins[i] / max})`; g.fillRect(i * w, 0, Math.ceil(w), 5); }
  }

  ctx.on.mediaLoaded = () => { ctx.render('timeline'); generateStrip(); generateWave(); };
  ctx.on.versionChanged = () => { stripToken++; atlas = null; wave = null; };
  ctx.on.scrollMarker = n => { const px = x(n.t0); if (px < scroller.scrollLeft || px > scroller.scrollLeft + scroller.clientWidth - GUT) scroller.scrollLeft = px - 80; };

  return { unmount() { ro.disconnect(); tip.remove(); stripToken++; } };
}

function pickStep(pps) {
  const steps = [0.04, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
  return steps.find(s => s * pps >= 64) || 3600;
}
function fmtRuler(t, step, fps) {
  if (step >= 1) return tcShort(t);
  const s = Math.floor(t), fr = Math.round((t - s) * fps);
  return `${tcShort(s)}:${String(fr).padStart(2, '0')}`;
}
