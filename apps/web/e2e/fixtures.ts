import { test as base, expect, type Page } from '@playwright/test';

export type DemoUser = 'u_bianca' | 'u_lucas' | 'u_camila' | 'u_diego' | 'u_ana' | 'u_rafael' | `u_p${string}`;

/** Espera a API simulada assumir (o service worker é registrado na primeira carga). */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.getByText('Carregando a Nova Arena…')).toHaveCount(0);
}

/** Entra como um usuário de demonstração, direto pela API simulada. */
export async function loginAs(page: Page, userId: DemoUser): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/');
  await waitForApp(page);
  const status = await page.evaluate(async (id) => {
    const res = await fetch('/api/v1/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    return res.status;
  }, userId);
  expect(status).toBe(200);
}

/** Cada teste começa com o banco simulado zerado e sem latência artificial. */
export const test = base.extend({
  page: async ({ page }, run) => {
    await page.addInitScript(() => {
      (window as unknown as { __NOVA_E2E__: boolean }).__NOVA_E2E__ = true;
    });
    await run(page);
  },
});

export { expect };
