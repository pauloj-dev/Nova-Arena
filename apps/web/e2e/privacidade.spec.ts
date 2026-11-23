/**
 * LGPD (issue #115) e antifraude (issue #114) no navegador: aviso de cookies com a opção mais restritiva, baixar os
 * dados, excluir a conta (some do site) e a fila de alertas antifraude na moderação.
 */
import { expect as baseExpect, loginAs, test, waitForApp } from './fixtures';

const expect = baseExpect.configure({ timeout: 20_000 });

test.describe('aviso de cookies', () => {
  test('aparece para quem chega, "só o necessário" vem primeiro e a escolha fica guardada', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __NOVA_SHOW_CONSENT__: boolean }).__NOVA_SHOW_CONSENT__ = true;
    });
    await page.goto('/');
    await waitForApp(page);
    const banner = page.getByRole('region', { name: 'Cookies e medição de uso' });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button')).toHaveText(['Só o necessário', 'Aceitar medição']);
    await banner.getByRole('button', { name: 'Só o necessário' }).click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole('region', { name: 'Cookies e medição de uso' })).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nova-consent') ?? '{}').analytics)).toBe(false);
  });
});

test.describe('Minha conta → Privacidade', () => {
  test('baixa os dados em JSON e exclui a conta, que some do site', async ({ page }) => {
    await loginAs(page, 'u_p41');
    // Sem inscrição em campeonato aberto (senão a exclusão fica bloqueada, como na regra).
    await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('nova-mock-db') ?? '{}') as { registrations: { userId: string | null; members: { userId: string }[] }[] };
      db.registrations = db.registrations.filter((r) => r.userId !== 'u_p41' && !r.members.some((m) => m.userId === 'u_p41'));
      localStorage.setItem('nova-mock-db', JSON.stringify(db));
    });
    await page.goto('/minha-conta/privacidade');
    await waitForApp(page);
    await expect(page.getByRole('heading', { name: 'Privacidade', level: 1 })).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar meus dados' }).click();
    expect((await download).suggestedFilename()).toMatch(/^nova-arena-meus-dados-\d{4}-\d{2}-\d{2}\.json$/);

    const nickname = await page.evaluate(async () => ((await (await fetch('/api/v1/me')).json()) as { nickname: string }).nickname);
    await page.getByRole('button', { name: 'Excluir minha conta' }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir a conta para sempre?' });
    const confirm = dialog.getByRole('button', { name: 'Excluir para sempre' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Sua senha').fill('arena1234');
    await dialog.getByLabel('Digite EXCLUIR MINHA CONTA para confirmar').fill('excluir minha conta');
    await confirm.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Sua conta foi excluída')).toBeVisible();

    await page.goto(`/u/${nickname}`);
    await waitForApp(page);
    await expect(page.getByText(/não encontrad/i).first()).toBeVisible();
  });

  test('organizadora com campeonato em andamento vê o bloqueio e o botão fica desligado', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/minha-conta/privacidade');
    await waitForApp(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Você organiza campeonatos em andamento' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Excluir minha conta' })).toBeDisabled();
  });
});

test('moderação: aba de alertas antifraude com os alertas abertos', async ({ page }) => {
  await loginAs(page, 'u_ana');
  await page.goto('/admin/moderacao?aba=alertas');
  await waitForApp(page);
  const alerts = page.getByTestId('fraud-alert');
  await expect(alerts).toHaveCount(2);
  await expect(alerts.first()).toContainText(/contas entraram/);
  // Pelo teclado: no celular o botão do protótipo (fixo no rodapé) pode ficar por cima do cartão.
  await alerts.filter({ hasText: 'mesmo aparelho' }).getByRole('button', { name: 'Improcedente' }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Marcar alerta como improcedente' });
  await dialog.getByLabel('O que foi decidido').fill('Família dividindo o mesmo celular; contas legítimas.');
  await dialog.getByRole('button', { name: 'Fechar como improcedente' }).press('Enter');
  await expect(alerts).toHaveCount(1);
});
