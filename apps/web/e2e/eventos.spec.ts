/**
 * Eventos (ADR-0005) — roda em 1440 px e 360 px. A organizadora cria um evento com a regra "um só campeonato por
 * jogador", coloca campeonatos nele e começa um campeonato já dentro do evento; o visitante vê a página do evento; o
 * jogador que já está num campeonato do Festival Free Fire (seed) é avisado, na página do outro, de que não pode
 * entrar nele — antes do clique, com a mensagem clara.
 */
import type { Page } from '@playwright/test';
import { expect, loginAs, mid, test, waitForApp } from './fixtures';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${page.url()}`).toBeLessThanOrEqual(0);
}

async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<number> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return res.status;
    },
    { method, path, body },
  );
}

test.describe('eventos', () => {
  test('organizadora cria o evento, adiciona um campeonato e começa outro já dentro do evento', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador');
    if (isMobile(page)) await page.getByRole('button', { name: /menu/i }).first().click();
    await page.getByRole('link', { name: 'Eventos' }).locator('visible=true').first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Eventos' })).toBeVisible();
    // O evento da seed já aparece, com a regra.
    await expect(page.getByRole('link', { name: 'Festival Free Fire' })).toBeVisible();
    await page.getByRole('link', { name: 'Criar evento' }).first().click();

    await expect(page.getByRole('heading', { level: 1, name: 'Criar evento' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByLabel('Nome do evento').fill('Semana da Comunidade');
    await page.getByRole('radio', { name: 'Um só campeonato por jogador' }).check();
    await page.getByRole('button', { name: 'Criar evento' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Semana da Comunidade' })).toBeVisible();
    await expect(page.getByText('Cada jogador pode participar de um só campeonato deste evento.').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nenhum campeonato no evento' })).toBeVisible();

    // Campeonato que já existe (o rascunho do Torneio Relâmpago) entra pela lista.
    const add = page.getByLabel('Adicionar campeonato existente');
    const value = await add.locator('option', { hasText: 'Torneio Relâmpago CR 2v2' }).getAttribute('value');
    await add.selectOption(value ?? '');
    await page.getByRole('button', { name: 'Adicionar', exact: true }).click();
    const list = page.getByRole('region', { name: 'Campeonatos do evento' });
    await expect(list.getByRole('link', { name: 'Torneio Relâmpago CR 2v2' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // "Criar campeonato neste evento": o assistente já vem com o evento escolhido.
    await list.getByRole('link', { name: 'Criar campeonato neste evento' }).click();
    await expect(page).toHaveURL(/\/organizador\/novo\?evento=/);
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    const eventSelect = page.getByLabel('Evento', { exact: true });
    await expect(eventSelect.locator('option:checked')).toHaveText('Semana da Comunidade');
    await expect(page.getByText('Neste evento cada jogador participa de um só campeonato.')).toBeVisible();
  });

  test('visitante vê a página do evento: a regra em palavras simples e os campeonatos', async ({ page }) => {
    await page.goto('/e/festival-free-fire');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Festival Free Fire' })).toBeVisible();
    await expect(page.getByText('Cada jogador pode participar de um só campeonato deste evento.')).toBeVisible();
    const section = page.getByRole('region', { name: 'Campeonatos' });
    await expect(section.getByRole('link', { name: /Copa Nova FF — Squad/ })).toHaveAttribute('href', '/c/copa-nova-ff-squad');
    await expect(section.getByRole('link', { name: /FF Solo Rush/ })).toHaveAttribute('href', '/c/ff-solo-rush');
    await expectNoHorizontalScroll(page);

    // A página do campeonato leva de volta ao evento.
    await page.goto('/c/copa-nova-ff-squad');
    const note = page.getByTestId('evento-do-campeonato');
    await expect(note.getByRole('link', { name: 'Festival Free Fire' })).toHaveAttribute('href', '/e/festival-free-fire');

    await page.goto('/e/nao-existe');
    await expect(page.getByRole('heading', { name: 'Evento não encontrado' })).toBeVisible();
  });

  test('jogador já confirmado na Copa Nova FF é avisado, no FF Solo Rush, de que não pode entrar em outro campeonato do evento', async ({ page }) => {
    // A organizadora abre as inscrições do FF Solo Rush (na seed ele está só publicado).
    await loginAs(page, 'u_camila');
    expect(await apiCall(page, 'POST', `/tournaments/${mid('tn_ff_solo')}/open-registration`)).toBe(200);
    await page.context().clearCookies();
    await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' }));

    // u_p05 joga a Copa Nova FF — Squad pelo Squad 1 (membro confirmado).
    await loginAs(page, 'u_p05');
    await page.goto('/c/ff-solo-rush');
    await expect(page.getByRole('heading', { level: 1, name: 'FF Solo Rush' })).toBeVisible();
    await expect(page.getByTestId('evento-do-campeonato')).toContainText('Faz parte do evento Festival Free Fire');
    const panel = page.getByRole('region', { name: 'Inscrição' });
    await expect(panel.getByText('Você já está em outro campeonato deste evento')).toBeVisible();
    await expect(panel.getByTestId('conflito-evento')).toHaveText('Você está inscrito no campeonato Copa Nova FF — Squad do evento Festival Free Fire. Neste evento cada jogador participa de um só campeonato.');
    await expect(panel.getByRole('link', { name: 'Copa Nova FF — Squad' })).toHaveAttribute('href', '/c/copa-nova-ff-squad');
    await expect(panel.getByRole('button', { name: /Inscrever/ })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Mesmo tentando pela API, a resposta é a mesma regra, com a mensagem clara.
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`/api/v1/tournaments/${id}/registrations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acceptRules: true }) });
      return { status: r.status, body: (await r.json()) as { code?: string; detail?: string } };
    }, mid('tn_ff_solo'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EVENT_SINGLE_CHAMPIONSHIP');
    expect(res.body.detail).toBe('Você já está inscrito no campeonato Copa Nova FF — Squad deste evento. Neste evento cada jogador participa de um só campeonato.');
  });
});
