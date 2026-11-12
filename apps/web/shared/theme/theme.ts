export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'nova-theme';

/**
 * Roda antes da primeira pintura (script inline no <head>) para não piscar o tema errado.
 * Preferência salva > preferência do sistema.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}})()`;

export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Sem armazenamento (modo privado): o tema vale só para esta página.
  }
  window.dispatchEvent(new CustomEvent('nova-theme', { detail: theme }));
}
