import type { Page } from '@playwright/test';
import { expect, loginAs, mid, test, waitForApp } from './fixtures';

/**
 * Inscrito avulso e elenco sem conta (RN-18), em 1440 px e 360 px.
 * Seed: Arena Contra Squad 4v4 (Free Fire 4x4: 4 titulares + 1 reserva), do Diego, com inscrições abertas.
 */
test.describe.configure({ timeout: 120_000 });

const ARENA = `/organizador/campeonatos/${mid('tn_contra_squad')}?aba=inscricoes`;
const registrationRow = (page: Page, name: string) => page.locator('tbody tr:visible, ul[aria-label^="Inscrições de"] > li:visible').filter({ hasText: name });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openArena(page: Page): Promise<void> {
  await loginAs(page, 'u_diego');
  await page.goto(ARENA);
  await waitForApp(page);
}

test.describe('inscrito avulso e elenco sem conta', () => {
  test('organizador cadastra um squad à mão, com o elenco, e depois corrige e completa pelo botão Elenco', async ({ page }) => {
    await openArena(page);
    await page.getByRole('button', { name: 'Adicionar inscrito' }).click();
    const form = page.getByRole('dialog', { name: 'Adicionar squad' });
    await expect(form.getByTestId('roster-slot')).toHaveCount(5);
    await form.getByLabel('Nome do squad').fill('Squad Manual');
    await form.getByLabel('Tag').fill('manu');
    for (const [index, name] of ['Ana', 'Bia', 'Caio'].entries()) {
      const slot = form.getByTestId('roster-slot').nth(index);
      await slot.getByLabel('Nome').fill(name);
      await slot.getByLabel('ID no jogo').fill(String(1001 + index));
    }
    await expectNoHorizontalScroll(page);
    await form.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByText('Squad Manual entrou no campeonato')).toBeVisible();
    await expect(form).toHaveCount(0);

    // Entra confirmado (mesmo com a aprovação manual ligada) e mostra quantos titulares já tem.
    const row = registrationRow(page, 'Squad Manual');
    await expect(row).toContainText('Confirmada');
    await expect(row).toContainText('3 de 4 (sem conta)');

    await row.getByRole('button', { name: 'Editar o elenco do Squad Manual' }).click();
    const dialog = page.getByRole('dialog', { name: 'Elenco do Squad Manual' });
    const roster = dialog.getByRole('list', { name: 'Elenco do Squad Manual' });
    await expect(roster.getByRole('listitem')).toHaveCount(3);
    await expect(roster.getByRole('listitem').first()).toContainText('ID 1001');

    await dialog.getByLabel('Nome do jogador').fill('Dani');
    await dialog.getByRole('button', { name: 'Colocar no elenco' }).click();
    await expect(page.getByText('Dani entrou no elenco')).toBeVisible();
    await expect(roster.getByRole('listitem')).toHaveCount(4);
    // Titulares completos: o quinto entra como reserva.
    await expect(dialog.getByText('Os titulares já estão completos: o próximo jogador entra como reserva.')).toBeVisible();
    await dialog.getByLabel('Nome do jogador').fill('Banco');
    await dialog.getByRole('button', { name: 'Colocar no elenco' }).click();
    await expect(roster.getByRole('listitem').filter({ hasText: 'Banco' })).toContainText('Reserva');
    await expect(dialog.getByText(/O elenco está completo/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Corrigir os dados de Dani' }).click();
    await dialog.getByLabel('ID no jogo').fill('1004');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(roster.getByRole('listitem').filter({ hasText: 'Dani' })).toContainText('ID 1004');
    await dialog.getByRole('button', { name: 'Tirar Caio do elenco' }).click();
    await expect(roster.getByRole('listitem')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(registrationRow(page, 'Squad Manual')).toContainText('3 de 4 (sem conta)');
  });

  test('a planilha do Free Fire 4x4 traz o elenco; linha com titular a mais fica de fora com o motivo', async ({ page }) => {
    await openArena(page);
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar inscritos por CSV' });
    await expect(dialog.getByText(/4 titulares e 1 reserva/)).toBeVisible();

    const header = 'nome;tag;contato;id_no_jogo;jogador_1;id_jogador_1;jogador_2;id_jogador_2;jogador_3;id_jogador_3;jogador_4;id_jogador_4;jogador_5;reserva_1;id_reserva_1';
    const csv = [header, 'Squad Planilha;PLAN;;;P1;2001;P2;2002;P3;2003;P4;2004;;PR;2005', 'Squad Gordo;GORD;;;G1;;G2;;G3;;G4;;G5;;', 'Squad Sem Elenco;;;;;;;;;;;;;;'].join('\r\n');
    await dialog.getByTestId('csv-input').setInputFiles({ name: 'squads.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${csv}`, 'utf8') });

    await expect(dialog.getByText(/2 linhas prontas para importar e 1 com erro/)).toBeVisible();
    await expect(dialog.getByTestId('csv-line-2')).toContainText('P1, P2, P3, P4, PR (reserva)');
    await expect(dialog.getByTestId('csv-line-3')).toContainText('Este modo tem 4 titulares por squad: o elenco ficaria com 5.');
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: 'Importar 2 inscritos' }).click();
    await expect(dialog.getByTestId('import-result')).toContainText('Inscritos criados');
    await dialog.getByRole('button', { name: 'Concluir' }).click();

    await expect(registrationRow(page, 'Squad Planilha')).toContainText('4 de 4 (sem conta)');
    await expect(registrationRow(page, 'Squad Sem Elenco')).toContainText('0 de 4 (sem conta)');
    await registrationRow(page, 'Squad Planilha').getByRole('button', { name: 'Editar o elenco do Squad Planilha' }).click();
    await expect(page.getByRole('dialog', { name: 'Elenco do Squad Planilha' }).getByRole('list', { name: 'Elenco do Squad Planilha' }).getByRole('listitem')).toHaveCount(5);
  });
});
