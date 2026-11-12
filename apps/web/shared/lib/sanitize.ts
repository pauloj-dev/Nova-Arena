import DOMPurify from 'dompurify';

/**
 * Rich-text do organizador (descrição, regulamento, premiação): só uma lista curta de tags
 * e nenhum atributo além de `href` em links. Tudo o mais é removido (PRD — lacuna de XSS).
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'];
const ALLOWED_ATTR = ['href'];

export function sanitizeRichText(html: string): string {
  if (typeof window === 'undefined') return '';
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i });
  // Links de conteúdo de terceiros sempre abrem em nova aba, sem dar acesso à página de origem.
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  return doc.body.innerHTML;
}

/** Texto puro a partir do HTML (resumos em cards e metadados). */
export function richTextToPlain(html: string): string {
  if (typeof window === 'undefined') return '';
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html, { ALLOWED_TAGS: [] }), 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export type StreamEmbed = { provider: 'youtube' | 'twitch'; embedUrl: string };

/** Único vídeo permitido: embed da Twitch ou do YouTube (PRD §5.2). Qualquer outro link devolve nulo. */
export function streamEmbed(url: string, parentHost: string): StreamEmbed | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    return /^[\w-]{6,20}$/.test(id) ? { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === 'youtube.com') {
    const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/live/') ? u.pathname.split('/')[2] : null);
    return id && /^[\w-]{6,20}$/.test(id) ? { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === 'twitch.tv') {
    const channel = u.pathname.split('/').filter(Boolean)[0];
    return channel && /^\w{3,30}$/.test(channel)
      ? { provider: 'twitch', embedUrl: `https://player.twitch.tv/?channel=${channel}&parent=${encodeURIComponent(parentHost)}&autoplay=false` }
      : null;
  }
  return null;
}
