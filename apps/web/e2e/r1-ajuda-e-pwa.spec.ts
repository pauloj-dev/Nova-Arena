/**
 * #110: central de ajuda, contato e aviso de manutenção 48 h antes.
 * #105: manifesto, ícones, página offline e botão "Instalar app" (com a API simulada o service worker do PWA fica
 * desligado — ver `r1-pwa-sw.spec.ts`, que roda contra o build de produção sem mock).
 */
import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';

const HORA = 3600_000;

async function api(page: Page, method: string, path: string, body?: unknown): Promise<number> {
  return page.evaluate(
    async ({ method: m, path: p, body: b }) => (await fetch(`/api/v1${p}`, { method: m, headers: b === undefined ? {} : { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })).status,
    { method, path, body },
  );
}

test.describe('central de ajuda e contato', () => {
  test('a ajuda responde as dúvidas principais, com busca e link direto para a resposta', async ({ page }) => {
    await page.goto('/ajuda');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Central de ajuda' })).toBeVisible();
    for (const assunto of ['Inscrição', 'Check-in', 'W.O.', 'Resultados e disputas', 'Organizar campeonatos']) {
      await expect(page.getByRole('heading', { level: 2, name: assunto })).toBeVisible();
    }
    // Resposta abre e fecha pelo teclado (details/summary nativo).
    const pergunta = page.locator('summary', { hasText: 'O que é o check-in e quando faço?' });
    await pergunta.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/janela de check-in, que a organização define/)).toBeVisible();

    await page.getByLabel('Buscar na ajuda').fill('organizador');
    await expect(page.getByRole('status').filter({ hasText: /respostas? encontradas?/ })).toBeVisible();
    await expect(page.getByText('Como viro organizador?')).toBeVisible();
    await expect(page.getByText('O que é W.O.?')).toHaveCount(0);

    await page.getByLabel('Buscar na ajuda').fill('xyzxyz');
    await expect(page.getByRole('heading', { name: 'Nada por aqui com essas palavras' })).toBeVisible();
    await page.getByRole('button', { name: 'Limpar a busca' }).click();
    await expect(page.getByText('O que é W.O.?')).toBeVisible();

    // Âncora direta para uma resposta.
    await page.goto('/ajuda#contestar');
    await waitForApp(page);
    await expect(page.locator('#contestar')).toBeAttached();
  });

  test('o contato mostra o e-mail do suporte das configurações do site', async ({ page }) => {
    await page.goto('/contato');
    await waitForApp(page);
    const settings = await page.evaluate(() => fetch('/api/v1/site/settings').then((r) => r.json() as Promise<{ supportEmail: string }>));
    await expect(page.getByTestId('support-email')).toHaveText(settings.supportEmail);
    await expect(page.getByRole('link', { name: 'Escrever para o suporte' })).toHaveAttribute('href', new RegExp(`^mailto:${settings.supportEmail}`));
  });

  test('o rodapé leva para ajuda, contato, situação do serviço, termos e privacidade em qualquer tamanho', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const rodape = page.getByRole('navigation', { name: 'Rodapé' });
    for (const link of ['Ajuda', 'Contato', 'Situação do serviço', 'Termos de Uso', 'Privacidade']) await expect(rodape.getByRole('link', { name: link })).toBeVisible();
    await rodape.getByRole('link', { name: 'Ajuda' }).click();
    await expect(page).toHaveURL(/\/ajuda$/);
  });
});

test.describe('aviso de manutenção', () => {
  test('aparece para todos só a partir de 48 h antes do início, e a página de manutenção lista a janela', async ({ page }) => {
    await loginAs(page, 'u_ana');
    const agora = Date.now();
    const janela = (inicioEmHoras: number) => ({ startsAt: new Date(agora + inicioEmHoras * HORA).toISOString(), endsAt: new Date(agora + (inicioEmHoras + 2) * HORA).toISOString() });
    expect(await api(page, 'POST', '/admin/announcements', { title: 'Atualização do banco', body: 'O site fica fora do ar por até 2 horas.', kind: 'MAINTENANCE', audience: 'ALL', gameId: null, ...janela(47) })).toBe(201);
    expect(await api(page, 'POST', '/admin/announcements', { title: 'Troca de servidores', body: 'Janela longa de manutenção.', kind: 'MAINTENANCE', audience: 'ALL', gameId: null, ...janela(49) })).toBe(201);

    // Área do Admin também mostra o aviso.
    await page.goto('/admin/comunicados');
    await waitForApp(page);
    await expect(page.getByTestId('site-banner').filter({ hasText: 'Atualização do banco' })).toBeVisible();

    // Visitante (sem login) no site público.
    expect(await api(page, 'POST', '/auth/logout')).toBeLessThan(300);
    await page.goto('/');
    await waitForApp(page);
    const avisos = page.getByTestId('site-banner');
    await expect(avisos.filter({ hasText: 'Manutenção programada: Atualização do banco' })).toBeVisible();
    await expect(avisos.filter({ hasText: 'Troca de servidores' })).toHaveCount(0);

    await avisos.getByRole('link', { name: 'Saiba mais' }).first().click();
    await expect(page).toHaveURL(/\/manutencao$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Manutenção e situação do serviço' })).toBeVisible();
    await expect(page.getByTestId('maintenance-window').filter({ hasText: 'Atualização do banco' })).toBeVisible();
    await expect(page.getByTestId('service-status')).toContainText('Tudo funcionando');
  });
});

test.describe('PWA', () => {
  test('manifesto instalável com ícones próprios', async ({ page, request }) => {
    await page.goto('/');
    await waitForApp(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = (await (await request.get(href as string)).json()) as { name: string; short_name: string; start_url: string; display: string; lang: string; icons: { src: string; sizes: string; purpose?: string }[] };
    expect(manifest).toMatchObject({ short_name: 'Nova Arena', start_url: '/', display: 'standalone', lang: 'pt-BR' });
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(icon.src);
      expect(res.status(), icon.src).toBe(200);
    }
    // iOS: ícone da tela de início e modo app.
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Nova Arena');
  });

  test('a página offline funciona sozinha e oferece tentar de novo', async ({ page }) => {
    await page.goto('/sem-conexao');
    await expect(page.getByRole('heading', { level: 1, name: 'Você está sem internet' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar de novo' })).toBeVisible();
  });

  test('"Instalar app" aparece quando o navegador permite e abre o aviso de instalação', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const instalar = page.getByRole('button', { name: 'Instalar app' });
    await expect(instalar).toHaveCount(0);
    // Simula o evento do Chrome/Android (o de verdade só vem com critérios de engajamento).
    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      (window as unknown as { __promptCalls: number }).__promptCalls = 0;
      event.prompt = async () => {
        (window as unknown as { __promptCalls: number }).__promptCalls += 1;
      };
      event.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(event);
    });
    await expect(instalar).toBeVisible();
    await instalar.click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls)).toBe(1);
    await expect(page.getByText('App instalado')).toBeVisible();
    await expect(instalar).toHaveCount(0);
  });
});

test.describe('PWA no iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });

  test('"Instalar app" mostra o passo a passo do Safari', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.getByRole('button', { name: 'Instalar app' }).click();
    const dialog = page.getByRole('dialog', { name: 'Instalar no iPhone ou iPad' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Adicionar à Tela de Início')).toBeVisible();
  });
});
