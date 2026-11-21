/**
 * Pós-lançamento B (issues 121 e 125): aba Discord da operação (vínculo simulado no protótipo, aviso de teste,
 * desvincular) e chat da partida entre a jogadora e a organização. Em 1440 px e 360 px.
 *
 * Seed: "Liga Semanal Clash Royale 1v1" (`tn_liga_cr`, da Camila) em andamento, com a partida da Bianca nas quartas.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

const LIGA_ID = 'tn_liga_cr';
const LIGA = 'liga-semanal-clash-royale';

async function visit(page: Page, path: string, as: DemoUser) {
  await page.goto(path);
  await loginAs(page, as);
  await page.goto(path);
  await waitForApp(page);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'a página não pode rolar na horizontal').toBeLessThanOrEqual(1);
}

async function axe(page: Page, selector: string) {
  const result = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('bot do Discord na operação do organizador', () => {
  test('gera o código, vincula pelo comando simulado, envia aviso de teste e desvincula', async ({ page }) => {
    await visit(page, `/organizador/campeonatos/${LIGA_ID}?aba=discord`, 'u_camila');
    const tab = page.getByTestId('discord-tab');
    await expect(tab.getByRole('heading', { name: 'Bot do Discord' })).toBeVisible();
    await expect(tab.getByTestId('discord-setup')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await axe(page, '[data-testid="discord-tab"]');

    await tab.getByRole('button', { name: 'Gerar código de vínculo' }).click();
    const code = tab.getByTestId('discord-code');
    await expect(code.getByLabel('Comando para o Discord')).toHaveText(/^\/nova-arena vincular codigo:NA-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await expectNoHorizontalScroll(page);

    await code.getByRole('button', { name: 'Simular o comando no protótipo' }).click();
    const active = tab.getByTestId('discord-active');
    await expect(active.getByRole('heading', { name: 'Servidor de demonstração' })).toBeVisible();
    await expect(active.getByText('Vinculado', { exact: true })).toBeVisible();
    await expect(active).toContainText('Nenhum ainda');
    await axe(page, '[data-testid="discord-tab"]');

    await active.getByRole('button', { name: 'Enviar aviso de teste' }).click();
    await expect(page.getByText('Aviso de teste enviado')).toBeVisible();
    await expect(active).not.toContainText('Nenhum ainda');

    await active.getByRole('button', { name: 'Desvincular' }).click();
    const dialog = page.getByRole('dialog', { name: 'Desvincular o Discord?' });
    await dialog.getByRole('textbox').fill('desvincular');
    await dialog.getByRole('button', { name: 'Desvincular' }).click();
    await expect(tab.getByTestId('discord-setup')).toBeVisible();
  });

  test('moderador não vê a aba Discord', async ({ page }) => {
    await visit(page, `/organizador/campeonatos/${LIGA_ID}?aba=discord`, 'u_camila');
    // Diego vira moderador da liga e tenta abrir a aba pelo endereço.
    const status = await page.evaluate(async () => {
      const db = JSON.parse(localStorage.getItem('nova-mock-db') ?? '{}') as { users?: { id: string; nickname: string }[] };
      const nickname = db.users?.find((u) => u.id === 'u_diego')?.nickname ?? '';
      const res = await fetch('/api/v1/tournaments/tn_liga_cr/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, role: 'MODERATOR' }) });
      return res.status;
    });
    expect(status).toBeLessThan(300);
    await visit(page, `/organizador/campeonatos/${LIGA_ID}?aba=discord`, 'u_diego');
    await expect(page.getByRole('tab', { name: 'Partidas e resultados' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Discord' })).toHaveCount(0);
    await expect(page.getByTestId('discord-tab')).toHaveCount(0);
  });
});

test.describe('chat da partida', () => {
  test('a jogadora escreve no detalhe da partida; a organização lê, responde e oculta', async ({ page }) => {
    await visit(page, '/', 'u_bianca');
    const matchId = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/tournaments/${slug}/matches?mine=1`);
      const list = (await res.json()) as { id: string; status: string }[];
      return list.find((m) => m.status === 'CHECK_IN')?.id ?? '';
    }, LIGA);
    expect(matchId).not.toBe('');

    await page.goto(`/c/${LIGA}?aba=partidas&partida=${encodeURIComponent(matchId)}`);
    await waitForApp(page);
    const detail = page.getByRole('dialog', { name: 'Detalhes da partida' });
    const chat = detail.getByTestId('match-chat');
    await expect(chat.getByRole('heading', { name: 'Chat da partida' })).toBeVisible();
    await expect(chat).toContainText('Nenhuma mensagem ainda');
    await chat.getByRole('textbox', { name: 'Mensagem' }).fill('Bora jogar às 20h? Já estou online.');
    await chat.getByRole('button', { name: 'Enviar' }).click();
    const mine = chat.getByTestId('chat-message').filter({ hasText: 'Bora jogar às 20h?' });
    await expect(mine).toContainText('Você');
    await expect(chat.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('');
    // Enter também envia.
    await chat.getByRole('textbox', { name: 'Mensagem' }).fill('Sala no privado, por favor.');
    await chat.getByRole('textbox', { name: 'Mensagem' }).press('Enter');
    await expect(chat.getByTestId('chat-message')).toHaveCount(2);
    await expectNoHorizontalScroll(page);
    await axe(page, '[data-testid="match-chat"]');

    await visit(page, `/organizador/campeonatos/${LIGA_ID}?aba=partidas`, 'u_camila');
    await page.locator(`[data-match-id="${matchId}"]`).getByRole('button', { name: /^Chat da partida:/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Chat da partida' });
    const staffChat = dialog.getByTestId('match-chat');
    await expect(staffChat.getByTestId('chat-message')).toHaveCount(2);
    await staffChat.getByRole('textbox', { name: 'Mensagem' }).fill('Combinado: a sala sai 15 minutos antes.');
    await staffChat.getByRole('button', { name: 'Enviar' }).click();
    const reply = staffChat.getByTestId('chat-message').filter({ hasText: 'Combinado' });
    await expect(reply.getByText('Organização')).toBeVisible();

    const first = staffChat.getByTestId('chat-message').filter({ hasText: 'Bora jogar' });
    await first.getByRole('button', { name: /^Ocultar a mensagem de/ }).click();
    await expect(first.getByText('Oculta para os jogadores')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('quem não está na partida não vê o chat', async ({ page }) => {
    await visit(page, '/', 'u_bianca');
    const matchId = await page.evaluate(async (slug) => {
      const res = await fetch(`/api/v1/tournaments/${slug}/matches?mine=1`);
      return ((await res.json()) as { id: string; status: string }[]).find((m) => m.status === 'CHECK_IN')?.id ?? '';
    }, LIGA);
    await visit(page, `/c/${LIGA}?aba=partidas&partida=${encodeURIComponent(matchId)}`, 'u_p40');
    await expect(page.getByRole('dialog', { name: 'Detalhes da partida' })).toBeVisible();
    await expect(page.getByTestId('match-chat')).toHaveCount(0);
  });
});
