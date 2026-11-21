/**
 * #105: o service worker de verdade. Só roda contra o build de produção **sem** API simulada, porque com o mock o
 * MSW ocupa o escopo `/` e o worker do PWA fica desligado (`shared/pwa/config.ts`):
 *
 *   NEXT_PUBLIC_API_MOCK=none NEXT_DIST_DIR=.next-pwa pnpm exec next build && NEXT_DIST_DIR=.next-pwa pnpm exec next start -p 3135
 *   PWA_E2E=1 PLAYWRIGHT_BASE_URL=http://localhost:3135 pnpm exec playwright test e2e/r1-pwa-sw.spec.ts --project=desktop-1440
 */
import { expect, test } from '@playwright/test';

test.skip(process.env.PWA_E2E !== '1', 'Só contra o build de produção sem API simulada (PWA_E2E=1).');
test.describe.configure({ timeout: 120_000 });

async function cachedUrls(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
}

test('o service worker assume a página, pré-carrega os estáticos e nunca guarda /api', async ({ page, context }) => {
  await page.goto('/sem-conexao');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(new URL(scope).pathname).toBe('/');
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toMatch(/\/serwist\/sw\.js$/);

  // Algumas chamadas de API passam pelo worker.
  await page.evaluate(async () => {
    for (const p of ['/api/v1/site/settings', '/api/v1/site/banner', '/api/v1/games']) await fetch(p).catch(() => null);
  });
  const urls = await cachedUrls(page);
  expect(urls.some((u) => u.startsWith('/_next/static/')), 'estáticos pré-carregados').toBe(true);
  expect(urls).toContain('/sem-conexao');
  expect(urls.filter((u) => u.startsWith('/api/')), 'nada de /api no cache').toEqual([]);

  // Sem rede: a API falha (não vem do cache) e uma página nova cai na página offline.
  await context.setOffline(true);
  const apiOffline = await page.evaluate(() =>
    fetch('/api/v1/site/settings')
      .then((r) => `status ${r.status}`)
      .catch(() => 'sem rede'),
  );
  expect(apiOffline).toBe('sem rede');
  await page.goto('/campeonatos');
  await expect(page.getByRole('heading', { level: 1, name: 'Você está sem internet' })).toBeVisible();
  await context.setOffline(false);
});
