import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';

/**
 * Modo telão (issue #124): classificação e chave em tela cheia para o OBS, em 1920×1080, e o link
 * "Abrir no telão" na operação do organizador (1440 px e 360 px).
 */
const LIGA = 'liga-semanal-clash-royale';
const OPEN = 'open-8-ball-pool';
const COPA = 'tn_copa_ff';
const COPA_SLUG = 'copa-nova-ff-squad';
const COPA_S1 = 'tn_copa_ff_s1';

interface ApiMatch {
  id: string;
  kind: 'DUEL' | 'LOBBY';
  groupName: string | null;
  participants: { registrationId: string | null }[];
}

/** Chama a API simulada de dentro da página (com a sessão de quem está logado). */
async function ok<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await page.evaluate(
    async ({ path: p, init: i }) => {
      const r = await fetch(`/api/v1${p}`, {
        method: i?.method ?? 'GET',
        headers: i?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: i?.body === undefined ? undefined : JSON.stringify(i.body),
      });
      return { status: r.status, data: (await r.json().catch(() => null)) as unknown };
    },
    { path, init },
  );
  expect(res.status, `${init?.method ?? 'GET'} ${path}`).toBeLessThan(300);
  return res.data as T;
}

test.describe('telão em 1920×1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  // O telão é para a transmissão: roda uma vez só, no navegador de desktop.
  test.skip(({ isMobile }) => isMobile, 'O telão é testado em 1920×1080 no desktop.');

  test('chave ao vivo do mata-mata: sem cabeçalho do site, rodadas lado a lado e AO VIVO', async ({ page }) => {
    await page.goto(`/c/${LIGA}/telao/chave`);
    await waitForApp(page);
    const telao = page.getByTestId('telao');
    await expect(page.getByRole('heading', { level: 1, name: 'Liga Semanal Clash Royale 1v1' })).toBeVisible();
    await expect(page.getByText('Mata-mata · Chave')).toBeVisible();
    await expect(telao.getByText('AO VIVO')).toBeVisible();
    await expect(page.getByTestId('telao-partida').first()).toBeVisible();
    // Nada do site: sem menu, rodapé nem o seletor do protótipo.
    await expect(page.getByRole('banner').getByRole('link', { name: 'Campeonatos' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Protótipo: entrar como/ })).toHaveCount(0);
    await expect(telao).toHaveAttribute('data-fundo', 'padrao');
    // Cabe na tela, sem rolagem horizontal.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('tabela do suíço com fundo transparente para o OBS', async ({ page }) => {
    await page.goto(`/c/${OPEN}/telao/tabela?fundo=transparente`);
    await waitForApp(page);
    await expect(page.getByTestId('telao')).toHaveAttribute('data-fundo', 'transparente');
    await expect(page.getByRole('table', { name: /Classificação/ })).toBeVisible();
    expect(await page.getByTestId('telao-linha').count()).toBeGreaterThan(1);
    const background = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.documentElement).backgroundColor]);
    expect(background).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
  });

  test('gira entre as páginas sozinho e pelo teclado', async ({ page }) => {
    await page.goto(`/c/${LIGA}/telao/chave?intervalo=5`);
    await waitForApp(page);
    const indicator = page.getByTestId('telao-pagina');
    await expect(indicator).toContainText('1 de 2');
    await expect(indicator).toContainText('2 de 2', { timeout: 8_000 });
    await page.keyboard.press('ArrowRight');
    await expect(indicator).toContainText('1 de 2');
    await page.keyboard.press(' ');
    await expect(indicator).toContainText('pausado');
  });

  test('grupos de Battle Royale: uma página por grupo e a tabela atualiza sozinha quando sai uma queda', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await ok(page, `/tournaments/${COPA}/close-registration`, { method: 'POST' });
    await ok(page, `/stages/${COPA_S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'e2e-telao' } });
    await ok(page, `/stages/${COPA_S1}/confirm`, { method: 'POST' });

    await page.goto(`/c/${COPA_SLUG}/telao/tabela?intervalo=120`);
    await waitForApp(page);
    const indicator = page.getByTestId('telao-pagina');
    await expect(indicator).toContainText('Grupo A');
    await expect(indicator).toContainText('1 de 4');
    await expect(page.getByRole('columnheader', { name: 'Booyahs' })).toBeVisible();
    const first = page.getByTestId('telao-linha').first();
    await expect(first.locator('td').last()).toHaveText('0');

    // Uma queda do Grupo A é lançada (pela API, como a organização faria em outra aba).
    const bracket = await ok<{ matches: ApiMatch[] }>(page, `/stages/${COPA_S1}/bracket`);
    const drop = bracket.matches.find((m) => m.kind === 'LOBBY' && m.groupName === 'Grupo A');
    expect(drop).toBeDefined();
    const entries = (drop as ApiMatch).participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 5 - Math.min(i, 5) }));
    await ok(page, `/matches/${(drop as ApiMatch).id}/result`, { method: 'PUT', body: { entries } });

    // Sem recarregar: o líder do grupo passa a ter pontos.
    await expect(page.getByTestId('telao-linha').first().locator('td').last()).not.toHaveText('0');
  });

  test('campeonato que não existe mostra o erro com "Tentar novamente"', async ({ page }) => {
    await page.goto('/c/nao-existe/telao/tabela');
    await waitForApp(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar o campeonato' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  });
});

test.describe('link "Abrir no telão" na operação', () => {
  test('o organizador abre as instruções do OBS e copia o link da fase', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/campeonatos/tn_liga_cr?aba=fases');
    await page.getByRole('button', { name: 'Abrir no telão' }).click();
    const dialog = page.getByRole('dialog', { name: 'Abrir no telão' });
    await expect(dialog.getByText('Como adicionar no OBS')).toBeVisible();
    await expect(dialog.getByText('1920')).toBeVisible();
    await expect(dialog.getByTestId('telao-link-tabela')).toContainText(`/c/${LIGA}/telao/tabela?fase=`);
    await dialog.getByRole('switch', { name: 'Fundo transparente' }).click();
    await expect(dialog.getByTestId('telao-link-chave')).toContainText('fundo=transparente');
    const open = dialog.getByRole('link', { name: /Abrir a chave no telão/ });
    await expect(open).toHaveAttribute('href', /\/telao\/chave\?fase=.+&fundo=transparente$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
