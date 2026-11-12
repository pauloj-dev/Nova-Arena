import { expect, loginAs, test, waitForApp } from './fixtures';

test.describe('base do app', () => {
  test('a API simulada responde e a sessão funciona', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const anonymous = await page.evaluate(() => fetch('/api/v1/me').then((r) => r.json()));
    expect(anonymous).toBeNull();

    await loginAs(page, 'u_bianca');
    const me = await page.evaluate(() => fetch('/api/v1/me').then((r) => r.json()));
    expect(me.nickname).toBe('Bianca');
    expect(me).not.toHaveProperty('password');
  });

  test('participante em /admin vê a página 403', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toBeVisible();
  });

  test('visitante em /organizador é levado para o login', async ({ page }) => {
    await page.goto('/organizador');
    await expect(page).toHaveURL(/\/entrar\?next=%2Forganizador/);
  });

  test('administradora abre a área de administração', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/admin');
    await expect(page.getByText('Administração', { exact: true }).first()).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Você não tem acesso a esta área' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 3 }).or(page.getByRole('heading', { level: 1 })).first()).toBeVisible();
  });

  test('não há rolagem horizontal', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
