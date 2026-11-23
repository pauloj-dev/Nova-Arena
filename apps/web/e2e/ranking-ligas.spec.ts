/**
 * Ranking de temporada (rating ELO) e ligas semanais — issue #120. Roda em 1440 px e 360 px sobre a API simulada:
 * a tabela da temporada em `/ranking`, o rating no perfil, a página pública da liga, a gestão da liga pelo
 * organizador e as temporadas no painel do Admin.
 */
import type { Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp } from './fixtures';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${page.url()}`).toBeLessThanOrEqual(0);
}

async function apiCall<T = unknown>(page: Page, method: string, path: string): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path }) => {
      const res = await fetch(`/api/v1${path}`, { method });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    { method, path },
  );
}

test.describe('ranking de temporada', () => {
  test('/ranking mostra a tabela da temporada (rating), com jogadores e squads', async ({ page }) => {
    await page.goto('/ranking?jogo=8-ball-pool');
    await waitForApp(page);
    const section = page.getByRole('region', { name: 'Temporada de 8 Ball Pool' });
    await expect(section).toBeVisible();
    await expect(section.getByText(/Temporada \d{4} · .* · Em andamento/)).toBeVisible();
    await expect(section.getByText('Todo mundo começa a temporada com 1000 de rating', { exact: false })).toBeVisible();

    const caption = /Temporada \d{4} de 8 Ball Pool: jogadores/;
    if (!isMobile(page)) {
      const table = section.getByRole('table', { name: caption });
      await expect(table.getByRole('columnheader')).toHaveText(['Posição', 'Jogador', 'Rating', 'Partidas', 'V / E / D', 'Pico']);
      await expect(table.getByRole('row')).toHaveCount(9);
      await expect(table.getByRole('row').nth(1).getByRole('cell').first()).toHaveText('1º');
    } else {
      await expect(section.getByRole('list', { name: caption }).getByRole('listitem')).toHaveCount(8);
    }
    // Rating provisório (só 3 partidas no suíço) aparece em texto, e a variação tem ícone + texto.
    await expect(section.getByText('Provisório').first()).toBeVisible();
    await expect(section.getByText(/pontos de rating/).first()).toBeAttached();

    await section.getByRole('button', { name: 'Squads' }).click();
    await expect(section.getByRole('button', { name: 'Squads' })).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByRole('heading', { name: 'Nenhum squad jogou nesta temporada ainda' })).toBeVisible();

    // O histórico geral continua na mesma página.
    await expect(page.getByRole('heading', { level: 2, name: 'Ranking de 8 Ball Pool' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver as ligas semanais' })).toHaveAttribute('href', '/ligas');
    await expectNoHorizontalScroll(page);
  });

  test('perfil público mostra o rating da temporada e a evolução', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const ranking = await apiCall<{ entries: { name: string; rating: number; position: number }[] }>(page, 'GET', '/games/8-ball-pool/season-ranking');
    const top = ranking.data.entries[0];
    expect(top).toBeDefined();
    await page.goto(`/u/${top?.name}`);
    const section = page.getByRole('region', { name: 'Rating da temporada' });
    await expect(section).toBeVisible();
    const card = section.getByRole('article', { name: 'Rating em 8 Ball Pool' });
    await expect(card.getByText(String(top?.rating), { exact: true }).first()).toBeVisible();
    await expect(card.getByText('de rating', { exact: true })).toBeVisible();
    await expect(card.getByRole('definition').first()).toHaveText('1º');
    await card.getByText(/Últimas partidas \(3 na temporada\)/).click();
    await expect(card.getByRole('listitem')).toHaveCount(3);
    await expect(card.getByRole('link', { name: 'Ver a tabela da temporada' })).toHaveAttribute('href', '/ranking?jogo=8-ball-pool');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('ligas semanais', () => {
  test('página pública da liga: regra, tabela pela colocação final e campeonatos', async ({ page }) => {
    await page.goto('/ligas');
    await waitForApp(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Ligas semanais' })).toBeVisible();
    await page.getByRole('link', { name: 'Circuito 8 Ball Pool' }).click();
    await expect(page).toHaveURL(/\/ligas\/circuito-8-ball-pool$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Circuito 8 Ball Pool' })).toBeVisible();
    await expect(page.getByText('1º 25 · 2º 18 · 3º 15', { exact: false })).toBeVisible();
    const caption = 'Tabela da Circuito 8 Ball Pool';
    if (!isMobile(page)) {
      const table = page.getByRole('table', { name: caption });
      await expect(table.getByRole('row')).toHaveCount(9);
      await expect(table.getByRole('row').nth(1)).toContainText('26');
    } else {
      await expect(page.getByRole('list', { name: caption }).getByRole('listitem')).toHaveCount(8);
    }
    const tournaments = page.getByRole('region', { name: 'Campeonatos da liga' });
    await expect(tournaments.getByRole('link', { name: 'Open 8 Ball Pool' })).toHaveAttribute('href', '/c/open-8-ball-pool');
    await expect(tournaments.getByText('Já conta pontos')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto('/ligas/nao-existe');
    await expect(page.getByRole('heading', { name: 'Liga não encontrada' })).toBeVisible();
  });

  test('organizador cria a liga, inclui e retira campeonato e apaga a liga', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/ligas');
    await expect(page.getByRole('heading', { level: 1, name: 'Minhas ligas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Você ainda não tem ligas' })).toBeVisible();
    await page.getByRole('link', { name: 'Criar liga' }).first().click();

    await expect(page.getByRole('heading', { level: 1, name: 'Criar liga' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByLabel('Nome da liga').fill('Liga das Quintas');
    await page.getByLabel('Jogo').selectOption({ label: 'Clash Royale' });
    // Regra inválida: a colocação de baixo não pode valer mais.
    await page.getByLabel('Pontos do 1º, 2º, 3º lugar…').fill('10, 20');
    await page.getByRole('button', { name: 'Criar liga' }).click();
    await expect(page.getByText('Uma colocação não pode valer mais do que a anterior')).toBeVisible();
    await page.getByLabel('Pontos do 1º, 2º, 3º lugar…').fill('10, 7, 5, 3');
    await expect(page.getByText('Prévia: 1º 10 · 2º 7 · 3º 5 · 4º 3 · +1 por participar')).toBeVisible();
    await page.getByRole('button', { name: 'Criar liga' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Liga das Quintas' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'A liga ainda não tem campeonatos' })).toBeVisible();
    const include = page.getByLabel('Incluir campeonato');
    const value = await include.locator('option', { hasText: 'Liga Semanal Clash Royale 1v1' }).getAttribute('value');
    await include.selectOption(value ?? '');
    await page.getByRole('button', { name: 'Incluir', exact: true }).click();
    const list = page.getByRole('region', { name: 'Campeonatos da liga' });
    await expect(list.getByRole('link', { name: 'Liga Semanal Clash Royale 1v1' })).toBeVisible();
    await expect(list.getByText('Conta pontos quando terminar')).toBeVisible();
    await expectNoHorizontalScroll(page);

    await expect(page.getByRole('link', { name: 'Ver página pública' })).toHaveAttribute('href', '/ligas/liga-das-quintas');
    await list.getByRole('button', { name: 'Retirar Liga Semanal Clash Royale 1v1 da liga' }).click();
    await expect(page.getByRole('heading', { name: 'A liga ainda não tem campeonatos' })).toBeVisible();

    await page.getByRole('button', { name: 'Apagar liga' }).click();
    const dialog = page.getByRole('dialog', { name: 'Apagar a liga?' });
    await dialog.getByRole('textbox').fill('Liga das Quintas');
    await dialog.getByRole('button', { name: 'Apagar liga' }).click();
    await expect(page).toHaveURL(/\/organizador\/ligas$/);
    await expect(page.getByRole('heading', { name: 'Você ainda não tem ligas' })).toBeVisible();
  });

  test('o link "Ligas" está no menu da área do organizador', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await page.goto('/organizador');
    if (isMobile(page)) await page.getByRole('button', { name: /menu/i }).first().click();
    await page.getByRole('link', { name: 'Ligas' }).locator('visible=true').first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Minhas ligas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Circuito 8 Ball Pool' })).toHaveAttribute('href', '/organizador/ligas/lg_circuito_8ball');
  });
});

test.describe('temporadas no painel do Admin', () => {
  test('cria, recusa sobreposição e apaga uma temporada', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin/temporadas');
    await expect(page.getByRole('heading', { level: 1, name: 'Temporadas do ranking' })).toBeVisible();
    await page.getByRole('button', { name: 'Nova temporada' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova temporada' });
    await dialog.getByLabel('Jogo').selectOption({ label: 'eFootball' });
    await dialog.getByLabel('Nome').fill('Temporada 2031');
    await dialog.getByLabel('Início').fill('2031-01-01T00:00');
    await dialog.getByLabel('Fim').fill('2032-01-01T00:00');
    await dialog.getByRole('button', { name: 'Criar temporada' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Temporada 2031', { exact: true }).locator('visible=true')).toBeVisible();

    // A mesma janela de novo, no mesmo jogo: recusada.
    await page.getByRole('button', { name: 'Nova temporada' }).click();
    await dialog.getByLabel('Jogo').selectOption({ label: 'eFootball' });
    await dialog.getByLabel('Nome').fill('Repetida');
    await dialog.getByLabel('Início').fill('2031-06-01T00:00');
    await dialog.getByLabel('Fim').fill('2031-12-01T00:00');
    await dialog.getByRole('button', { name: 'Criar temporada' }).click();
    await expect(dialog.getByText(/cruzam com a temporada "Temporada 2031"/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Apagar Temporada 2031 de eFootball' }).locator('visible=true').click();
    const confirm = page.getByRole('dialog', { name: 'Apagar a temporada?' });
    await confirm.getByRole('textbox').fill('Temporada 2031');
    await confirm.getByRole('button', { name: 'Apagar temporada' }).click();
    await expect(page.getByText('Temporada 2031', { exact: true })).toHaveCount(0);
  });
});
