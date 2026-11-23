/**
 * Cache na borda da Vercel para as leituras públicas (plano R2.1, issue #111, RNF-01 a RNF-04).
 *
 * A CDN da Vercel guarda a resposta de uma função quando ela traz `s-maxage` (o navegador não vê essa diretiva:
 * `max-age=0` faz ele sempre perguntar à borda). `stale-while-revalidate` deixa a borda entregar a cópia antiga
 * enquanto busca a nova em segundo plano.
 *
 * Regra de ouro: **resposta que muda conforme quem pede nunca vai para o cache compartilhado.** A chave do cache
 * da borda não inclui o cookie, a não ser com `Vary: Cookie`. Por isso há três jeitos de responder:
 *
 * - `publicCache`: a resposta é igual para todo mundo (ex.: vitrine de campeonatos, perfil público).
 * - `visitorCache`: a resposta muda para quem está logado (ex.: catálogo de jogos com os modelos da pessoa, chave
 *   com a prévia da organização). Visitante sem cookie de sessão → cache público com `Vary: Cookie` (o pedido de
 *   quem tem cookie cai em outra chave e chega à função); com cookie → `private, no-store`.
 * - `noStore`: depende da sessão ou é dado sensível. É também o padrão de toda resposta que não escolheu nada
 *   (`defaultNoStore`, no `app.ts`).
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppContext, AppEnv } from './context';
import { ACCESS_COOKIE } from './auth/edge';

export interface EdgeCacheRule {
  /** Segundos em que a borda serve a cópia sem perguntar à função. */
  sMaxAge: number;
  /** Segundos a mais em que a borda ainda entrega a cópia velha enquanto renova em segundo plano. */
  staleWhileRevalidate: number;
}

/** Tempos usados pelas rotas. Dados ao vivo (chave e tabela em andamento) não entram: o Redis já os serve. */
export const EDGE_CACHE = {
  /** Catálogo de jogos: muda pouco (só o Admin edita). */
  catalog: { sMaxAge: 300, staleWhileRevalidate: 3600 },
  /** Vitrine e página pública do campeonato: vagas mudam a cada inscrição. */
  listing: { sMaxAge: 30, staleWhileRevalidate: 300 },
  /** Perfil público e estatísticas. */
  profile: { sMaxAge: 60, staleWhileRevalidate: 600 },
  /** Campeonato encerrado: chave, tabela e partidas praticamente não mudam mais. */
  finished: { sMaxAge: 300, staleWhileRevalidate: 86_400 },
} satisfies Record<string, EdgeCacheRule>;

export const NO_STORE = 'private, no-store';

/** Campeonato que já terminou (ou foi cancelado): chave, tabela e partidas não mudam mais no dia a dia. */
export function isSettled(status: string): boolean {
  return status === 'FINISHED' || status === 'ARCHIVED' || status === 'CANCELLED';
}

export function cacheControlValue(rule: EdgeCacheRule): string {
  const sMaxAge = Math.max(0, Math.floor(rule.sMaxAge));
  const swr = Math.max(0, Math.floor(rule.staleWhileRevalidate));
  return `public, max-age=0, s-maxage=${sMaxAge}${swr > 0 ? `, stale-while-revalidate=${swr}` : ''}`;
}

/** Quem pede tem cookie de sessão? (O refresh token só vai para `/api/v1/auth`; nas leituras vem o de acesso.) */
export function hasSessionCookie(c: AppContext): boolean {
  return Boolean(getCookie(c, ACCESS_COOKIE));
}

/** Resposta igual para todo mundo: cache público na borda. */
export function publicCache(c: AppContext, rule: EdgeCacheRule): void {
  c.header('Cache-Control', cacheControlValue(rule));
}

/** Resposta que muda para quem está logado: cache público só para visitante, separado por `Vary: Cookie`. */
export function visitorCache(c: AppContext, rule: EdgeCacheRule): void {
  if (hasSessionCookie(c)) return noStore(c);
  c.header('Cache-Control', cacheControlValue(rule));
  c.header('Vary', 'Cookie', { append: true });
}

/** Nada de cache (nem na borda nem no navegador). */
export function noStore(c: AppContext): void {
  c.header('Cache-Control', NO_STORE);
}

/** Toda resposta que não escolheu um cache sai com `private, no-store` (defesa em profundidade). */
export const defaultNoStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (c.res.headers.has('Cache-Control')) return;
  try {
    c.res.headers.set('Cache-Control', NO_STORE);
  } catch {
    // Resposta com headers imutáveis (ex.: repassada de um `fetch`): fica como veio.
  }
};
