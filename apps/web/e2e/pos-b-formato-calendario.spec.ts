/**
 * Pós-lançamento (issue 125): assistente de formato no passo Fases e exportação das partidas para o calendário (.ics).
 * Roda em 1440 px e 360 px (projetos do playwright.config).
 */
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, loginAs, test } from './fixtures';

const stepTitle = (page: Page) => page.getByTestId('wizard-step-title');
const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar', exact: true });

/** Sem violações WCAG 2.2 AA dentro do diálogo aberto. */
async function expectAccessibleDialog(page: Page) {
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('assistente de formato', () => {
  test('sugere formatos pelo nº de inscritos e tempo, e aplica o escolhido nas fases', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador/novo');
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    await page.getByLabel('Nome do campeonato').fill('Copa do Assistente');
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Jogo e modo');
    await page.getByRole('radio', { name: /Free Fire/ }).check();
    await page.getByRole('radio', { name: /^Squad/ }).check();
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Inscrições');
    await continuar(page).click();
    await expect(stepTitle(page)).toHaveText('Fases');

    await page.getByRole('button', { name: 'Sugerir formato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sugerir formato' });
    await expect(dialog.getByLabel(/Equipes inscritas/)).toHaveValue('48');
    await dialog.getByLabel('Tempo disponível').selectOption('120');
    const cards = dialog.getByTestId('format-suggestion');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);
    await expect(dialog.getByText(/Cerca de/).first()).toBeVisible();
    await expectAccessibleDialog(page);

    // Já há fases (a sugestão inicial): substituir pede confirmação.
    await dialog.getByRole('button', { name: 'Usar este formato: Grupos + final curta' }).click();
    const confirm = page.getByRole('dialog', { name: 'Substituir as fases?' });
    await confirm.getByRole('button', { name: 'Substituir fases' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('stage-card-0')).toContainText('Fase de grupos');
    await expect(page.getByTestId('stage-card-1')).toContainText('Grande Final');
    await expect(page.getByText('2 fases · configuração válida para as vagas do campeonato.')).toBeVisible();
    // Sem rolagem horizontal no celular.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('calendário (.ics)', () => {
  test('minhas partidas: assinar ou baixar o .ics em "Meus campeonatos"', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta/campeonatos');
    await page.getByRole('button', { name: 'Adicionar ao calendário' }).click();
    const dialog = page.getByRole('dialog', { name: 'Minhas partidas no calendário' });
    await expect(dialog.getByTestId('calendar-count')).toContainText('com horário marcado');
    await expect(dialog.getByRole('link', { name: 'Abrir no aplicativo de calendário' })).toHaveAttribute('href', /^webcal:\/\/.+\/api\/v1\/calendar\/u\/u_bianca\..+\.ics$/);
    await expect(dialog.getByLabel(/Endereço do calendário/)).toHaveValue(/^https?:\/\/.+\.ics$/);
    await expectAccessibleDialog(page);

    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Baixar arquivo .ics' }).click()]);
    expect(download.suggestedFilename()).toBe('minhas-partidas-nova-arena.ics');
    const path = await download.path();
    const content = await readFile(path as string, 'utf8');
    expect(content.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(content).toContain('BEGIN:VEVENT');
    expect(content).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('campeonato: botão na aba de partidas', async ({ page }) => {
    await page.goto('/c/liga-semanal-clash-royale?aba=partidas');
    await page.getByRole('button', { name: 'Adicionar ao calendário' }).click();
    const dialog = page.getByRole('dialog', { name: 'Partidas no calendário' });
    await expect(dialog.getByRole('link', { name: 'Abrir no aplicativo de calendário' })).toHaveAttribute('href', /\/api\/v1\/calendar\/t\/liga-semanal-clash-royale\.ics$/);
    const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Baixar arquivo .ics' }).click()]);
    expect(download.suggestedFilename()).toBe('liga-semanal-clash-royale.ics');
    const content = await readFile((await download.path()) as string, 'utf8');
    expect(content).toContain('X-WR-CALNAME:Liga Semanal Clash Royale 1v1');
  });
});
