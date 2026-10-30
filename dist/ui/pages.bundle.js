(() => {
'use strict';
const M = {};
// ——— analytics.js ———
M['analytics'] = (() => {
// Аналитика: YouTube Data API v3 (по ключу), Telegram Bot API, Rutube. Данные кешируются в браузере.
const { h, fill, icon, toast, relTime, esc } = window.SPO.util;
const { commit } = window.SPO.store;
const { crm, fmtNum, todayStr, ytId, KIND } = window.SPO.data;
const { pageHead } = window.SPO.shell;
const YT = 'https://www.googleapis.com/youtube/v3';
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SLOTS = [[0, 6, 'ночь'], [6, 12, 'утро'], [12, 18, 'день'], [18, 24, 'вечер']];

// ——— YouTube ———
async function yt(path, q) {
  const key = crm().settings.yt.key.trim();
  let r;
  try { r = await fetch(`${YT}/${path}?${new URLSearchParams({ ...q, key })}`); } catch { throw new Error('Нет связи с YouTube API. Проверьте интернет.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = j.error?.errors?.[0]?.reason;
    if (reason === 'keyInvalid' || r.status === 400 && /key/i.test(j.error?.message || '')) throw new Error('Ключ YouTube API не подходит. Проверьте его в настройках.');
    if (reason === 'quotaExceeded') throw new Error('Дневная квота YouTube API исчерпана — обновите завтра.');
    if (r.status === 403) throw new Error('YouTube API отклонил запрос: включите «YouTube Data API v3» в Google Cloud для этого ключа и проверьте ограничения по сайтам.');
    throw new Error(j.error?.message || `YouTube API: ошибка ${r.status}`);
  }
  return j;
}
function channelQuery(raw) {
  const v = raw.trim();
  const id = v.match(/(UC[\w-]{22})/); if (id) return { id: id[1] };
  const handle = v.match(/@([\w.\-]+)/) || v.match(/^([\w.\-]+)$/);
  if (handle) return { forHandle: '@' + handle[1] };
  throw new Error('Укажите канал как @имя или ID вида UC…');
}
const isoDur = s => { const m = (s || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0); };

async function refreshYouTube() {
  const s = crm(), st = s.settings.yt;
  if (!st.key || !st.channel) throw new Error('Добавьте ключ YouTube API и канал в настройках.');
  const ch = (await yt('channels', { part: 'snippet,statistics,contentDetails', ...channelQuery(st.channel) })).items?.[0];
  if (!ch) throw new Error('Канал не найден. Проверьте @имя или ID.');
  const uploads = ch.contentDetails.relatedPlaylists.uploads;
  let ids = [], page = '';
  for (let i = 0; i < 4; i++) {
    const pl = await yt('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50, ...(page ? { pageToken: page } : {}) });
    ids.push(...pl.items.map(x => x.contentDetails.videoId));
    page = pl.nextPageToken; if (!page) break;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const vs = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
    for (const v of vs.items) {
      const dur = isoDur(v.contentDetails.duration);
      videos.push({ id: v.id, title: v.snippet.title, at: v.snippet.publishedAt, thumb: v.snippet.thumbnails?.medium?.url || '', dur, short: dur > 0 && dur <= 180,
        views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0 });
    }
  }
  const seen = new Set();
  for (let i = videos.length - 1; i >= 0; i--) { if (seen.has(videos[i].id)) videos.splice(i, 1); else seen.add(videos[i].id); }
  videos.sort((a, b) => b.at.localeCompare(a.at));
  s.analytics.channel = { id: ch.id, title: ch.snippet.title, thumb: ch.snippet.thumbnails?.default?.url, subs: +ch.statistics.subscriberCount || 0, views: +ch.statistics.viewCount || 0, count: +ch.statistics.videoCount || 0 };
  s.analytics.videos = videos;
  s.analytics.fetchedAt = Date.now();
  const d = todayStr(); s.history = s.history.filter(x => x.d !== d); s.history.push({ d, subs: s.analytics.channel.subs, views: s.analytics.channel.views });
  if (s.history.length > 400) s.history.shift();
  // Ссылки выпусков на ролики — подтягиваем статус «опубликован»
  for (const r of s.releases) { const id = ytId(r.platforms.youtube?.url); if (id && videos.some(v => v.id === id) && r.platforms.youtube.status !== 'published') r.platforms.youtube.status = 'published'; }
  commit();
}

// ——— Telegram ———
async function tg(method, body) {
  const t = crm().settings.tg.token.trim();
  if (!t) throw new Error('Добавьте токен бота в настройках.');
  let r;
  try { r = await fetch(`https://api.telegram.org/bot${t}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); } catch { throw new Error('Нет связи с Telegram.'); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description === 'Unauthorized' ? 'Токен бота неверный.' : /chat not found/i.test(j.description) ? 'Канал не найден. Добавьте бота админом в канал и укажите @имя.' : (j.description || 'Ошибка Telegram'));
  return j.result;
}
const tgChat = () => { const c = crm().settings.tg.chat.trim(); return c.startsWith('@') || c.startsWith('-') ? c : '@' + c.replace(/^https?:\/\/t\.me\//, ''); };
async function tgSend(text) {
  const m = await tg('sendMessage', { chat_id: tgChat(), text });
  const c = tgChat();
  return { url: c.startsWith('@') ? `https://t.me/${c.slice(1)}/${m.message_id}` : '' };
}
async function refreshTelegram() {
  const n = await tg('getChatMemberCount', { chat_id: tgChat() });
  const s = crm(); s.analytics.tg = { members: n, at: Date.now() };
  const d = todayStr(), hRow = s.history.find(x => x.d === d); if (hRow) hRow.tg = n; else s.history.push({ d, tg: n });
  commit();
}

// ——— Rutube ———
async function refreshRutube() {
  const id = crm().settings.rutube.person.trim().match(/(\d+)/)?.[1];
  if (!id) throw new Error('Укажите ID канала Rutube (число из ссылки rutube.ru/channel/…).');
  let r;
  try { r = await fetch(`https://rutube.ru/api/video/person/${id}/?page=1&page_size=50`); } catch { throw new Error('Rutube не отдаёт статистику напрямую в браузер. Цифры Rutube пока вносите вручную в карточке выпуска.'); }
  const j = await r.json();
  const s = crm(); s.analytics.rutube = { at: Date.now(), videos: (j.results || []).map(v => ({ id: v.id, title: v.title, views: v.hits || 0, at: v.publication_ts || v.created_ts, url: v.video_url })) };
  commit();
}

// ——— Страница ———
let kindF = 'all', sortF = 'date';
function renderAnalytics(root) {
  const wrap = h('div'); root.append(wrap);
  let busy = false;
  const refreshAll = async () => {
    if (busy) return; busy = true; draw();
    const s = crm(), errs = [];
    if (s.settings.yt.key) await refreshYouTube().catch(e => errs.push(e.message));
    if (s.settings.tg.token && s.settings.tg.chat) await refreshTelegram().catch(e => errs.push('Telegram: ' + e.message));
    if (s.settings.rutube.person) await refreshRutube().catch(e => errs.push('Rutube: ' + e.message));
    busy = false; draw();
    errs.length ? errs.forEach(e => toast(e, 'error')) : toast('Данные обновлены');
  };
  const draw = () => {
    const s = crm(), a = s.analytics, ch = a.channel, vids = a.videos || [];
    const head = pageHead('Аналитика', ch ? `${ch.title} · обновлено ${relTime(a.fetchedAt)}` : 'Цифры YouTube, Telegram и Rutube в одном месте — и выводы, что работает.',
      h('button.btn.primary', { disabled: busy, onclick: refreshAll, html: icon('refresh', 16) + (busy ? 'Обновляю…' : 'Обновить') }));
    if (!s.settings.yt.key || !s.settings.yt.channel) {
      fill(wrap, head, h('div.panel-box', h('div.empty-state', h('div', { html: icon('chart', 40) }), h('h3', 'Подключите YouTube'),
        h('p', 'Нужен бесплатный ключ YouTube Data API и @имя канала. Это 3 минуты в Google Cloud — пошаговая инструкция в настройках.'),
        h('a.btn.primary', { href: '#/settings' }, 'Открыть настройки'))));
      return;
    }
    if (!vids.length) { fill(wrap, head, h('div.panel-box', h('div.empty-state', h('h3', 'Данных ещё нет'), h('p', 'Нажмите «Обновить» — подтянем канал и последние 200 роликов.')))); return; }
    const longs = vids.filter(v => !v.short), shorts = vids.filter(v => v.short);
    const avg = l => l.length ? Math.round(l.reduce((x, v) => x + v.views, 0) / l.length) : 0;
    const med = l => { if (!l.length) return 0; const s2 = l.map(v => v.views).sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]; };
    const er = v => v.views ? (v.likes + v.comments) / v.views : 0;
    const hist = s.history.filter(x => x.subs != null);
    const h30 = hist.find(x => x.d >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    const dSubs = h30 && hist.length > 1 ? ch.subs - h30.subs : null;
    const last30 = vids.filter(v => Date.now() - Date.parse(v.at) < 30 * 864e5);
    const g = s.settings.goals;
    const list = vids.filter(v => kindF === 'all' || (kindF === 'short') === v.short).slice()
      .sort((x, y) => sortF === 'views' ? y.views - x.views : sortF === 'er' ? er(y) - er(x) : y.at.localeCompare(x.at));
    const relByVid = Object.fromEntries(s.releases.map(r => [ytId(r.platforms.youtube?.url), r]).filter(([k]) => k));

    fill(wrap, head,
      h('div.kpis',
        kpi(fmtNum(ch.subs), 'подписчиков', dSubs != null ? h('span.delta' + (dSubs >= 0 ? '.up' : '.down'), `${dSubs >= 0 ? '+' : ''}${fmtNum(dSubs)} за 30 дн`) : null),
        kpi(fmtNum(ch.views), 'просмотров всего'),
        kpi(fmtNum(med(longs.slice(0, 10))), 'медиана выпуска · 10 последних'),
        kpi(fmtNum(med(shorts.slice(0, 30))), 'медиана Shorts · 30 последних'),
        kpi(`${last30.filter(v => !v.short).length}+${last30.filter(v => v.short).length}`, `вышло за 30 дн · цель ${g.long}+${g.short}`),
        a.tg ? kpi(fmtNum(a.tg.members), 'подписчиков Telegram') : null),
      h('div.cols.c2',
        h('section.panel-box', h('h2', 'Просмотры последних 30 роликов'), barChart(vids.slice(0, 30).reverse())),
        h('section.panel-box', h('h2', 'Что работает'), h('div.insights', insights(vids, longs, shorts, avg, med, er, g, last30).map(([ic, t]) => h('div.insight', h('span.ic-b', { html: icon(ic, 16) }), h('div', { html: t })))))),
      h('div.cols.c2', { style: { marginTop: '16px' } },
        h('section.panel-box', h('h2', 'Когда публиковать'), h('p.note-line', { style: { margin: '-6px 0 12px' } }, 'Средние просмотры по дню и времени выхода (ваш часовой пояс).'), heatmap(vids)),
        h('section.panel-box', h('h2', 'Рост подписчиков'), hist.length > 1 ? lineChart(hist) : h('p.note-line', 'График появится после нескольких обновлений в разные дни — история копится в этом браузере.'))),
      h('section.panel-box', { style: { marginTop: '16px' } },
        h('h2', `Ролики · ${list.length}`, h('span.grow'),
          h('div.seg', [['all', 'Все'], ['long', 'Выпуски'], ['short', 'Shorts']].map(([k, n]) => h('button' + (kindF === k ? '.on' : ''), { onclick: () => { kindF = k; draw(); } }, n))),
          h('div.seg', [['date', 'Новые'], ['views', 'Просмотры'], ['er', 'Вовлечённость']].map(([k, n]) => h('button' + (sortF === k ? '.on' : ''), { onclick: () => { sortF = k; draw(); } }, n)))),
        h('div.rows', list.slice(0, 60).map(v => h('a.vid-row', { href: `https://youtu.be/${v.id}`, target: '_blank', rel: 'noopener' },
          h('img', { src: v.thumb, alt: '', loading: 'lazy' }),
          h('div', h('div.t', v.title), h('div.s', `${new Date(v.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })} · ${v.short ? 'Shorts' : fmtDur(v.dur)} · ER ${(er(v) * 100).toFixed(1)}%${relByVid[v.id] ? ' · в CRM' : ''}`)),
          h('div.v', fmtNum(v.views), h('div.s', `${fmtNum(v.likes)} лайков · ${fmtNum(v.comments)} комм.`)))))),
      a.rutube?.videos?.length ? h('section.panel-box', { style: { marginTop: '16px' } }, h('h2', 'Rutube'), h('div.rows', a.rutube.videos.slice(0, 20).map(v => h('a.row-item', { href: v.url, target: '_blank', rel: 'noopener' }, h('span'), h('div.t', v.title), h('span.mono', fmtNum(v.views)))))) : null,
      h('p.note-line', { style: { marginTop: '14px' } }, 'Удержание, CTR превью и источники трафика есть только в YouTube Analytics API — для него нужен вход через Google-аккаунт канала. Это следующий шаг подключения.'),
    );
  };
  draw();
  return { refresh: draw };
}

const kpi = (n, l, extra) => h('div.kpi', h('div.n', n), h('div.l', l), extra);
const fmtDur = s => s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const pct = x => `${Math.round(x * 100)}%`;

function insights(vids, longs, shorts, avg, med, er, g, last30) {
  const out = [];
  // лучший день
  const byDow = Array.from({ length: 7 }, () => []);
  vids.slice(0, 120).forEach(v => byDow[(new Date(v.at).getDay() + 6) % 7].push(v.views));
  const dowAvg = byDow.map(l => l.length >= 2 ? l.reduce((a, b) => a + b, 0) / l.length : 0);
  const best = dowAvg.indexOf(Math.max(...dowAvg)), worst = dowAvg.indexOf(Math.min(...dowAvg.filter(Boolean)));
  if (dowAvg[best] && worst >= 0 && best !== worst) out.push(['calendar', `Лучший день выхода — <b>${['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'][best]}</b>: в среднем ${fmtNum(Math.round(dowAvg[best]))} просмотров против ${fmtNum(Math.round(dowAvg[worst]))} в худший день.`]);
  if (longs.length && shorts.length) out.push(['video', `Выпуск в среднем набирает <b>${fmtNum(avg(longs))}</b>, Shorts — <b>${fmtNum(avg(shorts))}</b>. Медианы: ${fmtNum(med(longs))} и ${fmtNum(med(shorts))}.`]);
  const top = vids.slice(0, 30).slice().sort((a, b) => b.views - a.views)[0];
  if (top) out.push(['sparkle', `Хит месяца: «${esc(top.title)}» — ${fmtNum(top.views)} просмотров, ER ${(er(top) * 100).toFixed(1)}%. Разберите, что сработало: тема, превью, первые 5 секунд.`]);
  const m10 = med(vids.slice(0, 20)), weak = vids.slice(0, 10).filter(v => Date.now() - Date.parse(v.at) > 3 * 864e5 && v.views < m10 * 0.5);
  if (weak.length) out.push(['flag', `Просели (меньше половины медианы): ${weak.slice(0, 3).map(v => `«${esc(v.title)}»`).join(', ')}. Попробуйте заменить превью и название.`]);
  const lp = last30.filter(v => !v.short).length, sp = last30.filter(v => v.short).length;
  out.push(['clock', `За 30 дней вышло ${lp} из ${g.long} выпусков и ${sp} из ${g.short} Shorts (${pct(Math.min(1, (lp + sp) / (g.long + g.short)))} плана).`]);
  const shortT = vids.filter(v => v.title.length <= 45), longT = vids.filter(v => v.title.length > 45);
  if (shortT.length >= 5 && longT.length >= 5) { const a = med(shortT), b = med(longT); out.push(['text', a > b * 1.2 ? `Короткие названия (до 45 знаков) собирают больше: медиана ${fmtNum(a)} против ${fmtNum(b)}.` : b > a * 1.2 ? `Длинные названия (больше 45 знаков) работают лучше: медиана ${fmtNum(b)} против ${fmtNum(a)}.` : 'Длина названия заметно не влияет на просмотры.']); }
  return out;
}

function barChart(list) {
  const W = 600, H = 200, max = Math.max(1, ...list.map(v => v.views)), bw = W / Math.max(list.length, 1);
  return h('div', { html: `<svg class="chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Просмотры роликов">
    ${[0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${H - H * f}" y2="${H - H * f}" stroke="#E4E4DE"/><text x="2" y="${H - H * f + 11}">${fmtNum(Math.round(max * f))}</text>`).join('')}
    ${list.map((v, i) => { const bh = Math.max(2, v.views / max * (H - 4)); return `<rect x="${i * bw + 2}" y="${H - bh}" width="${Math.max(2, bw - 4)}" height="${bh}" rx="2" fill="${v.short ? '#F2711C' : '#000'}"><title>${esc(v.title)} — ${fmtNum(v.views)}</title></rect>`; }).join('')}
    <circle cx="8" cy="${H + 11}" r="4" fill="#000"/><text x="16" y="${H + 14}">выпуск</text><circle cx="72" cy="${H + 11}" r="4" fill="#F2711C"/><text x="80" y="${H + 14}">shorts</text>
  </svg>` }).firstChild;
}

function lineChart(hist) {
  const W = 600, H = 180, pts = hist.slice(-90), min = Math.min(...pts.map(p => p.subs)), max = Math.max(...pts.map(p => p.subs)), span = Math.max(1, max - min);
  const xy = pts.map((p, i) => [i / Math.max(1, pts.length - 1) * (W - 10) + 5, H - 10 - (p.subs - min) / span * (H - 30)]);
  return h('div', { html: `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Подписчики"><polyline fill="none" stroke="#3546E0" stroke-width="2.5" points="${xy.map(p => p.join(',')).join(' ')}"/>
    <text x="5" y="12">${fmtNum(max)}</text><text x="5" y="${H - 2}">${fmtNum(min)} · ${pts[0].d}</text><text x="${W - 5}" y="${H - 2}" text-anchor="end">${pts[pts.length - 1].d}</text></svg>` }).firstChild;
}

function heatmap(vids) {
  const cells = Array.from({ length: 4 }, () => Array.from({ length: 7 }, () => []));
  vids.slice(0, 150).forEach(v => { const d = new Date(v.at); const slot = SLOTS.findIndex(([a, b]) => d.getHours() >= a && d.getHours() < b); cells[slot][(d.getDay() + 6) % 7].push(v.views); });
  const avgs = cells.map(r => r.map(l => l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0));
  const max = Math.max(1, ...avgs.flat());
  return h('div.heat', h('span'), DOW.map(d => h('span', { style: { textAlign: 'center' } }, d)),
    SLOTS.map(([, , n], si) => [h('span', { style: { alignSelf: 'center' } }, n), avgs[si].map((v, di) => h('div.c', { title: v ? `${fmtNum(Math.round(v))} в среднем · ${cells[si][di].length} рол.` : 'нет данных', style: { background: v ? `rgba(53,70,224,${0.12 + 0.88 * v / max})` : '', color: v / max > 0.55 ? '#fff' : '' } }, v ? fmtNum(Math.round(v)) : ''))]).flat());
}

return { refreshYouTube, tgSend, refreshTelegram, refreshRutube, renderAnalytics };
})();

// ——— overview.js ———
M['overview'] = (() => {
// Обзор: цели месяца, ближайшие выходы, горящие задачи, правки на проверке, цифры канала.
const { h, fill, icon, relTime } = window.SPO.util;
const { me, RESOLVED } = window.SPO.store;
const { crm, monthReleases, MONTHS, fmtDay, todayStr, PLATFORMS, stageById, KIND, fmtNum, createRelease, ymd } = window.SPO.data;
const { pageHead, isDone } = window.SPO.shell;
function renderOverview(root) {
  const wrap = h('div'); root.append(wrap);
  const draw = () => {
    const s = crm(), u = me(), now = new Date(), today = todayStr();
    const mon = monthReleases(now.getFullYear(), now.getMonth());
    const longs = mon.filter(r => r.kind === 'long'), shorts = mon.filter(r => r.kind === 'short');
    const pubLong = longs.filter(r => r.stage === 'published').length, pubShort = shorts.filter(r => r.stage === 'published').length;
    const g = s.settings.goals;
    const in7 = ymd(new Date(Date.now() + 7 * 864e5));
    const upcoming = s.releases.filter(r => r.date && r.date >= today && r.date <= in7 && r.stage !== 'published').sort((a, b) => a.date.localeCompare(b.date));
    const noDate = s.releases.filter(r => !r.date && r.stage !== 'published').length;
    const tasks = s.tasks.filter(t => !isDone(t, s) && t.due && t.due <= in7).sort((a, b) => a.due.localeCompare(b.due));
    const toCheck = s.projects.flatMap(p => p.notes.filter(n => n.status === 'fixed').map(n => ({ n, p })));
    const openNotes = s.projects.flatMap(p => p.notes).filter(n => !RESOLVED.has(n.status) && n.kind !== 'approval').length;
    const ch = s.analytics.channel;
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

    const goalKpi = (label, plan, done, goal) => h('div.kpi',
      h('div.n', String(done), h('small', ` / ${goal}`)),
      h('div.l', `${label}: вышло · в плане ${plan}`),
      h('div.meter', h('i' + (done >= goal ? '.ok' : ''), { style: { width: Math.min(100, done / goal * 100) + '%' } })));

    fill(wrap,
      pageHead(`${u.name.split(' ')[0]}, ${MONTHS[now.getMonth()]}`, `До конца месяца ${daysLeft} дн. Цель канала — ${g.long} выпуска и ${g.short} Shorts.`,
        h('button.btn', { onclick: () => { const r = createRelease({ kind: 'short' }); location.hash = `#/releases/${r.id}`; }, html: icon('plus', 16) + 'Shorts' }),
        h('button.btn.primary', { onclick: () => { const r = createRelease({ kind: 'long' }); location.hash = `#/releases/${r.id}`; }, html: icon('plus', 16) + 'Выпуск' })),
      h('div.kpis',
        goalKpi('Выпуски', longs.length, pubLong, g.long),
        goalKpi('Shorts', shorts.length, pubShort, g.short),
        h('div.kpi', h('div.n', String(openNotes)), h('div.l', `открытых правок · ${toCheck.length} ждут проверки`)),
        ch ? h('div.kpi', h('div.n', fmtNum(ch.subs)), h('div.l', `подписчиков YouTube · ${fmtNum(ch.views)} просмотров`))
          : h('a.kpi', { href: '#/settings', style: { textDecoration: 'none' } }, h('div.n', '—'), h('div.l', 'подключите YouTube в настройках'))),
      h('div.cols.c2',
        h('section.panel-box', h('h2', 'Ближайшие выходы', h('span.grow'), h('a', { href: '#/calendar' }, 'календарь →')),
          upcoming.length ? h('div.rows', upcoming.map(relRow)) : h('p.note-line', noDate ? `На неделю ничего не запланировано. Без даты: ${noDate} — поставьте их в календарь.` : 'На неделю ничего не запланировано.')),
        h('section.panel-box', h('h2', 'Задачи на неделю', h('span.grow'), h('a', { href: '#/board' }, 'доска →')),
          tasks.length ? h('div.rows', tasks.slice(0, 8).map(t => h('a.row-item', { href: '#/board' },
            h('span.datebox', h('b', t.due.slice(8)), h('span', t.due < today ? 'просрочено' : fmtDay(t.due).split(' ')[1].slice(0, 3))),
            h('div', h('div.t', t.title), h('div.s', s.columns.find(c => c.id === t.col)?.name || '')),
            t.due < today ? h('span.delta.down', '!') : h('span')))) : h('p.note-line', 'Срочных задач нет.')),
        h('section.panel-box', h('h2', 'Правки ждут проверки', h('span.grow'), h('a', { href: '#/reviews' }, 'все проекты →')),
          toCheck.length ? h('div.rows', toCheck.slice(0, 8).map(({ n, p }) => h('a.row-item', { href: `#/p/${p.id}?v=${n.versionId}&n=${n.id}` },
            h('b.mono', `#${n.seq}`), h('div', h('div.t', n.text), h('div.s', p.title)), h('span.s', relTime(n.updatedAt))))) : h('p.note-line', 'Монтажёр пока ничего не сдал на проверку.')),
        h('section.panel-box', h('h2', 'В работе'),
          h('div.rows', s.releases.filter(r => r.stage !== 'published').slice(0, 8).map(relRow)),
          !s.releases.length ? h('p.note-line', 'Выпусков пока нет. Создайте первый — кнопка сверху.') : null),
      ),
    );
  };
  draw();
  return { refresh: draw };
}

function relRow(r) {
  const st = stageById(r.stage);
  return h('a.row-item', { href: `#/releases/${r.id}` },
    r.date ? h('span.datebox', h('b', r.date.slice(8)), h('span', fmtDay(r.date).split(' ')[1].slice(0, 3))) : h('span.datebox', h('b', '—'), h('span', 'дата')),
    h('div', h('div.t', r.title), h('div.s', h('span.kind' + (r.kind === 'short' ? '.short' : ''), KIND[r.kind]), ' ', h('span.stage-pill', { style: { '--c': st.color } }, h('i'), st.name))),
    h('span.plats', PLATFORMS.map(p => h('span.plat.st-' + (r.platforms[p.id]?.status || 'off'), { style: { '--c': p.color }, title: p.name }, h('i'), p.name[0]))));
}

return { renderOverview, relRow };
})();

// ——— releases.js ———
M['releases'] = (() => {
// Выпуски: список и карточка выпуска с подготовкой под YouTube, Rutube и Telegram.
const { h, fill, icon, toast, modal, copyText, tcShort, esc } = window.SPO.util;
const { me, getState, createProject, RESOLVED, roleName } = window.SPO.store;
const { crm, PLATFORMS, REL_STAGES, PUB_STATUS, KIND, stageById, createRelease, updateRelease, deleteRelease, releaseById, releaseProgress, fmtDay, createTask, ytId, fmtNum } = window.SPO.data;
const { pageHead, isDone } = window.SPO.shell;
const { tgSend } = M['analytics'];
let fKind = 'all', fStage = 'active', fQuery = '';


const open = r => { location.hash = `#/releases/${r.id}`; };

function renderReleases(root, { parts }) {
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
    const title = h('input.title-input', { value: r.title, 'aria-label': 'Название выпуска', oninput: e => save({ title: e.target.value }), onchange: () => save({}, false) });
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

return { renderReleases };
})();

// ——— board.js ———
M['board'] = (() => {
// Задачи: канбан-доска команды. Карточки перетаскиваются между колонками.
const { h, fill, icon, modal, toast, initials, uid } = window.SPO.util;
const { getState, me, commit, PRIORITIES } = window.SPO.store;
const { crm, createTask, updateTask, deleteTask, releaseById, fmtDay, todayStr, KIND } = window.SPO.data;
const { pageHead } = window.SPO.shell;
let who = 'all', relFilter = '';

function renderBoard(root) {
  const wrap = h('div'); root.append(wrap);
  let dragId = null;
  const draw = () => {
    const s = crm(), users = getState().users, today = todayStr();
    const visible = t => (who === 'all' || (who === 'me' ? t.assignee === me().id : t.assignee === who)) && (!relFilter || t.releaseId === relFilter);
    fill(wrap,
      pageHead('Задачи', 'Доска команды: сценарий, съёмка, монтаж, публикация. Перетаскивайте карточки между колонками.',
        h('select.select', { style: { width: 'auto', height: '34px' }, onchange: e => { relFilter = e.target.value; draw(); } },
          h('option', { value: '' }, 'Все выпуски'), s.releases.map(r => h('option', { value: r.id, selected: relFilter === r.id }, `${KIND[r.kind]}: ${r.title}`))),
        h('div.seg.wide', h('button' + (who === 'all' ? '.on' : ''), { onclick: () => { who = 'all'; draw(); } }, 'Все'), h('button' + (who === 'me' ? '.on' : ''), { onclick: () => { who = 'me'; draw(); } }, 'Мои'),
          users.filter(u => u.id !== me().id).slice(0, 4).map(u => h('button' + (who === u.id ? '.on' : ''), { onclick: () => { who = u.id; draw(); } }, u.name.split(' ')[0]))),
        h('button.btn.primary', { onclick: () => edit(createTask({ assignee: me().id, releaseId: relFilter })), html: icon('plus', 16) + 'Задача' })),
      h('div.board', s.columns.map((col, ci) => {
        const items = s.tasks.filter(t => t.col === col.id && visible(t)).sort((a, b) => a.order - b.order);
        const el = h('section.kcol', { dataset: { col: col.id } },
          h('div.kcol-head', h('b', { contenteditable: 'plaintext-only', spellcheck: 'false', onblur: e => { const n = e.target.textContent.trim(); if (n && n !== col.name) { col.name = n; commit(); } }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }, col.name),
            h('span.n', String(items.length)), h('span.grow'),
            ci === s.columns.length - 1 ? h('button.icon-btn', { title: 'Добавить колонку', 'aria-label': 'Добавить колонку', onclick: () => { s.columns.push({ id: uid('col_'), name: 'Новая колонка' }); commit(); }, html: icon('plus', 15) })
              : null),
          items.map(t => card(t, users, today, col, s)),
          h('button.add-card', { onclick: () => edit(createTask({ col: col.id, assignee: me().id, releaseId: relFilter })) }, '+ Задача'));
        el.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); el.classList.add('drop'); } });
        el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
        el.addEventListener('drop', e => {
          e.preventDefault(); el.classList.remove('drop');
          const t = s.tasks.find(x => x.id === dragId); if (!t) return;
          const after = [...el.querySelectorAll('.kcard')].find(c => c.getBoundingClientRect().top + c.offsetHeight / 2 > e.clientY);
          const ref = after && s.tasks.find(x => x.id === after.dataset.id);
          updateTask(t, { col: col.id, order: ref ? ref.order - 0.5 : Date.now() });
        });
        return el;
      })),
    );
  };
  function card(t, users, today, col, s) {
    const u = users.find(x => x.id === t.assignee), r = t.releaseId && releaseById(t.releaseId);
    const doneN = t.checks.filter(c => c.done).length;
    const el = h('article.kcard', { draggable: 'true', dataset: { id: t.id }, onclick: () => edit(t) },
      h('div.kt', t.title),
      r ? h('div.km', h('span.kind' + (r.kind === 'short' ? '.short' : ''), KIND[r.kind]), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.title)) : null,
      h('div.km',
        t.priority === 'critical' ? h('span.prio.critical', 'Критично') : null,
        t.due ? h('span.due' + (t.due < today && col.id !== s.columns[s.columns.length - 1].id ? '.late' : ''), fmtDay(t.due)) : null,
        t.checks.length ? h('span.mono', `${doneN}/${t.checks.length}`) : null,
        h('span.grow'),
        u ? h('span.avatar.sm', { style: { '--c': u.color }, title: u.name }, initials(u.name)) : null));
    el.addEventListener('dragstart', e => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); setTimeout(() => el.classList.add('dragging')); });
    el.addEventListener('dragend', () => { dragId = null; el.classList.remove('dragging'); });
    return el;
  }
  draw();
  return { refresh: draw };
}

/** Окно задачи: всё редактируется на месте, сохраняется сразу */
function edit(t) {
  const s = crm(), users = getState().users;
  const set = (patch, quiet = true) => updateTask(t, patch, quiet);
  const checks = h('div', { style: { display: 'grid', gap: '6px' } });
  const drawChecks = () => fill(checks, t.checks.map((c, i) => h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
    h('input', { type: 'checkbox', checked: c.done, onchange: e => { c.done = e.target.checked; set({}); } }),
    h('input.input', { value: c.t, style: { height: '30px' }, oninput: e => { c.t = e.target.value; set({}); } }),
    h('button.icon-btn', { 'aria-label': 'Удалить пункт', onclick: () => { t.checks.splice(i, 1); set({}); drawChecks(); }, html: icon('x', 14) }))),
    h('button.btn.sm.ghost', { onclick: () => { t.checks.push({ t: '', done: false }); set({}); drawChecks(); setTimeout(() => checks.querySelectorAll('.input')[t.checks.length - 1]?.focus()); }, html: icon('plus', 14) + 'Пункт' }));
  drawChecks();
  const body = h('div',
    h('div.field', h('label', 'Задача'), h('input.input', { value: t.title, autofocus: true, oninput: e => set({ title: e.target.value }) })),
    h('div.two',
      h('div.field', h('label', 'Колонка'), h('select.select', { onchange: e => set({ col: e.target.value }) }, s.columns.map(c => h('option', { value: c.id, selected: t.col === c.id }, c.name)))),
      h('div.field', h('label', 'Срок'), h('input.input', { type: 'date', value: t.due || '', onchange: e => set({ due: e.target.value }) }))),
    h('div.two',
      h('div.field', h('label', 'Исполнитель'), h('select.select', { onchange: e => set({ assignee: e.target.value }) }, h('option', { value: '' }, '—'), users.map(u => h('option', { value: u.id, selected: t.assignee === u.id }, u.name)))),
      h('div.field', h('label', 'Приоритет'), h('select.select', { onchange: e => set({ priority: e.target.value }) }, PRIORITIES.map(p => h('option', { value: p.id, selected: t.priority === p.id }, p.name))))),
    h('div.field', h('label', 'Выпуск'), h('select.select', { onchange: e => set({ releaseId: e.target.value }) }, h('option', { value: '' }, '—'), s.releases.map(r => h('option', { value: r.id, selected: t.releaseId === r.id }, `${KIND[r.kind]}: ${r.title}`)))),
    h('div.field', h('label', 'Описание'), h('textarea.textarea', { rows: 3, oninput: e => set({ desc: e.target.value }) }, t.desc || '')),
    h('div.field', h('label', 'Чеклист'), checks));
  modal({ title: 'Задача', wide: true, body, onClose: () => commit(), actions: [
    { label: 'Удалить', danger: true, onClick: () => { deleteTask(t); toast('Задача удалена'); } },
    { label: 'Готово', primary: true }] });
}

return { renderBoard, edit };
})();

// ——— calendar.js ———
M['calendar'] = (() => {
// Календарь: контент-план месяца, цели по выпускам и Shorts, перенос выходов перетаскиванием.
const { h, fill, icon, modal } = window.SPO.util;
const { crm, monthReleases, MONTHS, ymd, todayStr, PLATFORMS, stageById, createRelease, updateRelease, releaseById, KIND, fmtDay } = window.SPO.data;
const { pageHead } = window.SPO.shell;
let cur = null;

function renderCalendar(root) {
  const wrap = h('div'); root.append(wrap);
  const now = new Date();
  cur ||= { y: now.getFullYear(), m: now.getMonth() };
  let dragId = null;
  const draw = () => {
    const s = crm(), { y, m } = cur, today = todayStr();
    const first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    const mon = monthReleases(y, m), g = s.settings.goals;
    const longs = mon.filter(r => r.kind === 'long'), shorts = mon.filter(r => r.kind === 'short');
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const weeks = days[35].getMonth() !== m ? 5 : 6;
    const goal = (label, list, target) => {
      const pub = list.filter(r => r.stage === 'published').length;
      return h('div.kpi', h('div.n', String(list.length), h('small', ` / ${target}`)), h('div.l', `${label} в плане · вышло ${pub}${list.length < target ? ` · не хватает ${target - list.length}` : ''}`),
        h('div.meter', h('i' + (list.length >= target ? '.ok' : ''), { style: { width: Math.min(100, list.length / target * 100) + '%' } })));
    };
    const shift = d => { const t = new Date(y, m + d, 1); cur = { y: t.getFullYear(), m: t.getMonth() }; draw(); };
    fill(wrap,
      pageHead('Календарь', 'Контент-план: перетащите выпуск на другой день, нажмите на пустой день — создадите новый.',
        h('div.cal-head', h('button.icon-btn', { 'aria-label': 'Предыдущий месяц', onclick: () => shift(-1), html: icon('back') }),
          h('h2', `${MONTHS[m]} ${y}`),
          h('button.icon-btn', { 'aria-label': 'Следующий месяц', onclick: () => shift(1), html: `<span style="display:inline-flex;transform:rotate(180deg)">${icon('back')}</span>` }),
          h('button.btn.sm', { onclick: () => { cur = { y: now.getFullYear(), m: now.getMonth() }; draw(); } }, 'Сегодня'))),
      h('div.goal-bar', goal('Выпуски', longs, g.long), goal('Shorts', shorts, g.short),
        h('div.kpi', h('div.n', String(s.releases.filter(r => !r.date && r.stage !== 'published').length)), h('div.l', 'выпусков без даты — откройте и назначьте день'))),
      h('div.cal',
        ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => h('div.dow', d)),
        days.slice(0, weeks * 7).map(d => {
          const ds = ymd(d), evs = s.releases.filter(r => r.date === ds);
          const cell = h('div.day' + (d.getMonth() !== m ? '.other' : '') + (ds === today ? '.today' : ''), { onclick: e => { if (e.target === cell || e.target.classList.contains('dn')) quickAdd(ds); } },
            h('span.dn', String(d.getDate())),
            evs.map(r => {
              const st = stageById(r.stage);
              const ev = h('a.cal-ev' + (r.kind === 'short' ? '.short' : ''), { href: `#/releases/${r.id}`, draggable: 'true', title: `${KIND[r.kind]} · ${st.name}`, style: { '--c': st.color } },
                h('span.nm', r.title), h('span.pd', PLATFORMS.filter(p => r.platforms[p.id]?.status !== 'off').map(p => h('i', { style: { '--c': p.color, opacity: r.platforms[p.id].status === 'published' ? 1 : 0.4 } }))));
              ev.addEventListener('dragstart', e => { dragId = r.id; e.dataTransfer.setData('text/plain', r.id); });
              ev.addEventListener('dragend', () => { dragId = null; });
              return ev;
            }));
          cell.addEventListener('dragover', e => { if (dragId) { e.preventDefault(); cell.classList.add('drop'); } });
          cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
          cell.addEventListener('drop', e => { e.preventDefault(); cell.classList.remove('drop'); const r = releaseById(dragId); if (r) updateRelease(r, { date: ds }); });
          return cell;
        })),
    );
  };
  function quickAdd(ds) {
    const title = h('input.input', { placeholder: 'Название', autofocus: true });
    let kind = 'short';
    const seg = h('div.seg.wide', Object.entries(KIND).map(([k, n]) => h('button' + (k === kind ? '.on' : ''), { type: 'button', onclick: e => { kind = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, n)));
    modal({ title: `Выход ${fmtDay(ds)}`, body: h('div', h('div.field', h('label', 'Формат'), seg), h('div.field', h('label', 'Название'), title)),
      actions: [{ label: 'Отмена' }, { label: 'Создать', primary: true, onClick: () => { createRelease({ kind, date: ds, title: title.value.trim() || (kind === 'short' ? 'Новый Shorts' : 'Новый выпуск') }); } }] });
    title.addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('.modal .btn.primary')?.click(); });
  }
  draw();
  return { refresh: draw };
}

return { renderCalendar };
})();

// ——— settings.js ———
M['settings'] = (() => {
// Настройки: цели месяца, команда, ключи YouTube / Telegram / Rutube, резервная копия.
const { h, fill, icon, toast, modal, download, initials } = window.SPO.util;
const { getState, commit, addUser, roleName, ROLES } = window.SPO.store;
const { crm } = window.SPO.data;
const { pageHead } = window.SPO.shell;
const { refreshYouTube, refreshTelegram } = M['analytics'];
function renderSettings(root) {
  const wrap = h('div'); root.append(wrap);
  const draw = () => {
    const s = crm(), st = s.settings;
    const inp = (obj, key, ph, type = 'text') => h('input.input' + (type === 'password' ? '.secret' : ''), { type, value: obj[key] || '', placeholder: ph, autocomplete: 'off', spellcheck: 'false', oninput: e => { obj[key] = e.target.value.trim(); commit('quiet'); } });
    const check = async (fn, btn) => { btn.disabled = true; try { await fn(); toast('Подключено, данные получены'); } catch (e) { toast(e.message, 'error'); } btn.disabled = false; };
    const name = h('input.input', { placeholder: 'Имя и фамилия' });
    const role = h('select.select', ROLES.map(r => h('option', { value: r.id }, r.name)));
    fill(wrap,
      pageHead('Настройки', 'Цели канала, команда и подключения площадок. Ключи хранятся только в этом браузере.'),
      h('div.cols.c2',
        h('section.panel-box', h('h2', 'Цели на месяц'),
          h('div.two',
            h('div.field', h('label', 'Длинных выпусков'), h('input.input', { type: 'number', min: 0, value: st.goals.long, oninput: e => { st.goals.long = Math.max(0, +e.target.value || 0); commit('quiet'); } })),
            h('div.field', h('label', 'Shorts'), h('input.input', { type: 'number', min: 0, value: st.goals.short, oninput: e => { st.goals.short = Math.max(0, +e.target.value || 0); commit('quiet'); } }))),
          h('p.note-line', 'Цели видны в «Обзоре», «Календаре» и «Аналитике».')),
        h('section.panel-box', h('h2', 'Команда'),
          h('div.rows', getState().users.map(u => h('div.row-item', h('span.avatar', { style: { '--c': u.color } }, initials(u.name)), h('div', h('div.t', u.name), h('div.s', roleName(u.role))), h('span')))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 130px', gap: '8px', marginTop: '10px' } }, name, role,
            h('button.btn', { onclick: () => { if (!name.value.trim()) return name.focus(); const me0 = getState().meId; addUser(name.value, role.value); getState().meId = me0; commit(); toast('Участник добавлен'); }, style: { gridColumn: '1 / -1', justifySelf: 'start' } }, 'Добавить участника'))),
        h('section.panel-box', h('h2', 'YouTube'),
          h('div.field', h('label', 'Канал'), inp(st.yt, 'channel', '@spectroptik или UC…')),
          h('div.field', h('label', 'Ключ YouTube Data API v3'), inp(st.yt, 'key', 'AIza…', 'password')),
          h('details', h('summary', { style: { cursor: 'pointer', fontSize: '13px', fontWeight: 500 } }, 'Как получить ключ (3 минуты)'),
            h('ol.note-line', { style: { paddingLeft: '18px' } },
              h('li', 'console.cloud.google.com → создайте проект.'),
              h('li', '«APIs & Services» → «Library» → включите «YouTube Data API v3».'),
              h('li', '«Credentials» → «Create credentials» → «API key».'),
              h('li', 'В ограничениях ключа укажите сайт spectroptik.layero.app и только YouTube Data API v3.'),
              h('li', 'Вставьте ключ сюда. Квоты хватает на сотни обновлений в день.'))),
          h('button.btn', { style: { marginTop: '10px' }, onclick: e => check(refreshYouTube, e.currentTarget), html: icon('refresh', 15) + 'Проверить и загрузить' })),
        h('section.panel-box', h('h2', 'Telegram'),
          h('div.field', h('label', 'Канал'), inp(st.tg, 'chat', '@spectroptik')),
          h('div.field', h('label', 'Токен бота'), inp(st.tg, 'token', '123456:ABC…', 'password')),
          h('p.note-line', 'Создайте бота у @BotFather, добавьте его администратором канала с правом публикации. Тогда CRM покажет число подписчиков и сможет отправлять анонсы выпусков.'),
          h('button.btn', { style: { marginTop: '10px' }, onclick: e => check(refreshTelegram, e.currentTarget), html: icon('send', 15) + 'Проверить' })),
        h('section.panel-box', h('h2', 'Rutube'),
          h('div.field', h('label', 'ID канала'), inp(st.rutube, 'person', 'число из rutube.ru/channel/…')),
          h('p.note-line', 'Rutube открывает статистику не всем сайтам. Если загрузка не сработает — ссылки и даты выпусков на Rutube всё равно ведутся в карточках.')),
        h('section.panel-box', h('h2', 'Данные'),
          h('p.note-line', 'Всё хранится в этом браузере. Сделайте резервную копию, чтобы перенести CRM на другой компьютер.'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
            h('button.btn', { onclick: () => { const d = JSON.parse(JSON.stringify(getState())); delete d.settings?.yt?.key; delete d.settings?.tg?.token; download(`spectroptik-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'spectroptik/backup', data: d }, null, 1), 'application/json'); }, html: icon('download', 15) + 'Скачать копию' }),
            h('label.btn', { html: icon('upload', 15) + 'Восстановить' }, h('input.sr', { type: 'file', accept: '.json', onchange: e => restore(e.target.files[0]) }))),
          h('p.note-line', { style: { marginTop: '8px' } }, 'В копию не попадают ключи и токены.'))),
    );
  };
  function restore(f) {
    if (!f) return;
    f.text().then(t => {
      const j = JSON.parse(t);
      if (j.format !== 'spectroptik/backup') return toast('Это не резервная копия СпектрОптик', 'error');
      modal({ title: 'Восстановить копию?', body: h('p', 'Текущие проекты, выпуски и задачи заменятся данными из файла. Ключи останутся.'), actions: [{ label: 'Отмена' }, { label: 'Заменить', danger: true, onClick: () => {
        const s = getState(), keep = s.settings; Object.keys(s).forEach(k => delete s[k]); Object.assign(s, j.data);
        s.settings ||= {}; s.settings.yt = { ...s.settings.yt, key: keep?.yt?.key || '' }; s.settings.tg = { ...s.settings.tg, token: keep?.tg?.token || '' };
        commit(); toast('Данные восстановлены');
      } }] });
    }).catch(() => toast('Не удалось прочитать файл', 'error'));
  }
  draw();
  return { refresh: draw };
}

return { renderSettings };
})();
window.SPO_PAGES = { home: M.overview.renderOverview, releases: M.releases.renderReleases, board: M.board.renderBoard, calendar: M.calendar.renderCalendar, analytics: M.analytics.renderAnalytics, settings: M.settings.renderSettings };
})();
