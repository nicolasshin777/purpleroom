// Настройки: цели месяца, команда, ключи YouTube / Telegram / Rutube, резервная копия.
import { h, fill, icon, toast, modal, download, initials } from './util.js';
import { getState, commit, addUser, roleName, ROLES } from './store.js';
import { crm } from './data.js';
import { pageHead } from './shell.js';
import { refreshYouTube, refreshTelegram } from './analytics.js';
import * as cloud from './cloud.js';

export function renderSettings(root) {
  const wrap = h('div'); root.append(wrap);
  const draw = () => {
    const s = crm(), st = s.settings;
    const inp = (obj, key, ph, type = 'text') => h('input.input' + (type === 'password' ? '.secret' : ''), { type, value: obj[key] || '', placeholder: ph, autocomplete: 'off', spellcheck: 'false', oninput: e => { obj[key] = e.target.value.trim(); commit('quiet'); } });
    const check = async (fn, btn) => { btn.disabled = true; try { await fn(); toast('Подключено, данные получены'); } catch (e) { toast(e.message, 'error'); } btn.disabled = false; };
    const name = h('input.input', { placeholder: 'Имя и фамилия' });
    const role = h('select.select', ROLES.map(r => h('option', { value: r.id }, r.name)));
    fill(wrap,
      pageHead('Настройки', cloud.cloudOn ? 'Цели канала, команда и подключения площадок. Данные — в общей базе, ключи площадок видит только продюсер.' : 'Цели канала, команда и подключения площадок. Ключи хранятся только в этом браузере.'),
      h('div.cols.c2',
        h('section.panel-box', h('h2', 'Цели на месяц'),
          h('div.two',
            h('div.field', h('label', 'Длинных выпусков'), h('input.input', { type: 'number', min: 0, value: st.goals.long, oninput: e => { st.goals.long = Math.max(0, +e.target.value || 0); commit('quiet'); } })),
            h('div.field', h('label', 'Shorts'), h('input.input', { type: 'number', min: 0, value: st.goals.short, oninput: e => { st.goals.short = Math.max(0, +e.target.value || 0); commit('quiet'); } }))),
          h('p.note-line', 'Цели видны в «Обзоре», «Календаре» и «Аналитике».')),
        cloud.cloudOn ? cloudTeam() : h('section.panel-box', h('h2', 'Команда'),
          h('div.rows', getState().users.map(u => h('div.row-item', h('span.avatar', { style: { '--c': u.color } }, initials(u.name)), h('div', h('div.t', u.name), h('div.s', roleName(u.role))), h('span')))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 130px', gap: '8px', marginTop: '10px' } }, name, role,
            h('button.btn', { onclick: () => { if (!name.value.trim()) return name.focus(); const me0 = getState().meId; addUser(name.value, role.value); getState().meId = me0; commit(); toast('Участник добавлен'); }, style: { gridColumn: '1 / -1', justifySelf: 'start' } }, 'Добавить участника'))),
        cloud.cloudOn && !isProducer() ? h('section.panel-box', h('h2', 'Площадки'), h('p.note-line', 'Ключи YouTube и Telegram настраивает продюсер. Аналитика, которую он загрузил, видна в разделе «Аналитика».')) : null,
        cloud.cloudOn && !isProducer() ? null : h('section.panel-box', h('h2', 'YouTube'),
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
        cloud.cloudOn && !isProducer() ? null : h('section.panel-box', h('h2', 'Telegram'),
          h('div.field', h('label', 'Канал'), inp(st.tg, 'chat', '@spectroptik')),
          h('div.field', h('label', 'Токен бота'), inp(st.tg, 'token', '123456:ABC…', 'password')),
          h('p.note-line', 'Создайте бота у @BotFather, добавьте его администратором канала с правом публикации. Тогда CRM покажет число подписчиков и сможет отправлять анонсы выпусков.'),
          h('button.btn', { style: { marginTop: '10px' }, onclick: e => check(refreshTelegram, e.currentTarget), html: icon('send', 15) + 'Проверить' })),
        h('section.panel-box', h('h2', 'Rutube'),
          h('div.field', h('label', 'ID канала'), inp(st.rutube, 'person', 'число из rutube.ru/channel/…')),
          h('p.note-line', 'Rutube открывает статистику не всем сайтам. Если загрузка не сработает — ссылки и даты выпусков на Rutube всё равно ведутся в карточках.')),
        h('section.panel-box', h('h2', 'Данные'),
          h('p.note-line', cloud.cloudOn ? 'Всё хранится в общей базе, браузер держит копию для быстрой работы. Резервная копия в файл не помешает.' : 'Всё хранится в этом браузере. Сделайте резервную копию, чтобы перенести CRM на другой компьютер.'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
            h('button.btn', { onclick: () => { const d = JSON.parse(JSON.stringify(getState())); delete d.settings?.yt?.key; delete d.settings?.tg?.token; download(`spectroptik-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'spectroptik/backup', data: d }, null, 1), 'application/json'); }, html: icon('download', 15) + 'Скачать копию' }),
            h('label.btn', { html: icon('upload', 15) + 'Восстановить' }, h('input.sr', { type: 'file', accept: '.json', onchange: e => restore(e.target.files[0]) })),
            cloud.cloudOn && cloud.hasBackup() ? h('button.btn', { onclick: () => download('spectroptik-do-obshchey-bazy.json', JSON.stringify({ format: 'spectroptik/backup', data: JSON.parse(cloud.backupJson()) }, null, 1), 'application/json'), html: icon('download', 15) + 'Копия до общей базы' }) : null),
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
  if (cloud.cloudOn) cloud.refreshTeam();
  return { refresh: draw };
}

const isProducer = () => cloud.account()?.role === 'producer';

/** Команда в общей базе: люди регистрируются сами, роль выдаёт продюсер */
function cloudTeam() {
  const mine = cloud.account(), prod = mine?.role === 'producer';
  const roles = [...ROLES, { id: 'pending', name: 'Ждёт доступа' }];
  const row = m => h('div.row-item',
    h('span.avatar', { style: { '--c': m.color } }, initials(m.name || m.email || '?')),
    h('div', h('div.t', (m.name || m.email) + (m.user_id === mine?.user_id ? ' · вы' : '')), h('div.s', m.email || '')),
    prod && m.user_id !== mine?.user_id
      ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        h('select.select', { style: { width: '150px', height: '32px' }, 'aria-label': 'Роль', onchange: async e => { try { await cloud.setMemberRole(m.user_id, e.target.value); toast('Роль обновлена'); } catch (err) { toast(err.message, 'error'); } } },
          roles.map(r => h('option', { value: r.id, selected: m.role === r.id }, r.name))),
        h('button.icon-btn', { title: 'Убрать из команды', 'aria-label': 'Убрать из команды', html: icon('trash', 15), onclick: () => modal({ title: 'Убрать из команды?', body: h('p', `${m.name || m.email} потеряет доступ к CRM. Его правки останутся.`), actions: [{ label: 'Отмена' }, { label: 'Убрать', danger: true, onClick: async () => { try { await cloud.removeMember(m.user_id); } catch (err) { toast(err.message, 'error'); } } }] }) }))
      : h('span.s', roleName(m.role) === 'pending' ? 'Ждёт доступа' : roles.find(r => r.id === m.role)?.name || m.role));
  const team = cloud.team(), waiting = team.filter(m => m.role === 'pending');
  return h('section.panel-box', h('h2', 'Команда', waiting.length && prod ? h('span.side-badge', String(waiting.length)) : null),
    h('div.rows', team.map(row)),
    h('p.note-line', { style: { marginTop: '10px' } }, prod
      ? `Чтобы добавить человека, отправьте ему ссылку на CRM: ${location.origin}. Он зарегистрируется, а вы выдадите роль здесь. Монтажёр отмечает «Исправлено», заказчик принимает правки.`
      : 'Состав команды и роли меняет продюсер.'));
}
