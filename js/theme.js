// Тема оформления: светлая, тёмная или как в системе. Выбор хранится на этом устройстве.
const KEY = 'spectroptik.theme';
const media = matchMedia('(prefers-color-scheme: dark)');

export function themeChoice() { try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; } }
export const currentTheme = () => document.documentElement.dataset.theme || 'light';

export function applyTheme(choice = themeChoice()) {
  const t = choice === 'auto' ? (media.matches ? 'dark' : 'light') : choice;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#111110' : '#E9E9E5');
  return t;
}
export function setTheme(choice) {
  try { choice === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, choice); } catch { }
  applyTheme(choice);
  window.dispatchEvent(new CustomEvent('themechange'));
}
/** Быстрый переключатель: светлая ↔ тёмная */
export const toggleTheme = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark');

media.addEventListener?.('change', () => { if (themeChoice() === 'auto') { applyTheme('auto'); window.dispatchEvent(new CustomEvent('themechange')); } });
