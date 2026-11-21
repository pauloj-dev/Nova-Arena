/**
 * Headers de segurança (issue #113, RNF-07, PRD §16.5). Funções puras: o `proxy.ts` gera o nonce e monta a CSP de
 * cada página; o `next.config.ts` aplica os headers fixos a todas as respostas (páginas, API e arquivos).
 *
 * CSP com nonce + `'strict-dynamic'`: só roda script que veio do servidor nesta resposta (o Next põe o nonce nos
 * próprios scripts) ou que um deles carregou. Por isso as páginas são sempre renderizadas na hora (o layout raiz lê o
 * nonce); os dados públicos continuam em cache (`unstable_cache` + `Cache-Control` da API). Detalhes e a lista de
 * origens em `docs/seguranca.md`.
 */

export interface CspOptions {
  nonce: string;
  /** Desenvolvimento: o React usa `eval` para reconstruir pilhas de erro. */
  dev: boolean;
  /** Página servida por HTTPS: pede para o navegador trocar `http:` por `https:`. */
  https: boolean;
}

/** Origens de terceiros que o site usa, por diretiva. Mudou um serviço? Mude aqui e em `docs/seguranca.md`. */
export const CSP_SOURCES = {
  img: [
    // Vercel Blob (avatares, logos, banners, capas) e fotos do login social.
    'https://*.public.blob.vercel-storage.com',
    'https://lh3.googleusercontent.com',
    'https://cdn.discordapp.com',
    // Miniaturas das transmissões.
    'https://i.ytimg.com',
    'https://static-cdn.jtvnw.net',
  ],
  connect: [
    // Tempo real (Ably): REST, WebSocket e servidores de reserva.
    'https://*.ably.io',
    'wss://*.ably.io',
    'https://*.ably.net',
    'wss://*.ably.net',
    'https://*.ably-realtime.com',
    'wss://*.ably-realtime.com',
    // Envio direto do navegador para o Vercel Blob (`@vercel/blob/client`).
    'https://vercel.com',
    'https://*.blob.vercel-storage.com',
    // Sentry (erros do navegador), quando o túnel não estiver em uso.
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    // Vercel Speed Insights / Analytics (no domínio próprio o envio é para `/_vercel/*`).
    'https://vitals.vercel-insights.com',
  ],
  frame: ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.twitch.tv'],
} as const;

/** Nonce de 128 bits, em base64 (vale para uma resposta só). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function contentSecurityPolicy({ nonce, dev, https }: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    // `'wasm-unsafe-eval'`: o desafio anti-bot (BotID) pode usar WebAssembly. `'unsafe-eval'` só em desenvolvimento.
    ['script-src', "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Estilos inline do Next (fontes), do Radix (posição de menus) e atributos `style`: não executam código.
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:', ...CSP_SOURCES.img],
    ['font-src', "'self'", 'data:'],
    ['connect-src', "'self'", ...CSP_SOURCES.connect, ...(dev ? ['ws:', 'http://localhost:*'] : [])],
    ['media-src', "'self'", 'blob:', 'data:'],
    ['frame-src', ...CSP_SOURCES.frame],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    // Ninguém põe a Nova Arena dentro de um iframe (clickjacking).
    ['frame-ancestors', "'none'"],
  ];
  const parts = directives.map((d) => d.join(' '));
  if (https && !dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** Headers fixos de todas as respostas (aplicados pelo `next.config.ts`). */
export function staticSecurityHeaders(): { key: string; value: string }[] {
  return [
    // HTTPS por 2 anos, subdomínios incluídos (pronto para a lista de preload). Só vale quando a resposta é HTTPS.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Recursos do aparelho que o site não usa ficam desligados (inclusive para iframes de terceiros).
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()' },
    // Navegadores antigos sem `frame-ancestors`.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ];
}
