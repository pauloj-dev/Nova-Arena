import { sanitizeHtmlAllowlist } from '@nova/schemas';
import DOMPurify from 'dompurify';

/**
 * Rich-text do organizador (descrição, regulamento, premiação): só uma lista curta de tags
 * e nenhum atributo além de `href` em links. Tudo o mais é removido (PRD — lacuna de XSS).
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'];
const ALLOWED_ATTR = ['href'];

export function sanitizeRichText(html: string): string {
  // No servidor não há DOM para o DOMPurify: vale a mesma lista de tags do sanitizador da API (TypeScript puro), e o
  // texto já vem no HTML da página (#111: ele costuma ser o LCP de Termos, Privacidade e da página do campeonato).
  if (typeof window === 'undefined') return sanitizeHtmlAllowlist(html);
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i });
  // Links de conteúdo de terceiros sempre abrem em nova aba, sem dar acesso à página de origem.
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer nofollow');
  });
  return doc.body.innerHTML;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/**
 * Texto puro a partir do HTML (resumos em cards, metadados e "tem descrição?"). No servidor também: a página do
 * campeonato decide entre o texto e "Sem descrição" com ele, e uma resposta diferente no servidor quebrava a hidratação.
 */
export function richTextToPlain(html: string): string {
  if (typeof window === 'undefined') {
    const text = sanitizeHtmlAllowlist(html)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
        const lower = code.toLowerCase();
        if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
        if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
        return ENTITIES[lower] ?? m;
      });
    return text.replace(/\s+/g, ' ').trim();
  }
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
