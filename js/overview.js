// Обзор: цели месяца, ближайшие выходы, горящие задачи, правки на проверке, цифры канала.
import { h, fill, icon, relTime } from './util.js';
import { me, RESOLVED } from './store.js';
import { crm, monthReleases, MONTHS, fmtDay, todayStr, PLATFORMS, stageById, KIND, fmtNum, createRelease, ymd } from './data.js';
import { pageHead, isDone } from './shell.js';

export function renderOverview(root) {
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

export function relRow(r) {
  const st = stageById(r.stage);
  return h('a.row-item', { href: `#/releases/${r.id}` },
    r.date ? h('span.datebox', h('b', r.date.slice(8)), h('span', fmtDay(r.date).split(' ')[1].slice(0, 3))) : h('span.datebox', h('b', '—'), h('span', 'дата')),
    h('div', h('div.t', r.title), h('div.s', h('span.kind' + (r.kind === 'short' ? '.short' : ''), KIND[r.kind]), ' ', h('span.stage-pill', { style: { '--c': st.color } }, h('i'), st.name))),
    h('span.plats', PLATFORMS.map(p => h('span.plat.st-' + (r.platforms[p.id]?.status || 'off'), { style: { '--c': p.color }, title: p.name }, h('i'), p.name[0]))));
}
