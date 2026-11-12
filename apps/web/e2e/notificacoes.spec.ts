/**
 * Notificações (F2.10, issue #59), em 1440 px e 360 px: sino com contador, painel, lista completa,
 * chegada sem recarregar e preferências por tipo.
 * Seed: Bianca tem 6 notificações de demonstração (3 não lidas); Lucas tem 3 (2 não lidas).
 */
import type { Page } from '@playwright/test';
import { expect as baseExpect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

// Folga para o servidor de desenvolvimento, que compila cada rota na primeira visita.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 120_000 });

const DB_KEY = 'nova-mock-db';
const PRINT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');

async function visitAs(page: Page, user: DemoUser, path: string): Promise<void> {
  await loginAs(page, user);
  await page.goto(path);
  await waitForApp(page);
}

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

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `rolagem horizontal em ${page.url()}`).toBeLessThanOrEqual(0);
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notificações/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Notificações' });

test.describe('sino de notificações', () => {
  test('mostra o contador de não lidas e zera ao marcar todas como lidas', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/');
    await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');
    await expect(page.getByTestId('notification-count')).toHaveText('3');

    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    const items = panel(page).getByRole('listitem');
    await expect(items).toHaveCount(6);
    await expect(items.first()).toContainText('Check-in aberto');
    await expect(items.first()).toContainText('há 10 minutos');
    await expect(items.first()).toContainText('Não lida');
    await expect(items.nth(3)).not.toContainText('Não lida');
    await expectNoHorizontalScroll(page);

    await panel(page).getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await expect(bell(page)).toHaveAccessibleName('Notificações');
    await expect(page.getByTestId('notification-count')).toHaveCount(0);
    await expect(panel(page).getByText('Não lida')).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: 'Marcar todas como lidas' })).toBeDisabled();

    // Continua zerado depois de recarregar (ficou gravado).
    await page.reload();
    await waitForApp(page);
    await expect(bell(page)).toHaveAccessibleName('Notificações');
  });

  test('clicar em uma notificação marca como lida e leva ao link; "ver todas" abre a lista', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/');
    await bell(page).click();
    await panel(page).getByRole('button', { name: /Convite para o Squad Bravo/ }).click();
    await expect(page).toHaveURL(/\/minha-conta\/squads$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');

    await bell(page).click();
    await panel(page).getByRole('link', { name: 'Ver todas' }).click();
    await expect(page).toHaveURL(/\/notificacoes$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Notificações' })).toBeVisible();
  });

  test('uma notificação nova aparece sem recarregar a página', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/campeonatos');
    await expect(bell(page)).toHaveAccessibleName('Notificações, 3 não lidas');

    // O adversário da Bianca nas quartas envia o resultado pela API simulada: isso gera a notificação
    // "Confirme o resultado da sua partida" para ela. O banco e a sessão simulados são deste navegador,
    // então a troca de usuário acontece aqui mesmo, e a sessão volta para a Bianca antes de o evento
    // do canal dela ser entregue (como chegaria de outra aba, pelo mesmo BroadcastChannel do tempo real).
    const created = await page.evaluate(
      async ({ dbKey, print }) => {
        const call = async (method: string, path: string, body?: unknown) => {
          const res = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
          return { status: res.status, data: (await res.json().catch(() => null)) as unknown };
        };
        const matches = (await call('GET', '/tournaments/tn_liga_cr/matches?mine=1')).data as { id: string; status: string; participants: { registrationId: string | null }[] }[];
        const db = JSON.parse(localStorage.getItem(dbKey) ?? '{}') as { registrations: { id: string; userId: string | null; tournamentId: string }[] };
        const mine = db.registrations.find((r) => r.tournamentId === 'tn_liga_cr' && r.userId === 'u_bianca')?.id;
        const match = matches.find((m) => m.status !== 'VALIDATED' && m.participants.every((p) => p.registrationId));
        const theirs = match?.participants.find((p) => p.registrationId !== mine)?.registrationId;
        const opponent = db.registrations.find((r) => r.id === theirs)?.userId;
        if (!match || !mine || !theirs || !opponent) return { status: 0, id: null };

        await call('POST', '/auth/dev-login', { userId: opponent });
        const sent = await call('POST', `/matches/${match.id}/submissions`, {
          entries: [
            { registrationId: mine, score: 0 },
            { registrationId: theirs, score: 2 },
          ],
          evidenceUrls: [`data:image/png;base64,${print}`],
        });
        await call('POST', '/auth/dev-login', { userId: 'u_bianca' });
        const newest = ((await call('GET', '/notifications?limit=1')).data as { items: { id: string; title: string }[] }).items[0];
        new BroadcastChannel('nova-realtime').postMessage({ channel: 'user:u_bianca', event: { type: 'notification.created', id: newest?.id } });
        return { status: sent.status, id: newest?.id ?? null, title: newest?.title };
      },
      { dbKey: DB_KEY, print: PRINT },
    );
    expect(created.status).toBe(201);
    expect(created.title).toBe('Confirme o resultado da sua partida');

    // Sem recarregar: o contador sobe e a notificação está no painel.
    await expect(bell(page)).toHaveAccessibleName('Notificações, 4 não lidas');
    await expect(page.getByTestId('notification-count')).toHaveText('4');
    await bell(page).click();
    await expect(panel(page).getByRole('listitem').first()).toContainText('Confirme o resultado da sua partida');
    await expect(panel(page).getByRole('listitem').first()).toContainText('Não lida');
  });
});

test.describe('página de notificações', () => {
  test('lista completa, filtro de não lidas e marcar como lida ao abrir', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/notificacoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Notificações' })).toBeVisible();
    await expect(page.getByText('3 notificações não lidas.')).toBeVisible();
    const all = page.getByRole('list', { name: 'Todas as notificações' });
    await expect(all.getByRole('listitem')).toHaveCount(6);
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Não lidas', exact: true }).click();
    const unread = page.getByRole('list', { name: 'Notificações não lidas' });
    await expect(unread.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Não lidas', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await unread.getByRole('button', { name: /Quartas de final hoje/ }).click();
    await expect(page).toHaveURL(/\/c\/liga-semanal-clash-royale$/);
    await expect(bell(page)).toHaveAccessibleName('Notificações, 2 não lidas');

    await page.goto('/notificacoes');
    await waitForApp(page);
    await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await expect(page.getByText('Você está em dia: nenhuma notificação por ler.')).toBeVisible();
    await page.getByRole('button', { name: 'Não lidas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tudo lido' })).toBeVisible();
  });

  test('"carregar mais" traz as páginas seguintes', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/notificacoes');
    await expect(page.getByRole('list', { name: 'Todas as notificações' }).getByRole('listitem')).toHaveCount(6);
    // 14 notificações a mais, direto no banco simulado (vale a partir da próxima carga completa).
    await page.evaluate((key) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as { extra: { notifications: unknown[] } };
      const now = Date.now();
      for (let i = 1; i <= 14; i += 1) {
        db.extra.notifications.push({ id: `n_extra_${i}`, userId: 'u_bianca', type: 'ANNOUNCEMENT', title: `Comunicado ${i}`, body: 'Aviso da organização.', link: null, readAt: null, emailQueued: false, createdAt: new Date(now - i * 1000).toISOString() });
      }
      localStorage.setItem(key, JSON.stringify(db));
    }, DB_KEY);
    await page.goto('/notificacoes');
    await waitForApp(page);

    const items = page.getByRole('list', { name: 'Todas as notificações' }).getByRole('listitem');
    await expect(items).toHaveCount(10);
    await expect(page.getByText('17 notificações não lidas.')).toBeVisible();
    await page.getByRole('button', { name: 'Carregar mais' }).click();
    await expect(items).toHaveCount(20);
    await expect(page.getByRole('button', { name: 'Carregar mais' })).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notificações, 17 não lidas');
    await expectNoHorizontalScroll(page);
  });

  test('estado vazio para quem nunca recebeu notificação; visitante vai para o login', async ({ page }) => {
    await visitAs(page, 'u_p50', '/notificacoes');
    await expect(page.getByRole('heading', { name: 'Nenhuma notificação ainda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ver campeonatos abertos' })).toHaveAttribute('href', '/campeonatos?status=open');
    await expect(bell(page)).toHaveAccessibleName('Notificações');
    await expect(page.getByTestId('notification-count')).toHaveCount(0);

    await apiCall(page, 'POST', '/auth/logout');
    await page.goto('/notificacoes');
    await expect(page).toHaveURL(/\/entrar\?next=%2Fnotificacoes/);
  });
});

test.describe('preferências de notificação', () => {
  test('salvam por tipo e por canal; avisos da moderação ficam travados', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/minha-conta/notificacoes');
    await expect(page.getByRole('heading', { level: 1, name: 'Preferências de notificação' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Minha conta' }).getByRole('link', { name: 'Notificações' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('columnheader', { name: 'No site' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'E-mail' })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Check-in aberto/ })).toContainText('Quando abre a janela de check-in de uma partida sua.');
    await expect(page.getByRole('switch')).toHaveCount(22);
    await expectNoHorizontalScroll(page);

    const save = page.getByRole('button', { name: 'Salvar preferências' });
    await expect(save).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Avisos da moderação: no site' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Avisos da moderação: por e-mail' })).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Avisos da moderação: no site' })).toBeChecked();

    await page.getByRole('switch', { name: 'Comunicados: no site' }).click();
    await page.getByRole('switch', { name: 'Check-in aberto: por e-mail' }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText('Preferências salvas')).toBeVisible();
    await expect(save).toBeDisabled();

    // Ficou gravado: continua igual depois de recarregar, e é o que a API devolve.
    await page.reload();
    await waitForApp(page);
    await expect(page.getByRole('switch', { name: 'Comunicados: no site' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Comunicados: por e-mail' })).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Check-in aberto: por e-mail' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Check-in aberto: no site' })).toBeChecked();
    const prefs = (await apiCall<{ type: string; inApp: boolean; email: boolean }[]>(page, 'GET', '/me/notification-preferences')).data;
    expect(prefs.find((p) => p.type === 'ANNOUNCEMENT')).toEqual({ type: 'ANNOUNCEMENT', inApp: false, email: true });
    expect(prefs.find((p) => p.type === 'CHECKIN_OPEN')).toEqual({ type: 'CHECKIN_OPEN', inApp: true, email: false });
    expect(prefs.find((p) => p.type === 'SANCTION')).toEqual({ type: 'SANCTION', inApp: true, email: true });

    // "Desfazer alterações" volta ao que está salvo.
    await page.getByRole('switch', { name: 'Disputas: no site' }).click();
    await page.getByRole('button', { name: 'Desfazer alterações' }).click();
    await expect(page.getByRole('switch', { name: 'Disputas: no site' })).toBeChecked();
    await expect(save).toBeDisabled();
  });
});
