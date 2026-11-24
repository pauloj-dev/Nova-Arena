import type { Page } from '@playwright/test';
import { expect, loginAs, mid, test, waitForApp, type DemoUser } from './fixtures';

/**
 * Elenco do squad (PRD §12.1, trava de elenco), em 1440 px e 360 px.
 * Seed: Copa Nova FF (squad 4 + 1 reserva, da Camila) com 12 squads confirmados — Squad Bravo (PedroZz4, JuliaGG5…)
 * e Squad Charlie entre eles; Lucas é capitão do Squad Alfa (KauePro1, ThiagoBR2, MarinaX3), fora da Copa; o link
 * de convite do Alfa é o código ALFA42.
 */
test.describe.configure({ timeout: 120_000 });

const COPA_FF = '/c/copa-nova-ff-squad';
const registrationRow = (page: Page, name: string) => page.locator('tbody tr:visible, ul[aria-label^="Inscrições de"] > li:visible').filter({ hasText: name });
const panel = (page: Page) => page.getByRole('region', { name: 'Inscrição', exact: true });

async function visitAs(page: Page, user: DemoUser, path: string): Promise<void> {
  await loginAs(page, user);
  await page.goto(path);
  await waitForApp(page);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Lucas inscreve o Squad Alfa na Copa Nova FF (fica aguardando os membros confirmarem). */
async function registerAlfa(page: Page): Promise<void> {
  await visitAs(page, 'u_lucas', COPA_FF);
  await panel(page).getByLabel('Squad que vai jogar').selectOption({ label: 'Squad Alfa [ALFA] · 4 jogadores' });
  await panel(page).getByRole('checkbox', { name: /Li e aceito o regulamento/ }).check();
  await panel(page).getByRole('button', { name: 'Inscrever squad' }).click();
  await expect(panel(page).getByText('Aguardando membros')).toBeVisible();
}

test.describe('elenco do squad', () => {
  test('organizadora remaneja um jogador de um squad para outro', async ({ page }) => {
    await visitAs(page, 'u_camila', `/organizador/campeonatos/${mid('tn_copa_ff')}?aba=inscricoes`);
    await registrationRow(page, 'Squad Bravo').getByRole('button', { name: 'Editar o elenco do Squad Bravo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Elenco do Squad Bravo' });
    await expect(dialog.getByRole('list', { name: 'Elenco do Squad Bravo' }).getByRole('listitem')).toHaveCount(4);
    await dialog.getByRole('button', { name: 'Mover JuliaGG5 para outro squad' }).click();
    await dialog.getByRole('combobox', { name: 'Mover JuliaGG5 para' }).selectOption({ label: 'Squad Charlie [CHAR]' });
    await dialog.getByRole('button', { name: 'Mover jogador' }).click();
    await expect(page.getByText('JuliaGG5 foi para o Squad Charlie')).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Elenco do Squad Bravo' }).getByRole('listitem')).toHaveCount(3);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // O Squad Charlie ganhou o jogador (como reserva: os 4 titulares já estavam lá).
    await registrationRow(page, 'Squad Charlie').getByRole('button', { name: 'Editar o elenco do Squad Charlie' }).click();
    const charlie = page.getByRole('dialog', { name: 'Elenco do Squad Charlie' }).getByRole('list', { name: 'Elenco do Squad Charlie' });
    await expect(charlie.getByRole('listitem').filter({ hasText: 'JuliaGG5' })).toContainText('Reserva');
  });

  test('capitão tira um membro do elenco e escala de novo, até a trava de elenco', async ({ page }) => {
    await registerAlfa(page);
    await expect(panel(page).getByText('O capitão pode trocar o elenco até o campeonato começar.')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Tirar MarinaX3 do elenco' }).click();
    await expect(page.getByText('MarinaX3 saiu do elenco')).toBeVisible();
    const lineup = panel(page).getByRole('list', { name: 'Elenco do Squad Alfa' });
    await expect(lineup.getByRole('listitem')).toHaveCount(3);

    await panel(page).getByRole('button', { name: 'Escalar MarinaX3' }).click();
    await expect(page.getByText('MarinaX3 entrou no elenco')).toBeVisible();
    await expect(lineup.getByRole('listitem').filter({ hasText: 'MarinaX3' })).toContainText('Falta confirmar');
    await expectNoHorizontalScroll(page);

    // Escalado, ele vê o pedido de confirmação em destaque na página do campeonato.
    await visitAs(page, 'u_p03', COPA_FF);
    await expect(panel(page).getByTestId('confirm-participation').getByRole('button', { name: 'Confirmar participação' })).toBeVisible();
  });

  test('quem entra no squad pelo link entra no elenco do campeonato que esperava jogadores', async ({ page }) => {
    await registerAlfa(page);
    // KauePro1 recusa: o Alfa fica com um lugar no elenco.
    await visitAs(page, 'u_p01', COPA_FF);
    await panel(page).getByRole('button', { name: 'Recusar' }).click();
    await expect(page.getByText('Você recusou a participação')).toBeVisible();

    // Um jogador sem squad nesta Copa abre o link do Alfa e aceita.
    await visitAs(page, 'u_p55', '/squads/convite/ALFA42');
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    const joined = page.getByTestId('joined-rosters');
    await expect(joined).toContainText('Você entrou no elenco do Squad Alfa em Copa Nova FF — Squad. Sua participação já está confirmada.');
    await expectNoHorizontalScroll(page);
    await joined.getByRole('link', { name: 'Ver campeonato' }).click();
    await expect(page).toHaveURL(new RegExp(`${COPA_FF}$`));
    await waitForApp(page);
    await expect(panel(page).getByRole('list', { name: 'Elenco do Squad Alfa' }).getByRole('listitem').filter({ hasText: '(você)' })).toContainText('Confirmou');
  });
});
