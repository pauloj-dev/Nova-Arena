/**
 * Destino depois do login (`?next=`). Só aceita caminho interno do próprio site:
 * qualquer coisa que possa levar a outro domínio (URL absoluta, `//host`, `/\host`) cai no padrão.
 */
const BASE = 'http://nova.invalid';

export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  // Uma única barra no começo; barra invertida e caracteres de controle são tratados como "/" por alguns navegadores.
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Acrescenta `?next=` a um caminho de autenticação, quando há um destino diferente do padrão. */
export function withNext(path: string, next: string | null | undefined): string {
  const target = safeNext(next);
  if (target === '/') return path;
  return `${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent(target)}`;
}
