/** Cache na borda (#111): valores do `Cache-Control` e a separação entre visitante e quem está logado. */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from '../src/context';
import { cacheControlValue, defaultNoStore, EDGE_CACHE, isSettled, noStore, NO_STORE, publicCache, visitorCache } from '../src/http-cache';

function probe() {
  const app = new Hono<AppEnv>();
  app.use(defaultNoStore);
  app.get('/publico', (c) => {
    publicCache(c, { sMaxAge: 30, staleWhileRevalidate: 300 });
    return c.json({ ok: true });
  });
  app.get('/visitante', (c) => {
    visitorCache(c, EDGE_CACHE.catalog);
    return c.json({ ok: true });
  });
  app.get('/privado', (c) => {
    noStore(c);
    return c.json({ ok: true });
  });
  app.get('/nada', (c) => c.json({ ok: true }));
  app.get('/erro', () => {
    throw new Error('falhou');
  });
  app.onError((_, c) => c.json({ erro: true }, 500));
  return app;
}

describe('cacheControlValue', () => {
  it('monta s-maxage e stale-while-revalidate sem deixar o navegador guardar', () => {
    expect(cacheControlValue({ sMaxAge: 30, staleWhileRevalidate: 300 })).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=300');
  });
  it('sem stale-while-revalidate quando é zero; arredonda e não aceita negativo', () => {
    expect(cacheControlValue({ sMaxAge: 10.7, staleWhileRevalidate: 0 })).toBe('public, max-age=0, s-maxage=10');
    expect(cacheControlValue({ sMaxAge: -5, staleWhileRevalidate: -1 })).toBe('public, max-age=0, s-maxage=0');
  });
  it('isSettled: só encerrado, arquivado ou cancelado', () => {
    expect(['FINISHED', 'ARCHIVED', 'CANCELLED'].every(isSettled)).toBe(true);
    expect(['IN_PROGRESS', 'REGISTRATION_OPEN', 'DRAFT', 'PAUSED'].some(isSettled)).toBe(false);
  });
});

describe('helpers nas rotas', () => {
  it('publicCache vale para todos, com ou sem cookie', async () => {
    const app = probe();
    expect((await app.request('/publico')).headers.get('cache-control')).toBe('public, max-age=0, s-maxage=30, stale-while-revalidate=300');
    expect((await app.request('/publico', { headers: { Cookie: 'na_at=abc' } })).headers.get('cache-control')).toContain('s-maxage=30');
  });

  it('visitorCache: visitante vai para a borda com Vary: Cookie; quem tem sessão fica sem cache', async () => {
    const app = probe();
    const visitor = await app.request('/visitante', { headers: { Cookie: 'consentimento=essenciais' } });
    expect(visitor.headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.catalog));
    expect(visitor.headers.get('vary')).toContain('Cookie');
    const logged = await app.request('/visitante', { headers: { Cookie: 'na_at=token' } });
    expect(logged.headers.get('cache-control')).toBe(NO_STORE);
  });

  it('o padrão é private, no-store (inclusive em erro); quem escolheu não é sobrescrito', async () => {
    const app = probe();
    expect((await app.request('/nada')).headers.get('cache-control')).toBe(NO_STORE);
    expect((await app.request('/erro')).headers.get('cache-control')).toBe(NO_STORE);
    expect((await app.request('/privado')).headers.get('cache-control')).toBe(NO_STORE);
    expect((await app.request('/publico')).headers.get('cache-control')).not.toBe(NO_STORE);
  });
});
