// Календарь: контент-план месяца, цели по выпускам и Shorts, перенос выходов перетаскиванием.
import { h, fill, icon, modal } from './util.js';
import { crm, monthReleases, MONTHS, ymd, todayStr, PLATFORMS, stageById, createRelease, updateRelease, releaseById, KIND, fmtDay } from './data.js';
import { pageHead } from './shell.js';

let cur = null;

export function renderCalendar(root) {
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
