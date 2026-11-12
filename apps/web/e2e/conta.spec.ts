/**
 * Conta e perfil (F1.4): cadastro, verificação de e-mail, login, recuperação de senha,
 * convites de papel (CT-03), minha conta, IDs de jogo, pedido de organizador e perfil público.
 */
import type { Page } from '@playwright/test';
import { expect as baseExpect, loginAs, test, waitForApp } from './fixtures';

// Folga para o servidor de desenvolvimento, que compila cada rota na primeira visita.
const expect = baseExpect.configure({ timeout: 20_000 });

const DB_KEY = 'nova-mock-db';

interface MeJson {
  nickname: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  bio: string | null;
  state: string | null;
  avatarUrl: string | null;
  gameAccounts: { gameId: string; fields: Record<string, string> }[];
}

/** Chama a API simulada de dentro da página (mesma sessão do navegador). */
async function apiCall<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    { method, path, body },
  );
}
const me = async (page: Page) => (await apiCall<MeJson | null>(page, 'GET', '/me')).data;

/** Lê uma coleção do banco simulado (fica no localStorage do navegador). */
async function readDb<T>(page: Page, collection: string): Promise<T[]> {
  return page.evaluate(({ key, collection }) => (JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown[]>)[collection] ?? [], { key: DB_KEY, collection }) as Promise<T[]>;
}

/** Altera o banco simulado direto no localStorage. Vale a partir da próxima carga completa de página. */
async function patchDb(page: Page, patch: { roleInvites?: Record<string, Record<string, unknown>> }): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/');
  await waitForApp(page);
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, DB_KEY);
  await page.evaluate(
    ({ key, patch }) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as { roleInvites: ({ token: string } & Record<string, unknown>)[] };
      for (const invite of db.roleInvites) Object.assign(invite, patch.roleInvites?.[invite.token] ?? {});
      localStorage.setItem(key, JSON.stringify(db));
    },
    { key: DB_KEY, patch },
  );
}

async function fillRegister(page: Page, data: { nickname: string; email: string; password: string; birthDate: string; accept?: boolean }) {
  await page.getByLabel('Apelido').fill(data.nickname);
  await page.getByLabel('E-mail').fill(data.email);
  await page.getByLabel('Senha', { exact: true }).fill(data.password);
  await page.getByLabel('Data de nascimento').fill(data.birthDate);
  if (data.accept !== false) await page.getByRole('checkbox', { name: /Li e aceito os Termos de Uso/ }).check();
}

async function registerNewAccount(page: Page, nickname = 'NovaJogadora', email = 'nova@exemplo.com', password = 'senha1234') {
  await page.goto('/cadastro');
  await waitForApp(page);
  await fillRegister(page, { nickname, email, password, birthDate: '2000-01-15' });
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${page.url()}`).toBeLessThanOrEqual(0);
}

test.describe('cadastro, verificação e login', () => {
  test('cadastro → verificação de e-mail → sair → entrar', async ({ page }) => {
    await registerNewAccount(page);
    await expect(page).toHaveURL(/\/verificar-email$/);
    await expect(page.getByText('nova@exemplo.com')).toBeVisible();
    expect((await me(page))?.emailVerified).toBe(false);

    // Protótipo: o "e-mail" aparece na tela, marcado como tal.
    await expect(page.getByText('Protótipo', { exact: false }).first()).toBeVisible();
    const link = page.getByRole('link', { name: 'Abrir link de verificação' });
    await expect(link).toHaveAttribute('href', /^\/verificar-email\?token=.+/);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();
    expect((await me(page))?.emailVerified).toBe(true);

    await page.getByRole('link', { name: 'Continuar' }).click();
    await expect(page).toHaveURL(/\/$/);

    // Sair pelo menu da conta.
    await page.getByRole('button', { name: 'Conta de NovaJogadora' }).click();
    await page.getByRole('menuitem', { name: 'Sair' }).click();
    await expect(page.getByRole('button', { name: 'Conta de NovaJogadora' })).toHaveCount(0);
    expect(await me(page)).toBeNull();

    // Entrar de novo com e-mail e senha.
    await page.goto('/entrar');
    await login(page, 'nova@exemplo.com', 'senha1234');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: 'Conta de NovaJogadora' })).toBeVisible();
    expect((await me(page))?.nickname).toBe('NovaJogadora');
  });

  test('o link de verificação só vale uma vez, e dá para reenviar', async ({ page }) => {
    await registerNewAccount(page);
    const href = await page.getByRole('link', { name: 'Abrir link de verificação' }).getAttribute('href');
    expect(href).toBeTruthy();

    // Reenviar gera um link novo (o protótipo mostra o novo).
    await page.getByRole('button', { name: 'Reenviar e-mail' }).click();
    await expect(page.getByText('E-mail reenviado')).toBeVisible();
    const newHref = await page.getByRole('link', { name: 'Abrir link de verificação' }).getAttribute('href');
    expect(newHref).not.toBe(href);

    await page.goto(newHref as string);
    await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();

    // Abrir o mesmo link de novo: erro claro, sem quebrar a conta.
    await page.goto(newHref as string);
    await expect(page.getByRole('heading', { level: 1, name: 'Não foi possível confirmar seu e-mail' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'inválido ou já foi usado' })).toBeVisible();
    expect((await me(page))?.emailVerified).toBe(true);
  });

  test('cadastro recusa menor de 16 anos, termos não aceitos e mostra a força da senha', async ({ page }) => {
    await page.goto('/cadastro');
    await waitForApp(page);
    const year = new Date().getFullYear() - 10;
    await fillRegister(page, { nickname: 'Novinho', email: 'novinho@exemplo.com', password: 'abc', birthDate: `${year}-01-01`, accept: false });
    await expect(page.getByText('Força da senha: fraca')).toBeVisible();
    await page.getByLabel('Senha', { exact: true }).fill('Um4-Senha_Bem.Longa!2026');
    await expect(page.getByText('Força da senha: forte')).toBeVisible();

    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByText('É preciso ter pelo menos 16 anos para se cadastrar')).toBeVisible();
    await expect(page.getByText('É preciso aceitar os Termos de Uso e a Política de Privacidade')).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);
    expect(await me(page)).toBeNull();
  });

  test('apelido e e-mail já usados são recusados no cadastro, com a mensagem no campo', async ({ page }) => {
    await page.goto('/cadastro');
    await waitForApp(page);
    await fillRegister(page, { nickname: 'bianca', email: 'outra@exemplo.com', password: 'senha1234', birthDate: '2000-01-15' });
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    const nickname = page.getByLabel('Apelido');
    await expect(nickname).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Este apelido já está em uso.')).toBeVisible();
    await expect(page).toHaveURL(/\/cadastro$/);

    await nickname.fill('ApelidoLivre');
    await page.getByLabel('E-mail').fill('BIANCA@novaarena.gg');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.getByLabel('E-mail')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Já existe uma conta com este e-mail.')).toBeVisible();
    expect(await me(page)).toBeNull();
  });

  test('senha errada mostra erro inline; `?next=` leva de volta para onde a pessoa ia', async ({ page }) => {
    await page.goto('/minha-conta');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fminha-conta/);
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();

    await login(page, 'bianca@novaarena.gg', 'senha-errada');
    await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos.' })).toBeVisible();
    await expect(page).toHaveURL(/\/entrar/);

    await login(page, 'bianca@novaarena.gg', 'arena1234');
    await expect(page).toHaveURL(/\/minha-conta$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
  });

  test('`?next=` para outro site é ignorado', async ({ page }) => {
    await page.goto('/entrar?next=https%3A%2F%2Fevil.example.com%2Froubo');
    await waitForApp(page);
    await login(page, 'bianca@novaarena.gg', 'arena1234');
    await expect(page).toHaveURL(/localhost:\d+\/$/);
  });

  test('botões Google e Discord entram como a conta de demonstração e avisam que é simulado', async ({ page }) => {
    await page.goto('/entrar');
    await waitForApp(page);
    await expect(page.getByRole('button', { name: 'Entrar com Discord' })).toBeVisible();
    const google = page.getByRole('button', { name: 'Entrar com Google' });
    await expect(google).toHaveAccessibleDescription(/Protótipo|simulado/i);
    await google.click();
    await expect(page).toHaveURL(/\/$/);
    expect((await me(page))?.nickname).toBe('Bianca');
  });
});

test.describe('recuperar senha', () => {
  test('pede o link, cria a senha nova e entra com ela', async ({ page }) => {
    await page.goto('/entrar');
    await waitForApp(page);
    await page.getByRole('link', { name: 'Esqueci a senha' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recuperar senha' })).toBeVisible();

    await page.getByLabel('E-mail').fill('bianca@novaarena.gg');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
    await expect(page.getByText('Protótipo', { exact: false }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Abrir link de redefinição' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Criar nova senha' })).toBeVisible();
    const resetUrl = page.url();

    // As duas senhas precisam ser iguais.
    await page.getByLabel('Nova senha', { exact: true }).fill('novaSenha2026');
    await page.getByLabel('Confirmar nova senha').fill('outraSenha2026');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Criar nova senha' })).toBeVisible();

    await page.getByLabel('Confirmar nova senha').fill('novaSenha2026');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Senha alterada' })).toBeVisible();

    await page.getByRole('link', { name: 'Entrar', exact: true }).click();
    await login(page, 'bianca@novaarena.gg', 'arena1234');
    await expect(page.getByRole('alert').filter({ hasText: 'E-mail ou senha incorretos.' })).toBeVisible();
    await login(page, 'bianca@novaarena.gg', 'novaSenha2026');
    await expect(page).toHaveURL(/\/$/);
    expect((await me(page))?.nickname).toBe('Bianca');

    // O link de redefinição também é de uso único.
    const reuse = await apiCall<{ code?: string }>(page, 'POST', '/auth/reset-password', { token: new URL(resetUrl).searchParams.get('token'), password: 'maisUma2026' });
    expect(reuse.status).toBe(400);
  });

  test('e-mail sem conta recebe a mesma resposta (não revela quem tem cadastro)', async ({ page }) => {
    await page.goto('/recuperar-senha');
    await waitForApp(page);
    await page.getByLabel('E-mail').fill('ninguem@exemplo.com');
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir link de redefinição' })).toHaveCount(0);
  });
});

test.describe('convites de papel (CT-03)', () => {
  test('convite válido de organizador concede o papel e leva para a área', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/convite/convite-organizador-valido');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite para ser organizador' })).toBeVisible();
    await expect(page.getByText('Ana convidou você para ser organizador da Nova Arena.')).toBeVisible();
    await expect(page.getByText(/Válido até .+ · \d{1,2}h/)).toBeVisible();

    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(/\/organizador$/);
    expect((await me(page))?.roles).toContain('ORGANIZER');
    const invites = await readDb<{ token: string; uses: number }>(page, 'roleInvites');
    expect(invites.find((i) => i.token === 'convite-organizador-valido')?.uses).toBe(2);
  });

  test('convite válido de administrador concede o papel e leva para /admin', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/convite/convite-admin-valido');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite para ser administrador' })).toBeVisible();
    await expect(page.getByText('Rafael convidou você para ser administrador da Nova Arena.')).toBeVisible();
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect((await me(page))?.roles).toContain('ADMIN');
  });

  for (const invite of [
    { token: 'convite-expirado', heading: 'Este convite expirou' },
    { token: 'convite-revogado', heading: 'Este convite foi cancelado' },
  ]) {
    test(`${invite.token}: mostra a mensagem, não tem botão de aceitar e não concede papel`, async ({ page }) => {
      await loginAs(page, 'u_bianca');
      await page.goto(`/convite/${invite.token}`);
      await expect(page.getByRole('heading', { level: 1, name: invite.heading })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Ir para o início' })).toBeVisible();

      // Mesmo chamando a API direto, o convite inválido responde 410 e nada muda.
      const accept = await apiCall(page, 'POST', `/role-invites/${invite.token}/accept`);
      expect(accept.status).toBe(410);
      const roles = (await me(page))?.roles ?? [];
      expect(roles).toEqual(['PARTICIPANT']);
      const invites = await readDb<{ token: string; uses: number }>(page, 'roleInvites');
      expect(invites.find((i) => i.token === invite.token)?.uses).toBe(0);
    });
  }

  test('convite sem usos restantes: mensagem clara e nenhum papel', async ({ page }) => {
    await patchDb(page, { roleInvites: { 'convite-admin-valido': { uses: 3 } } });
    await loginAs(page, 'u_bianca');
    await page.goto('/convite/convite-admin-valido');
    await expect(page.getByRole('heading', { level: 1, name: 'Este convite já foi usado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
    expect((await apiCall(page, 'POST', '/role-invites/convite-admin-valido/accept')).status).toBe(410);
    expect((await me(page))?.roles).toEqual(['PARTICIPANT']);
  });

  test('visitante precisa entrar e volta para o convite', async ({ page }) => {
    await page.goto('/convite/convite-organizador-valido');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite para ser organizador' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
    expect((await apiCall(page, 'POST', '/role-invites/convite-organizador-valido/accept')).status).toBe(401);

    await page.getByRole('link', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fconvite%2Fconvite-organizador-valido/);
    await login(page, 'lucas@novaarena.gg', 'arena1234');
    await expect(page).toHaveURL(/\/convite\/convite-organizador-valido$/);
    await page.getByRole('button', { name: 'Aceitar convite' }).click();
    await expect(page).toHaveURL(/\/organizador$/);
    expect((await me(page))?.roles).toContain('ORGANIZER');
  });

  test('conta sem e-mail verificado não aceita convite', async ({ page }) => {
    await registerNewAccount(page, 'SemVerificar', 'semverificar@exemplo.com');
    await page.goto('/convite/convite-organizador-valido');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite para ser organizador' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Confirmar meu e-mail' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
    expect((await apiCall(page, 'POST', '/role-invites/convite-organizador-valido/accept')).status).toBe(403);
    expect((await me(page))?.roles).toEqual(['PARTICIPANT']);
  });

  test('convite que não existe', async ({ page }) => {
    await page.goto('/convite/nao-existe');
    await expect(page.getByRole('heading', { level: 1, name: 'Convite não encontrado' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aceitar convite' })).toHaveCount(0);
  });
});

test.describe('minha conta', () => {
  test('editar perfil: bio, estado e redes ficam salvos', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    await expect(page.getByLabel('Apelido')).toHaveValue('Bianca');

    await page.getByLabel('Bio').fill('Jogo sinuca toda sexta e futebol no domingo.');
    await page.getByLabel('Estado').fill('RJ');
    await page.getByLabel('Discord').fill('bianca#1234');
    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(page.getByText('Perfil atualizado')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Bio')).toHaveValue('Jogo sinuca toda sexta e futebol no domingo.');
    await expect(page.getByLabel('Estado')).toHaveValue('RJ');
    await expect(page.getByLabel('Discord')).toHaveValue('bianca#1234');
    expect((await me(page))?.bio).toBe('Jogo sinuca toda sexta e futebol no domingo.');

    // O perfil público mostra a bio nova.
    await page.goto('/u/Bianca');
    await expect(page.getByText('Jogo sinuca toda sexta e futebol no domingo.')).toBeVisible();
  });

  test('apelido de outra pessoa é recusado com a mensagem no campo', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    const nickname = page.getByLabel('Apelido');
    await expect(nickname).toHaveValue('Bianca');
    await nickname.fill('lucas');
    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(nickname).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`#${await nickname.getAttribute('aria-describedby')}`)).toHaveText('Este apelido já está em uso. Escolha outro.');
    expect((await me(page))?.nickname).toBe('Bianca');

    // Um apelido livre passa, e o perfil público muda de endereço.
    await nickname.fill('BiancaPro');
    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(page.getByText('Perfil atualizado')).toBeVisible();
    expect((await me(page))?.nickname).toBe('BiancaPro');
    expect((await apiCall(page, 'GET', '/users/BiancaPro')).status).toBe(200);
    expect((await apiCall(page, 'GET', '/users/Bianca')).status).toBe(404);
  });

  test('ID de jogo: valida o formato, salva e remove', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 3, name: /Free Fire/ })).toBeVisible();
    expect((await me(page))?.gameAccounts.some((a) => a.gameId === 'g_freefire')).toBe(false);

    const playerId = page.getByLabel('ID Free Fire');
    await playerId.fill('abc');
    await page.getByLabel('Nick no jogo').fill('BiaFF');
    await page.getByRole('button', { name: 'Salvar ID de Free Fire' }).click();
    await expect(playerId).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Confira o formato de "ID Free Fire"')).toBeVisible();
    expect((await me(page))?.gameAccounts.some((a) => a.gameId === 'g_freefire')).toBe(false);

    await playerId.fill('1234567890');
    await page.getByRole('button', { name: 'Salvar ID de Free Fire' }).click();
    await expect(page.getByText('ID de Free Fire salvo')).toBeVisible();
    expect((await me(page))?.gameAccounts.find((a) => a.gameId === 'g_freefire')?.fields).toEqual({ playerId: '1234567890', nick: 'BiaFF' });

    await page.reload();
    await expect(page.getByLabel('ID Free Fire')).toHaveValue('1234567890');
    await page.getByRole('button', { name: 'Remover ID de Free Fire' }).click();
    await expect(page.getByText('ID de Free Fire removido')).toBeVisible();
    expect((await me(page))?.gameAccounts.some((a) => a.gameId === 'g_freefire')).toBe(false);

    // A API também recusa formato errado e jogo que não existe.
    expect((await apiCall(page, 'PUT', '/me/game-accounts/g_freefire', { fields: { playerId: 'x', nick: 'y' } })).status).toBe(400);
    expect((await apiCall(page, 'PUT', '/me/game-accounts/g_nao_existe', { fields: { a: 'b' } })).status).toBe(404);
  });

  test('avatar: recusa arquivo que não é imagem, recorta e salva a foto', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    const input = page.getByLabel('Foto do perfil');

    await input.setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('não sou uma imagem') });
    await expect(page.getByRole('alert').filter({ hasText: 'não é uma imagem' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Imagem de teste 600×400 gerada no próprio navegador.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 400;
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
      const gradient = ctx.createLinearGradient(0, 0, 600, 400);
      gradient.addColorStop(0, 'green');
      gradient.addColorStop(1, 'gold');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 600, 400);
      return canvas.toDataURL('image/png').split(',')[1] as string;
    });
    await input.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });

    const dialog = page.getByRole('dialog', { name: 'Recortar foto' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Zoom').focus();
    await page.keyboard.press('ArrowRight');
    await dialog.getByRole('button', { name: 'Mover a foto para a direita' }).click();
    await dialog.getByRole('button', { name: 'Usar esta foto' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('A nova foto ainda não foi salva')).toBeVisible();
    expect((await me(page))?.avatarUrl).toBeNull();

    await page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(page.getByText('Perfil atualizado')).toBeVisible();
    const avatar = (await me(page))?.avatarUrl ?? '';
    expect(avatar).toMatch(/^data:image\/jpeg;base64,/);
    // Data URL comprimido: ~200 KB de imagem viram no máximo ~270 mil caracteres em base64.
    expect(avatar.length).toBeLessThan(280_000);
  });

  test('pedido de organizador: valida o tamanho, envia e mostra o status', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 2, name: 'Quero ser organizador' })).toBeVisible();

    const why = page.getByLabel('Por que você quer organizar campeonatos?');
    await why.fill('Quero organizar.');
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(page.getByText('Conte um pouco mais (pelo menos 30 caracteres)')).toBeVisible();
    expect((await apiCall(page, 'GET', '/me/organizer-request')).data).toBeNull();

    await why.fill('Organizo campeonatos de sinuca no meu bairro há um ano e quero trazer a turma para a Nova Arena.');
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(page.getByText('Em análise')).toBeVisible();
    await expect(page.getByText(/Pedido enviado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enviar pedido' })).toHaveCount(0);

    // Continua lá depois de recarregar, e um segundo pedido é recusado.
    await page.reload();
    await expect(page.getByText('Em análise')).toBeVisible();
    const again = await apiCall(page, 'POST', '/me/organizer-request', { justification: 'Outro pedido com mais de trinta caracteres, só para testar.' });
    expect(again.status).toBe(409);
  });

  test('quem já é organizador não vê o formulário de pedido', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 2, name: 'IDs de jogo' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Quero ser organizador' })).toHaveCount(0);
    const post = await apiCall(page, 'POST', '/me/organizer-request', { justification: 'Já sou organizadora, mas vou tentar pedir de novo mesmo assim.' });
    expect(post.status).toBe(409);
  });

  test('navegação da conta e página de segurança', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    const nav = page.getByRole('navigation', { name: 'Minha conta' });
    await expect(nav.getByRole('link', { name: 'Conta', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Squads' })).toHaveAttribute('href', '/minha-conta/squads');
    await expect(nav.getByRole('link', { name: 'Campeonatos' })).toHaveAttribute('href', '/minha-conta/campeonatos');

    await nav.getByRole('link', { name: 'Segurança' }).click();
    await expect(page).toHaveURL(/\/minha-conta\/seguranca$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Segurança' })).toBeVisible();
    await expect(page.getByText('Verificação em duas etapas').first()).toBeVisible();
    await expect(page.getByText('Inativa', { exact: true })).toBeVisible();
    await expect(page.getByText('Em breve', { exact: false }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('administradora com 2FA vê a verificação em duas etapas como ativa', async ({ page }) => {
    await loginAs(page, 'u_ana');
    await page.goto('/minha-conta/seguranca');
    await expect(page.getByText('Ativa', { exact: true })).toBeVisible();
  });

  test('visitante em /minha-conta/seguranca vai para o login', async ({ page }) => {
    await page.goto('/minha-conta/seguranca');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fminha-conta%2Fseguranca/);
  });
});

test.describe('perfil público', () => {
  test('mostra apelido, selo e bio — e nunca e-mail nem IDs de jogo', async ({ page }) => {
    await page.goto('/u/Camila');
    await expect(page.getByRole('heading', { level: 1, name: 'Camila' })).toBeVisible();
    await expect(page.getByText('Organizador verificado')).toBeVisible();
    await expect(page.getByText('Organizo ligas semanais de Free Fire e Clash Royale.')).toBeVisible();
    await expect(page.getByText(/Na Nova Arena desde \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Histórico competitivo' })).toBeVisible();

    const text = await page.locator('body').innerText();
    expect(text).not.toContain('camila@novaarena.gg');
    expect(text).not.toContain('@novaarena.gg');

    // O contrato da API também não traz dado privado.
    const res = await apiCall<Record<string, unknown>>(page, 'GET', '/users/camila');
    expect(res.status).toBe(200);
    for (const secret of ['email', 'emailVerified', 'birthDate', 'gameAccounts', 'password', 'timezone', 'twoFactorEnabled', 'status']) {
      expect(res.data, `campo privado "${secret}" no perfil público`).not.toHaveProperty(secret);
    }
    expect(JSON.stringify(res.data)).not.toContain('novaarena.gg');
  });

  test('perfil que não existe mostra uma página amigável', async ({ page }) => {
    await page.goto('/u/ninguem-com-esse-nick');
    await expect(page.getByRole('heading', { level: 1, name: 'Perfil não encontrado' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver campeonatos' }).first()).toBeVisible();
  });

  test('a própria pessoa vê o atalho para editar', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/u/bianca');
    await expect(page.getByRole('heading', { level: 1, name: 'Bianca' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Editar perfil' })).toHaveAttribute('href', '/minha-conta');
  });
});

test.describe('sem rolagem horizontal (conta)', () => {
  for (const path of ['/entrar', '/cadastro', '/recuperar-senha', '/verificar-email', '/convite/convite-admin-valido', '/convite/convite-expirado', '/u/Camila']) {
    test(`visitante em ${path}`, async ({ page }) => {
      await page.goto(path);
      await waitForApp(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test('logada em /minha-conta', async ({ page }) => {
    await loginAs(page, 'u_bianca');
    await page.goto('/minha-conta');
    await expect(page.getByRole('heading', { level: 2, name: 'IDs de jogo' })).toBeVisible();
    await expect(page.getByLabel('ID Free Fire')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
