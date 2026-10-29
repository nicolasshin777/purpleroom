// Аналитика: YouTube Data API v3 (по ключу), Telegram Bot API, Rutube. Данные кешируются в браузере.
import { h, fill, icon, toast, relTime, esc } from './util.js';
import { commit } from './store.js';
import { crm, fmtNum, todayStr, ytId, KIND } from './data.js';
import { pageHead } from './shell.js';

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

export async function refreshYouTube() {
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
export async function tgSend(text) {
  const m = await tg('sendMessage', { chat_id: tgChat(), text });
  const c = tgChat();
  return { url: c.startsWith('@') ? `https://t.me/${c.slice(1)}/${m.message_id}` : '' };
}
export async function refreshTelegram() {
  const n = await tg('getChatMemberCount', { chat_id: tgChat() });
  const s = crm(); s.analytics.tg = { members: n, at: Date.now() };
  const d = todayStr(), hRow = s.history.find(x => x.d === d); if (hRow) hRow.tg = n; else s.history.push({ d, tg: n });
  commit();
}

// ——— Rutube ———
export async function refreshRutube() {
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
export function renderAnalytics(root) {
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
