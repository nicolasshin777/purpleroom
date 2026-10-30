// Упаковка модулей в один классический скрипт без переформатирования кода.
// Общие модули основного сайта берутся из window.SPO, свои — из локального реестра M.
import fs from 'node:fs';

const SHARED = new Set(['util', 'store', 'sources', 'shapes', 'versions', 'data', 'shell']);

function pack(order, outFile, tail) {
  const parts = [];
  for (const name of order) {
    let src = fs.readFileSync(`js/${name}.js`, 'utf8');
    const exportsList = [];
    src = src.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*'\.\/([\w-]+)\.js';\s*$/gm, (_, names, mod) => {
      const list = names.replace(/\s+/g, ' ').trim().replace(/,\s*$/, '');
      return SHARED.has(mod) ? `const { ${list} } = window.SPO.${mod};` : `const { ${list} } = M['${mod}'];`;
    });
    src = src.replace(/import\('\.\/([\w-]+)\.js'\)/g, (_, mod) => SHARED.has(mod) ? `Promise.resolve(window.SPO.${mod})` : `Promise.resolve(M['${mod}'])`);
    src = src.replace(/^export (async function|function|const|let) (\w+)/gm, (_, kw, n) => { exportsList.push(n); return `${kw} ${n}`; });
    if (/^\s*import /m.test(src) || /^export /m.test(src)) throw new Error(`Не разобран импорт/экспорт в ${name}.js`);
    parts.push(`// ——— ${name}.js ———\nM['${name}'] = (() => {\n${src}\nreturn { ${exportsList.join(', ')} };\n})();`);
  }
  fs.mkdirSync(outFile.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(outFile, `(() => {\n'use strict';\nconst M = {};\n${parts.join('\n\n')}\n${tail}\n})();\n`);
  console.log(outFile, fs.statSync(outFile).size);
}

pack(['export', 'timeline', 'panel', 'review'], 'dist/review/review.bundle.js', 'window.SPO_REVIEW = { mountReview: M.review.mountReview };');
pack(['analytics', 'overview', 'releases', 'board', 'calendar', 'settings'], 'dist/ui/pages.bundle.js',
  'window.SPO_PAGES = { home: M.overview.renderOverview, releases: M.releases.renderReleases, board: M.board.renderBoard, calendar: M.calendar.renderCalendar, analytics: M.analytics.renderAnalytics, settings: M.settings.renderSettings };');
fs.copyFileSync('assets/app.css', 'dist/ui/app.css');
