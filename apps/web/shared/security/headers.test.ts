import { describe, expect, it } from 'vitest';
import { scrubEvent } from '../observability/sentry-options';
import { contentSecurityPolicy, createNonce, staticSecurityHeaders } from './headers';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('CSP com nonce (issue #113)', () => {
  it('nonce novo a cada resposta, com 128 bits', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });

  it('em produção: só script com o nonce (strict-dynamic), sem eval, sem iframe de fora e com upgrade para HTTPS', () => {
    const csp = contentSecurityPolicy({ nonce: 'abc123', dev: false, https: true });
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, 'script-src')).not.toContain("'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('cobre Ably, Vercel Blob, Sentry, Speed Insights e os embeds do YouTube e da Twitch', () => {
    const csp = contentSecurityPolicy({ nonce: 'n', dev: false, https: true });
    for (const origin of ['wss://*.ably.io', 'https://*.ably-realtime.com', 'https://vercel.com', 'https://*.ingest.sentry.io', 'https://vitals.vercel-insights.com']) expect(directive(csp, 'connect-src')).toContain(origin);
    expect(directive(csp, 'img-src')).toContain('https://*.public.blob.vercel-storage.com');
    expect(directive(csp, 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.twitch.tv');
  });

  it('em desenvolvimento libera eval (React) e o recarregamento ao vivo; sem HTTPS não força upgrade', () => {
    const csp = contentSecurityPolicy({ nonce: 'n', dev: true, https: false });
    expect(directive(csp, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(csp, 'connect-src')).toContain('ws:');
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('headers fixos: HSTS de 2 anos, nosniff, Referrer-Policy, Permissions-Policy e anti-iframe', () => {
    const map = Object.fromEntries(staticSecurityHeaders().map((h) => [h.key, h.value]));
    expect(map['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains; preload');
    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Permissions-Policy']).toContain('camera=()');
    expect(map['Permissions-Policy']).toContain('geolocation=()');
    expect(map['X-Frame-Options']).toBe('DENY');
  });
});

describe('Sentry sem dado pessoal (issue #116)', () => {
  it('tira cookies, autenticação, corpo, query string e tudo do usuário menos o id', () => {
    const event = scrubEvent({
      request: { cookies: { na_at: 'x' }, data: { password: 'segredo' }, headers: { Cookie: 'na_at=x', Authorization: 'Bearer y', 'User-Agent': 'Firefox' }, query_string: 'token=abc' },
      user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
    });
    expect(event.request).toEqual({ headers: { 'User-Agent': 'Firefox' }, query_string: '[removido]' });
    expect(event.user).toEqual({ id: 'u1' });
  });
});
