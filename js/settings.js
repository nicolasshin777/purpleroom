// Настройки: цели месяца, команда, ключи YouTube / Telegram / Rutube, резервная копия.
import { h, fill, icon, toast, modal, download, initials } from './util.js';
import { getState, commit, addUser, roleName, ROLES } from './store.js';
import { crm } from './data.js';
import { pageHead } from './shell.js';
import { refreshYouTube, refreshTelegram } from './analytics.js';

export function renderSettings(root) {
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
