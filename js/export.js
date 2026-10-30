// Экспорт правок и сравнение версий
import { h, fill, icon, popover, download, toast, tc, tcShort, esc, clamp } from './util.js';
import { labelById, statusById, PRIORITIES, userById, RESOLVED, exportProjectJson } from './store.js';
import { playableUrl } from './sources.js';
import { noteThumbSvg } from './shapes.js';
import { projectForExport, preloadFrames } from './cloud.js';

const RESOLVE_COLORS = { content: 'Red', color: 'Sand', thumb: 'Yellow', sound: 'Green', subs: 'Cyan', cut: 'Blue', titles: 'Purple', fx: 'Pink', q: 'Cream' };

export function openExportMenu(anchor, ctx) {
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

export function exportCsv(ctx) {
  const rows = [['№', 'Версия', 'Начало', 'Конец', 'Ярлыки', 'Приоритет', 'Статус', 'Автор', 'Текст', 'Ответов']];
  for (const n of notesOf(ctx, true)) rows.push([n.seq, 'V' + ctx.ver.number, tc(n.t0, ctx.fps()), n.t1 > n.t0 ? tc(n.t1, ctx.fps()) : '', n.labels.map(l => labelById(l).name).join(', '),
    (PRIORITIES.find(p => p.id === n.priority)?.name || ''), statusById(n.status).name, userById(n.authorId)?.name || 'Гость', n.text, n.replies.length]);
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(fname(ctx, 'csv'), csv, 'text/csv'); toast('Таблица правок скачана');
}

/** EDL с маркерами: Resolve → Timeline → Import → Timeline Markers from EDL */
export function exportEdl(ctx, startHour = 1) {
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
export function exportXmeml(ctx) {
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
export function exportFcpxml(ctx) {
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

export async function exportJson(ctx) { toast('Собираю файл проекта…'); const full = await projectForExport(ctx.p); download(`${slug(ctx.p.title)}.spectroptik.json`, exportProjectJson(full), 'application/json'); toast('Файл проекта скачан'); }

export async function printReport(ctx) {
  const v = ctx.ver;
  const notes = notesOf(ctx, true);
  await preloadFrames(notes);
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
export async function openCompare(ctx) {
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
