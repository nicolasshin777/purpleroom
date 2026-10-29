// Задачи: канбан-доска команды. Карточки перетаскиваются между колонками.
import { h, fill, icon, modal, toast, initials, uid } from './util.js';
import { getState, me, commit, PRIORITIES } from './store.js';
import { crm, createTask, updateTask, deleteTask, releaseById, fmtDay, todayStr, KIND } from './data.js';
import { pageHead } from './shell.js';

let who = 'all', relFilter = '';

export function renderBoard(root) {
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
export function edit(t) {
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
