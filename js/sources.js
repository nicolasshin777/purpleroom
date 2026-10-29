// Источники видео: Яндекс Диск, Google Диск, прямая ссылка, файл с компьютера.
// Видео не копируется — плеер получает поток прямо из источника.

const YA_API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
const localFiles = new Map(); // versionId -> objectURL (живут до перезагрузки вкладки)

export function detectSource(url) {
  const u = (url || '').trim();
  if (!u) return null;
  if (/^(https?:\/\/)?(disk\.yandex\.[a-z]+|yadi\.sk|disk\.360\.yandex\.[a-z]+)\//i.test(u)) return { type: 'yandex', name: 'Яндекс Диск' };
  const gd = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{10,})/i) || u.match(/docs\.google\.com\/.*[?&]id=([\w-]{10,})/i);
  if (gd) return { type: 'gdrive', name: 'Google Диск', id: gd[1] };
  if (/^https?:\/\/.+\.m3u8(\?.*)?$/i.test(u)) return { type: 'hls', name: 'HLS-поток' };
  if (/^https?:\/\//i.test(u)) return { type: 'url', name: 'Прямая ссылка' };
  return { type: 'invalid', name: 'Не похоже на ссылку' };
}

async function yaJson(params) {
  let r;
  try { r = await fetch(`${YA_API}${params.path || ''}?${new URLSearchParams(params.q)}`, { referrerPolicy: 'no-referrer' }); }
  catch { throw new Error('Не удалось связаться с Яндекс Диском. Проверьте интернет и что ссылка открывается без входа в аккаунт.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 404) throw new Error('Файл не найден. Проверьте, что ссылка публичная: в Яндекс Диске нажмите «Поделиться» → «Скопировать ссылку».');
    throw new Error(j.description || `Яндекс Диск ответил ошибкой ${r.status}`);
  }
  return j;
}

/**
 * Разбор ссылки перед созданием версии.
 * Возвращает { kind:'file', meta } или { kind:'folder', items:[{name,path,size}] }.
 */
export async function resolveLink(url, path) {
  const src = detectSource(url);
  if (!src || src.type === 'invalid') throw new Error('Вставьте ссылку на видео с Яндекс Диска, Google Диска или прямую ссылку на mp4.');
  if (src.type === 'yandex') {
    const q = { public_key: url.trim(), limit: 200 };
    if (path) q.path = path;
    const info = await yaJson({ q });
    if (info.type === 'dir') {
      const items = await listVideos(url.trim(), info, 2);
      if (!items.length) throw new Error('В этой папке (и вложенных) нет видеофайлов. Проверьте, что ролик загружен в папку, на которую дана ссылка.');
      return { kind: 'folder', items, source: src };
    }
    if (info.media_type && info.media_type !== 'video') throw new Error(`Это не видео (${info.mime_type || info.media_type}).`);
    return { kind: 'file', source: src, meta: { name: info.name, size: info.size, mime: info.mime_type, path: path || '' } };
  }
  if (src.type === 'gdrive') return { kind: 'file', source: src, meta: { name: 'Файл Google Диска', driveId: src.id } };
  return { kind: 'file', source: src, meta: { name: decodeURIComponent(url.split('/').pop().split('?')[0] || 'video') } };
}

const isVideo = i => i.type === 'file' && (i.media_type === 'video' || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(i.name));
/** Видео в папке и во вложенных папках (до depth уровней) */
async function listVideos(key, info, depth) {
  const all = info._embedded?.items || [];
  const out = all.filter(isVideo).map(i => ({ name: i.name, path: i.path, size: i.size, mime: i.mime_type }));
  if (depth > 0) {
    for (const d of all.filter(i => i.type === 'dir').slice(0, 20)) {
      try {
        const sub = await yaJson({ q: { public_key: key, path: d.path, limit: 200 } });
        for (const it of await listVideos(key, sub, depth - 1)) out.push({ ...it, name: `${d.name} / ${it.name}` });
      } catch { /* недоступная подпапка — пропускаем */ }
    }
  }
  return out;
}

/** Ссылка, которую можно отдать в <video>. Ссылки Яндекса временные — запрашиваем каждый раз. */
export async function playableUrl(version) {
  switch (version.sourceType) {
    case 'file': {
      const u = localFiles.get(version.id);
      if (!u) throw Object.assign(new Error('Файл с компьютера доступен только в той вкладке, где его выбрали. Выберите его снова.'), { code: 'reselect' });
      return u;
    }
    case 'yandex': {
      if (!version.sourcePath) {
        // Ссылка на папку: если видео одно — берём его, иначе просим выбрать
        const r = await resolveLink(version.sourceUrl);
        if (r.kind === 'folder') {
          if (r.items.length > 1) throw Object.assign(new Error('В папке несколько видео — выберите, какое ревьюим.'), { code: 'pick', items: r.items });
          version.sourcePath = r.items[0].path; version.fileName = r.items[0].name.split(' / ').pop(); version.picked = true;
        } else version.fileName = version.fileName || r.meta.name;
      }
      const q = { public_key: version.sourceUrl };
      if (version.sourcePath) q.path = version.sourcePath;
      // тип файла — чтобы честно сказать, если формат браузеру не по зубам
      try { const m = await yaJson({ q }); version.mime = m.mime_type || ''; version.size = m.size; version.fileName = version.fileName || m.name; } catch { }
      const j = await yaJson({ path: '/download', q });
      if (!j.href) throw new Error('Яндекс Диск не выдал ссылку на файл. Попробуйте ещё раз через минуту.');
      // просим отдать файл для просмотра, а не как скачивание
      // если подпись ссылки не терпит правок — отдаём её как есть (rawLink ставит плеер после ошибки)
      return version.rawLink ? j.href : j.href.replace(/([?&])disposition=attachment/, '$1disposition=inline');
    }
    case 'gdrive': {
      const id = version.driveId || detectSource(version.sourceUrl)?.id;
      return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
    }
    default: return version.sourceUrl;
  }
}

export function registerLocalFile(versionId, file) {
  const url = URL.createObjectURL(file);
  localFiles.set(versionId, url);
  return url;
}
export const hasLocalFile = id => localFiles.has(id);

/** Понятная причина, почему видео не играет */
export function explainMediaError(version, err) {
  const code = err?.code;
  if (version.sourceType === 'gdrive') return 'Google Диск не отдал видео. Откройте доступ «Все, у кого есть ссылка». Для файлов больше ~100 МБ Google иногда ограничивает поток — тогда используйте Яндекс Диск или прямую ссылку.';
  const name = version.fileName || '';
  if ((code === 4 || /quicktime|matroska|x-msvideo/i.test(version.mime || '')) && (/\.(mov|mkv|avi|mxf)$/i.test(name) || /quicktime|matroska|x-msvideo/i.test(version.mime || ''))) return `Браузер не умеет воспроизводить «${name}». Скорее всего, это ProRes или HEVC. Выгрузите из монтажки рендер H.264 в .mp4 и положите его в папку.`;
  if (version.sourceType === 'yandex') {
    const big = version.size > 1.5 * 1073741824;
    return `Яндекс Диск отдал ссылку, но браузер не смог открыть${name ? ` «${name}»` : ' файл'} по сети (код ${code ?? '—'}).`
      + (big ? ` Файл весит ${(version.size / 1073741824).toFixed(1)} ГБ — это мастер, для просмотра по сети он слишком тяжёлый.` : '')
      + ' Положите в папку лёгкую копию для правок: H.264, 1080p, 8–10 Мбит/с, с галочкой «Fast Start» (Premiere) или «Network Optimization» (Resolve) — она откроется сразу. Пока можно открыть файл с компьютера.';
  }
  if (code === 4) return 'Браузер не умеет воспроизводить этот формат. Нужен рендер H.264 (mp4) или WebM — ProRes и HEVC в браузере не играют.';
  return 'Видео не загрузилось. Проверьте ссылку и доступ к файлу.';
}

/** HLS через hls.js (подгружается только когда нужен) */
export async function attachHls(video, url) {
  if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = url; return; }
  if (!window.Hls) await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js'; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить проигрыватель HLS'));
    document.head.append(s);
  });
  const hls = new window.Hls(); hls.loadSource(url); hls.attachMedia(video);
}
