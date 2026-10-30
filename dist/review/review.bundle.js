(() => {
'use strict';
const M = {};
// ——— export.js ———
M['export'] = (() => {
// Экспорт правок и сравнение версий
const { h, fill, icon, popover, download, toast, tc, tcShort, esc, clamp } = window.SPO.util;
const { labelById, statusById, PRIORITIES, userById, RESOLVED, exportProjectJson } = window.SPO.store;
const { playableUrl } = window.SPO.sources;
const { noteThumbSvg } = window.SPO.shapes;
const RESOLVE_COLORS = { content: 'Red', color: 'Sand', thumb: 'Yellow', sound: 'Green', subs: 'Cyan', cut: 'Blue', titles: 'Purple', fx: 'Pink', q: 'Cream' };

function openExportMenu(anchor, ctx) {
  const item = (ic, name, sub, fn) => h('button.menu-item', { onclick: () => { pop.close(); fn(); } }, h('span', { html: icon(ic, 16) }), h('span', name), h('span.sub', sub));
  const { pop } = popover(anchor, [
    h('div.menu-title', ctx.ver ? `Правки V${ctx.ver.number} · ${notesOf(ctx).length}` : 'Нет версии'),
    item('download', 'DaVinci Resolve', 'маркеры .edl', () => exportEdl(ctx)),
    item('download', 'Premiere Pro', 'маркеры .xml', () => exportXmeml(ctx)),
    item('download', 'Final Cut Pro', 'маркеры .fcpxml', () => exportFcpxml(ctx)),
    h('div.menu-sep'),
    item('pdf', 'Отчёт PDF', 'печать', () => printReport(ctx)),
    item('list', 'Таблица правок', '.csv', () => exportCsv(ctx)),
    item('folder', 'Файл проекта', '.json', () => exportJson(ctx)),
  ], { align: 'right' });
}

function notesOf(ctx, all = false) {
  return ctx.verNotes().filter(n => all || (n.kind !== 'approval' && n.status !== 'rejected')).sort((a, b) => a.t0 - b.t0);
}
const slug = s => s.replace(/[^\wа-яё]+/gi, '_').replace(/^_|_$/g, '').slice(0, 40) || 'project';
const fname = (ctx, ext) => `${slug(ctx.p.title)}_V${ctx.ver?.number || 0}_правки.${ext}`;
const frames = (t, fps) => Math.round(t * fps);

function exportCsv(ctx) {
  const rows = [['№', 'Версия', 'Начало', 'Конец', 'Ярлыки', 'Приоритет', 'Статус', 'Автор', 'Текст', 'Ответов']];
  for (const n of notesOf(ctx, true)) rows.push([n.seq, 'V' + ctx.ver.number, tc(n.t0, ctx.fps()), n.t1 > n.t0 ? tc(n.t1, ctx.fps()) : '', n.labels.map(l => labelById(l).name).join(', '),
    PRIORITIES.find(p => p.id === n.priority).name, statusById(n.status).name, userById(n.authorId)?.name || 'Гость', n.text, n.replies.length]);
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(fname(ctx, 'csv'), csv, 'text/csv'); toast('Таблица правок скачана');
}

/** EDL с маркерами: Resolve → Timeline → Import → Timeline Markers from EDL */
function exportEdl(ctx, startHour = 1) {
  const fps = Math.round(ctx.fps()), off = startHour * 3600;
  const tcA = s => tc(s, fps);
  let out = `TITLE: ${ctx.p.title} V${ctx.ver.number}\nFCM: NON-DROP FRAME\n\n`;
  notesOf(ctx).forEach((n, i) => {
    const dur = Math.max(1, frames(Math.max(n.t1 - n.t0, 0), fps));
    const a = off + n.t0, b = a + dur / fps;
    out += `${String(i + 1).padStart(3, '0')}  001      V     C        ${tcA(a)} ${tcA(a + 1 / fps)} ${tcA(a)} ${tcA(a + 1 / fps)}  \n`;
    out += ` |C:ResolveColor${RESOLVE_COLORS[n.labels[0]] || 'Blue'} |M:#${n.seq} ${n.labels.map(l => labelById(l).name).join('/')}: ${n.text.replace(/\s+/g, ' ')} |D:${dur}\n\n`;
    void b;
  });
  download(fname(ctx, 'edl'), out);
  toast('EDL скачан. В Resolve: правый клик по таймлайну → Timelines → Import → Timeline Markers from EDL', 'info');
}

/** XML (xmeml) — Premiere Pro: Файл → Импорт → последовательность с маркерами */
function exportXmeml(ctx) {
  const fps = Math.round(ctx.fps()), ntsc = [23.976, 29.97, 59.94].includes(ctx.fps()) ? 'TRUE' : 'FALSE';
  const dur = frames(ctx.dur(), fps);
  const x = s => esc(s);
  const markers = notesOf(ctx).map(n => `      <marker><name>${x(`#${n.seq} ${labelById(n.labels[0]).name}`)}</name><comment>${x(n.text)}</comment><in>${frames(n.t0, fps)}</in><out>${n.t1 > n.t0 ? frames(n.t1, fps) : -1}</out></marker>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${x(`${ctx.p.title} — правки V${ctx.ver.number}`)}</name>
    <duration>${dur}</duration>
    <rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate>
    <timecode><rate><timebase>${fps}</timebase><ntsc>${ntsc}</ntsc></rate><string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
${markers}
    <media><video><format><samplecharacteristics><width>${ctx.ver.width || 1920}</width><height>${ctx.ver.height || 1080}</height></samplecharacteristics></format><track/></video><audio><track/></audio></media>
  </sequence>
</xmeml>`;
  download(fname(ctx, 'xml'), xml, 'application/xml');
  toast('XML скачан. В Premiere: Файл → Импорт — появится последовательность с маркерами правок');
}

/** FCPXML — Final Cut Pro: Файл → Импорт → XML */
function exportFcpxml(ctx) {
  const fps = Math.round(ctx.fps());
  const r = f => `${f}/${fps}s`;
  const dur = frames(ctx.dur(), fps);
  const x = s => esc(s);
  const markers = notesOf(ctx).map(n => `              <marker start="${r(frames(n.t0, fps))}" duration="${r(Math.max(1, frames(n.t1 - n.t0, fps)))}" value="${x(`#${n.seq} ${labelById(n.labels[0]).name}: ${n.text}`)}"${RESOLVED.has(n.status) ? ' completed="1"' : n.priority === 'critical' ? ' completed="0"' : ''}/>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="1/${fps}s" width="${ctx.ver.width || 1920}" height="${ctx.ver.height || 1080}"/>
  </resources>
  <library>
    <event name="СпектрОптик">
      <project name="${x(`${ctx.p.title} — правки V${ctx.ver.number}`)}">
        <sequence format="r1" duration="${r(dur)}" tcStart="0s" tcFormat="NDF">
          <spine>
            <gap name="Правки" offset="0s" duration="${r(dur)}" start="0s">
${markers}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
  download(fname(ctx, 'fcpxml'), xml, 'application/xml');
  toast('FCPXML скачан. В Final Cut: Файл → Импорт → XML');
}

function exportJson(ctx) { download(`${slug(ctx.p.title)}.spectroptik.json`, exportProjectJson(ctx.p), 'application/json'); toast('Файл проекта скачан'); }

function printReport(ctx) {
  const v = ctx.ver;
  const notes = notesOf(ctx, true);
  const rep = h('div.report',
    h('h1', ctx.p.title),
    h('div.rmeta', `Версия V${v.number}${v.title ? ' — ' + v.title : ''} · ${v.status} · длительность ${tc(ctx.dur(), ctx.fps())} · правок: ${notes.length} · ${new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`),
    notes.map(n => h('div.ritem',
      h('div', { html: noteThumbSvg(n, ctx.aspect(), 200) }),
      h('div',
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, `#${n.seq} · ${tc(n.t0, ctx.fps())}${n.t1 > n.t0 ? ' → ' + tc(n.t1, ctx.fps()) : ''} · ${n.labels.map(l => labelById(l).name).join(', ')} · ${statusById(n.status).name}${n.priority === 'critical' ? ' · КРИТИЧНО' : ''}`),
        h('div', n.text),
        h('div', { style: { color: '#555', marginTop: '4px' } }, `Автор: ${userById(n.authorId)?.name || 'Гость'}`),
        n.replies.map(r => h('div', { style: { color: '#333', marginTop: '3px', paddingLeft: '10px', borderLeft: '2px solid #ddd' } }, `${userById(r.authorId)?.name || 'Гость'}: ${r.text}`))))),
  );
  document.getElementById('app').append(rep);
  const done = () => { rep.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 100);
}

// ——— Сравнение версий ———
async function openCompare(ctx) {
  const vs = ctx.p.versions;
  let A = vs[vs.indexOf(ctx.ver) - 1] || vs[0], B = ctx.ver;
  if (A === B) A = vs.find(v => v !== B);
  let mode = 'side';
  const va = h('video', { muted: true, playsinline: true }), vb = h('video', { playsinline: true });
  const vids = h('div.vids');
  const wipe = h('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Положение шторки', hidden: true });
  const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Позиция' });
  const tcEl = h('span.mono');
  const playBtn = h('button.btn', { html: icon('play', 16) + 'Воспроизвести' });
  const selA = h('select.select', { style: { width: 'auto', background: '#222', color: '#fff', borderColor: '#333' }, 'aria-label': 'Версия слева' }, vs.map(v => h('option', { value: v.id, selected: v === A }, `V${v.number} ${v.title || ''}`)));
  const selB = h('select.select', { style: { width: 'auto', background: '#222', color: '#fff', borderColor: '#333' }, 'aria-label': 'Версия справа' }, vs.map(v => h('option', { value: v.id, selected: v === B }, `V${v.number} ${v.title || ''}`)));
  const tagA = h('span.tag.mono'), tagB = h('span.tag.mono');
  const boxA = h('div.vid', va, tagA), boxB = h('div.vid', vb, tagB);
  vids.append(boxA, boxB);

  const layoutMode = () => {
    vids.className = 'vids' + (mode === 'wipe' ? ' wipe' : '');
    wipe.hidden = mode !== 'wipe';
    if (mode === 'wipe') { Object.assign(boxB.style, { position: 'absolute', inset: '0', clipPath: `inset(0 0 0 ${wipe.value}%)` }); boxA.style.position = 'absolute'; boxA.style.inset = '0'; }
    else { boxB.style.cssText = ''; boxA.style.cssText = ''; }
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  };
  const seg = h('div.seg', h('button', { dataset: { m: 'side' }, onclick: () => { mode = 'side'; layoutMode(); } }, 'Рядом'), h('button', { dataset: { m: 'wipe' }, onclick: () => { mode = 'wipe'; layoutMode(); } }, 'Шторка'));
  wipe.addEventListener('input', layoutMode);

  const load = async (vid, ver, tag) => { tag.textContent = `V${ver.number}`; try { vid.src = await playableUrl(ver); } catch (e) { toast(e.message, 'error'); } };
  selA.onchange = () => { A = vs.find(v => v.id === selA.value); load(va, A, tagA); };
  selB.onchange = () => { B = vs.find(v => v.id === selB.value); load(vb, B, tagB); };
  await Promise.all([load(va, A, tagA), load(vb, B, tagB)]);
  const dur = () => Math.max(va.duration || 0, vb.duration || 0) || 1;
  const sync = t => { va.currentTime = Math.min(t, (va.duration || t) - 0.01); vb.currentTime = Math.min(t, (vb.duration || t) - 0.01); };
  vb.currentTime = va.currentTime = ctx.t();
  playBtn.onclick = () => { if (vb.paused) { sync(vb.currentTime); va.play(); vb.play(); } else { va.pause(); vb.pause(); } };
  const tick = () => { scrub.value = (vb.currentTime / dur()) * 1000; tcEl.textContent = tc(vb.currentTime, ctx.fps()); playBtn.innerHTML = icon(vb.paused ? 'play' : 'pause', 16) + (vb.paused ? 'Воспроизвести' : 'Пауза'); if (!vb.paused && Math.abs(va.currentTime - vb.currentTime) > 0.15) va.currentTime = vb.currentTime; };
  vb.addEventListener('timeupdate', tick); vb.addEventListener('play', tick); vb.addEventListener('pause', tick);
  scrub.addEventListener('input', () => sync((scrub.value / 1000) * dur()));

  const close = () => { va.pause(); vb.pause(); wrap.remove(); document.removeEventListener('keydown', key, true); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); playBtn.click(); } };
  document.addEventListener('keydown', key, true);
  const wrap = h('div.compare-wrap', { role: 'dialog', 'aria-label': 'Сравнение версий' },
    h('div.ch', h('b', 'Сравнение версий'), selA, h('span', 'и'), selB, seg, h('div.grow'), h('button.btn', { onclick: close, html: icon('x', 16) + 'Закрыть' })),
    vids,
    h('div.cf', playBtn, tcEl, scrub, wipe));
  document.body.append(wrap);
  layoutMode();
}

return { openExportMenu, exportCsv, exportEdl, exportXmeml, exportFcpxml, exportJson, printReport, openCompare };
})();

// ——— timeline.js ———
M['timeline'] = (() => {
// Таймлайн правок: шкала, лента кадров, звуковая волна, плотность, дорожки с маркерами.
const { h, fill, icon, clamp, tcShort, esc, relTime, initials } = window.SPO.util;
const { LABELS, labelById, STATUSES, statusById, RESOLVED, userById, can, updateNote, getState, commit, roleName } = window.SPO.store;
const { noteThumbSvg } = window.SPO.shapes;
const GUT = 112;
const GROUPS = [
  { id: 'label', name: 'Ярлыки' }, { id: 'author', name: 'Авторы' }, { id: 'status', name: 'Статусы' }, { id: 'one', name: 'Одна' },
];

function mountTimeline(root, ctx) {
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
    if (g === 'status') return STATUSES.map(s => ({ id: s.id, name: s.name, color: { open: '#000', progress: '#3546E0', question: '#E8A400', fixed: '#1F8F5F' }[s.id] || '#85857C', match: n => n.status === s.id }));
    if (g === 'author') {
      const ids = [...new Set([...notes.map(n => n.authorId), ctx.u().id])];
      return ids.map(id => { const u = userById(id); return { id, name: u?.name.split(' ')[0] || 'Гость', color: u?.color || '#888', match: n => n.authorId === id, sub: u ? roleName(u.role) : '' }; });
    }
    return [{ id: 'all', name: 'Все правки', color: '#000', match: () => true }];
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
  };

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
    if (ctx.group === 'status') return { open: '#000', progress: '#3546E0', question: '#E8A400', fixed: '#1F8F5F' }[n.status] || '#85857C';
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
    const style = { '--c': d.labels[0] ? labelById(d.labels[0]).color : '#000', left: x(d.t0) + 'px' };
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
    g.fillStyle = '#DCDCD6'; g.fillRect(0, 0, c.width, c.height);
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

return { mountTimeline };
})();

// ——— panel.js ———
M['panel'] = (() => {
// Правая панель: правки (список, фильтры, тред), композер новой правки, главы YouTube, чеклист и сводка.
const { h, fill, icon, esc, relTime, popover, toast, modal, copyText, initials, tcShort, uid } = window.SPO.util;
const { LABELS, labelById, STATUSES, statusById, PRIORITIES, KINDS, RESOLVED, userById, can, setStatus, updateNote, deleteNote, addReply, commit, touch, roleName, getState } = window.SPO.store;
const { noteThumbSvg } = window.SPO.shapes;
function mountPanel(root, ctx) {
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
        n.priority !== 'important' ? h('span.prio.' + n.priority, PRIORITIES.find(p => p.id === n.priority).name) : null,
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

return { mountPanel };
})();

// ——— review.js ———
M['review'] = (() => {
// Экран «Ревью»: плеер + холст правок, инструменты, транспорт, верхняя панель.
const { h, fill, $, icon, tc, clamp, toast, modal, popover, initials, logoSvg, uid, copyText, esc } = window.SPO.util;
const { getProject, me, can, commit, LABELS, labelById, RESOLVED, STAGES, VERSION_STATUSES, addNote, updateNote, roleName, getState, touch, ev, PRIORITIES } = window.SPO.store;
const { playableUrl, explainMediaError, registerLocalFile, attachHls } = window.SPO.sources;
const { shapeSvg, HATCH_DEF, hitShape, moveShape } = window.SPO.shapes;
const { mountTimeline } = M['timeline'];
const { mountPanel } = M['panel'];
const { openAddVersion, openIdentity } = window.SPO.versions;
const { openExportMenu, openCompare } = M['export'];
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

function mountReview(root, project, query = {}) {
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
      can.addVersion(ctx.u()) ? h('button.menu-item', { onclick: () => { pop.close(); openAddVersion(ctx.p, { onAdded: v => switchVersion(v.id) }); }, html: icon('plus', 16) + 'Новая версия' }) : h('div.menu-title', 'Версии добавляет монтажёр')]);
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
        showState(h('div.box', h('p', e.message), h('label.btn', { html: icon('upload', 16) + 'Выбрать файл' }, inp)));
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
          h('button.btn', { onclick: () => Promise.resolve(M['export']).then(m => m.exportJson(ctx)), html: icon('download', 16) + 'Скачать файл проекта' }),
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

return { mountReview };
})();
window.SPO_REVIEW = { mountReview: M.review.mountReview };
})();
