/**
 * Sanitização do rich-text do organizador sem DOM (descrição, regulamento e premiação).
 * É a segunda barreira: o navegador já limpa com `sanitizeRichText` (DOMPurify); a API limpa de novo
 * antes de gravar, porque nunca confia no que chega do cliente. Função pura, roda em qualquer runtime.
 *
 * Regra: só as tags da lista sobrevivem, sem nenhum atributo — a única exceção é `href` em links
 * http(s) e mailto. O conteúdo de tags perigosas é descartado; o de tags desconhecidas vira texto.
 */
export const ALLOWED_RICH_TEXT_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr'] as const;

const ALLOWED = new Set<string>(ALLOWED_RICH_TEXT_TAGS);
const VOID_TAGS = new Set(['br', 'hr']);
/** Tags cujo conteúdo inteiro é jogado fora. */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'title', 'head', 'select', 'xmp', 'noembed', 'noframes', 'plaintext']);

const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/;
const HREF = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const SAFE_URL = /^(?:https?:\/\/|mailto:)/i;
const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer nofollow"';

function escapeText(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Decodifica entidades para conferir o protocolo de verdade (`java&#115;cript:` não passa). */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|colon|tab|newline);/gi, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", colon: ':', tab: '\t', newline: '\n' })[name.toLowerCase()] ?? '');
}
function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/** `href` seguro (http, https ou mailto) ou nulo. */
export function safeHref(raw: string): string | null {
  // Navegadores ignoram espaços e caracteres de controle dentro do protocolo.
  const url = decodeEntities(raw)
    .replace(/[\u0000- \u007f-\u009f​-‍﻿]/g, '')
    .trim();
  return SAFE_URL.test(url) ? url : null;
}

export function sanitizeHtmlAllowlist(html: string): string {
  let out = '';
  const open: string[] = [];
  let i = 0;
  const input = String(html ?? '');

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(input.slice(i));
      break;
    }
    out += escapeText(input.slice(i, lt));

    // Comentários, doctype e instruções de processamento somem.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const match = TAG.exec(input.slice(lt));
    if (!match) {
      // "<" solto (ou tag que nunca fecha): vira texto.
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    const [raw, closing, rawName = '', attrs = ''] = match;
    const name = rawName.toLowerCase();
    i = lt + raw.length;

    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing) {
        const end = input.toLowerCase().indexOf(`</${name}`, i);
        if (end === -1) {
          i = input.length;
        } else {
          const close = input.indexOf('>', end);
          i = close === -1 ? input.length : close + 1;
        }
      }
      continue;
    }
    if (!ALLOWED.has(name)) continue;

    if (closing) {
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      // Fecha o que ficou aberto por dentro, para o HTML sair bem formado.
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    if (VOID_TAGS.has(name)) {
      out += `<${name}>`;
      continue;
    }
    if (name === 'a') {
      const m = HREF.exec(attrs);
      const href = m ? safeHref(m[1] ?? m[2] ?? m[3] ?? '') : null;
      // Link sem destino seguro perde a tag; o texto de dentro fica.
      if (!href || open.includes('a')) continue;
      out += `<a href="${escapeAttr(href)}" ${LINK_ATTRS}>`;
      open.push('a');
      continue;
    }
    out += `<${name}>`;
    open.push(name);
  }

  while (open.length > 0) out += `</${open.pop()}>`;
  return out;
}

/** Campos de rich-text do campeonato, limpos antes de gravar. Campos ausentes continuam ausentes. */
export function sanitizeTournamentHtml<T extends { description?: string; rules?: string; prize?: string }>(input: T): T {
  const out = { ...input };
  if (typeof out.description === 'string') out.description = sanitizeHtmlAllowlist(out.description);
  if (typeof out.rules === 'string') out.rules = sanitizeHtmlAllowlist(out.rules);
  if (typeof out.prize === 'string') out.prize = sanitizeHtmlAllowlist(out.prize);
  return out;
}
