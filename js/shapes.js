// Отрисовка фигур правок. Координаты хранятся нормализованными (0–1) к кадру.
import { esc } from './util.js';

export function shapeSvg(s, W, H, { seq, dim = false, draft = false, sel = false, scale = 1 } = {}) {
  const c = s.color || '#E5484D';
  const sw = 2.5 * scale;
  const op = dim ? 0.3 : 1;
  const dash = draft ? `stroke-dasharray="${6 * scale} ${4 * scale}"` : '';
  const id = `data-shape="${s.id}"`;
  const tag = (x, y) => seq != null && scale >= 1 ? `<g transform="translate(${x} ${y - 22})"><rect width="${String(seq).length * 8 + 16}" height="18" rx="4" fill="${c}"/><text x="7" y="13" font-family="Martian Mono, monospace" font-size="10.5" font-weight="600" fill="#fff">#${seq}</text></g>` : '';
  const halo = sel ? `filter="drop-shadow(0 0 ${3 * scale}px rgba(255,255,255,.9))"` : '';
  switch (s.type) {
    case 'pin': {
      const x = s.x * W, y = s.y * H, r = 13 * scale;
      return `<g ${id} opacity="${op}" ${halo}><circle cx="${x}" cy="${y}" r="${r + 3 * scale}" fill="rgba(0,0,0,.25)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#fff" stroke-width="${2 * scale}"/>${seq != null ? `<text x="${x}" y="${y + 3.6 * scale}" text-anchor="middle" font-family="Martian Mono, monospace" font-size="${10 * scale}" font-weight="600" fill="#fff">${seq}</text>` : ''}</g>`;
    }
    case 'rect':
    case 'blur': {
      const x = s.x * W, y = s.y * H, w = s.w * W, hh = s.h * H;
      const fill = s.type === 'blur' ? `url(#hatch)` : `${c}1A`;
      const d = s.type === 'blur' ? `stroke-dasharray="${5 * scale} ${4 * scale}"` : dash;
      return `<g ${id} opacity="${op}" ${halo}><rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${4 * scale}" fill="${fill}" stroke="${c}" stroke-width="${sw}" ${d}/>${tag(x, y)}</g>`;
    }
    case 'ellipse': {
      const x = s.x * W, y = s.y * H, w = s.w * W, hh = s.h * H;
      return `<g ${id} opacity="${op}" ${halo}><ellipse cx="${x + w / 2}" cy="${y + hh / 2}" rx="${w / 2}" ry="${hh / 2}" fill="${c}1A" stroke="${c}" stroke-width="${sw}" ${dash}/>${tag(x + w * 0.15, y + hh * 0.15)}</g>`;
    }
    case 'arrow': {
      const x1 = s.x1 * W, y1 = s.y1 * H, x2 = s.x2 * W, y2 = s.y2 * H;
      const a = Math.atan2(y2 - y1, x2 - x1), L = 16 * scale, sp = 0.45;
      const p1 = [x2 - L * Math.cos(a - sp), y2 - L * Math.sin(a - sp)], p2 = [x2 - L * Math.cos(a + sp), y2 - L * Math.sin(a + sp)];
      return `<g ${id} opacity="${op}" ${halo}><line x1="${x1}" y1="${y1}" x2="${x2 - 6 * scale * Math.cos(a)}" y2="${y2 - 6 * scale * Math.sin(a)}" stroke="${c}" stroke-width="${sw + 0.5}" stroke-linecap="round" ${dash}/><path d="M${x2} ${y2}L${p1}L${p2}Z" fill="${c}" stroke="${c}" stroke-width="${scale}" stroke-linejoin="round"/>${tag(x1 - 4, y1)}</g>`;
    }
    case 'brush': {
      if (!s.pts?.length) return '';
      const d = smoothPath(s.pts.map(([x, y]) => [x * W, y * H]));
      return `<g ${id} opacity="${op}" ${halo}><path d="${d}" fill="none" stroke="${c}" stroke-width="${sw + 0.5}" stroke-linecap="round" stroke-linejoin="round" ${dash}/>${tag(s.pts[0][0] * W, s.pts[0][1] * H)}</g>`;
    }
    case 'text': {
      const x = s.x * W, y = s.y * H, fs = 15 * scale, tw = Math.max(20, [...(s.text || '')].length * fs * 0.56) + 14 * scale;
      return `<g ${id} opacity="${op}" ${halo}><rect x="${x}" y="${y - fs - 6 * scale}" width="${tw}" height="${fs + 12 * scale}" rx="${5 * scale}" fill="${c}"/><text x="${x + 7 * scale}" y="${y - 1 * scale}" font-family="Golos Text, sans-serif" font-size="${fs}" font-weight="600" fill="#fff">${esc(s.text)}</text></g>`;
    }
  }
  return '';
}

function smoothPath(pts) {
  if (pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join(' L');
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${l[0]} ${l[1]}`;
}

export const HATCH_DEF = `<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="rgba(255,255,255,.12)"/><line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255,255,255,.55)" stroke-width="3"/></pattern></defs>`;

// Кадр правки: встроенный (data:) или путь в хранилище (snapRef) — ссылку даёт общая база
let frameResolver = null;
export function setFrameResolver(fn) { frameResolver = fn; }
export const frameSrc = note => note.snap || (note.snapRef && frameResolver?.(note.snapRef)) || '';
export const hasFrame = note => !!(note.snap || note.snapRef);

/** Миниатюра правки: снимок кадра (если есть) + фигуры */
export function noteThumbSvg(note, aspect = 16 / 9, w = 160) {
  const W = w, H = Math.round(w / aspect);
  const src = frameSrc(note);
  const bg = src ? `<image href="${src}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="#1c1c1c"/><path d="M0 ${H * .72}L${W * .3} ${H * .5}L${W * .55} ${H * .66}L${W} ${H * .42}" stroke="#333" fill="none"/>`;
  const shapes = (note.shapes || []).map(s => shapeSvg(s, W, H, { scale: W / 520 })).join('');
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Кадр правки #${note.seq}">${HATCH_DEF}${bg}${shapes}</svg>`;
}

/** Попадает ли точка (нормализованная) в фигуру — для выбора и перетаскивания */
export function hitShape(s, x, y, aspect) {
  const tol = 0.02;
  switch (s.type) {
    case 'pin': return Math.hypot(x - s.x, (y - s.y) / aspect) < 0.03;
    case 'rect': case 'blur': case 'ellipse': return x > s.x - tol && x < s.x + s.w + tol && y > s.y - tol && y < s.y + s.h + tol;
    case 'text': return x > s.x - tol && x < s.x + 0.25 && y > s.y - 0.07 && y < s.y + tol;
    case 'arrow': return distSeg(x, y, s.x1, s.y1, s.x2, s.y2) < 0.025;
    case 'brush': return s.pts.some(([px, py]) => Math.hypot(px - x, py - y) < 0.03);
  }
  return false;
}
function distSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function moveShape(s, dx, dy) {
  switch (s.type) {
    case 'arrow': s.x1 += dx; s.x2 += dx; s.y1 += dy; s.y2 += dy; break;
    case 'brush': s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]); break;
    default: s.x += dx; s.y += dy;
  }
}
