import { test as base, expect, type Page } from '@playwright/test';
import { demoId } from '@nova/api/demo-ids';
import { createSession, restoreSnapshot } from './real/db';
import { isRealApi, serverEnv } from './real/env';

export { isRealApi };

export type DemoUser = 'u_bianca' | 'u_lucas' | 'u_camila' | 'u_diego' | 'u_ana' | 'u_rafael' | `u_p${string}`;

/**
 * ID de um registro do protótipo (`tn_liga_cr`, `u_bianca`, `t_alfa`…) no modo em uso: com a API real, o UUID que a
 * seed de demonstração gravou para ele (`demoId`); com a API simulada, o próprio ID.
 */
export function mid(mockId: string): string {
  return isRealApi ? demoId(mockId) : mockId;
}

/**
 * API real sem o Vercel Blob (ambiente local, sem `BLOB_READ_WRITE_TOKEN`): o envio de imagens responde 503. Os testes
 * que anexam arquivo ficam de fora nesse caso — e rodam no preview, onde o Blob existe.
 */
export const NO_BLOB = isRealApi && !serverEnv('BLOB_READ_WRITE_TOKEN');
export const NO_BLOB_REASON = 'Anexa arquivo: com a API real precisa do Vercel Blob (BLOB_READ_WRITE_TOKEN), que o ambiente local não tem.';


/** Espera a API simulada assumir (o service worker é registrado na primeira carga). Com a API real, não há o que esperar. */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.getByText('Carregando a Nova Arena…')).toHaveCount(0);
}

/**
 * Entra como um usuário de demonstração. Protótipo: `POST /auth/dev-login` da API simulada. API real: sessão aberta
 * direto no banco (o mesmo registro que o login grava) e os cookies `httpOnly` postos no navegador.
 */
export async function loginAs(page: Page, userId: DemoUser): Promise<void> {
  if (isRealApi) {
    const { access, refresh } = await createSession(demoId(userId));
    const url = new URL(page.url() === 'about:blank' ? (test.info().project.use.baseURL ?? 'http://localhost:3100') : page.url());
    await page.context().addCookies([
      { name: 'na_at', value: access, domain: url.hostname, path: '/', httpOnly: true, sameSite: 'Lax', secure: url.protocol === 'https:' },
      { name: 'na_rt', value: refresh, domain: url.hostname, path: '/api/v1/auth', httpOnly: true, sameSite: 'Lax', secure: url.protocol === 'https:' },
    ]);
    if (page.url() === 'about:blank') await page.goto('/');
    return;
  }
  if (page.url() === 'about:blank') await page.goto('/');
  await waitForApp(page);
  const status = await page.evaluate(async (id) => {
    const res = await fetch('/api/v1/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: id }) });
    return res.status;
  }, userId);
  expect(status).toBe(200);
}

/**
 * Cada teste começa com os dados do seed: no protótipo, o banco simulado zerado (contexto novo do navegador, sem
 * latência artificial); com a API real, o banco volta ao retrato da seed de demonstração (`e2e/real/db.ts`).
 */
export const test = base.extend({
  page: async ({ page }, run) => {
    if (isRealApi) {
      await restoreSnapshot();
      // Cada teste é um "aparelho" diferente para o limite de tentativas por IP (5 logins por minuto): como no
      // protótipo, um teste não herda as tentativas do anterior.
      const ip = `198.18.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
      await page.context().setExtraHTTPHeaders({ ...(test.info().project.use.extraHTTPHeaders ?? {}), 'x-forwarded-for': ip });
    }
    await page.addInitScript(() => {
      (window as unknown as { __NOVA_E2E__: boolean }).__NOVA_E2E__ = true;
    });
    await run(page);
  },
});

export { expect };
