/**
 * E2E das telas de F1 contra um preview com a **API real** (issue #81). Roda só com `E2E_API_REAL=1` e
 * `PLAYWRIGHT_BASE_URL` apontando para o preview; as contas de demonstração precisam da senha do seed
 * (`SEED_DEMO_PASSWORD`, repetida aqui em `E2E_DEMO_PASSWORD`).
 *
 * Fluxo: visitante vê a vitrine → organizadora (Camila) entra, cria e publica um campeonato → a página pública
 * vem renderizada no servidor com título e imagem de compartilhamento → participante (Bianca) se inscreve e
 * aparece na lista → organizadora cancela (o preview não acumula campeonatos ativos).
 */
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.E2E_DEMO_PASSWORD ?? '';
const stamp = Date.now().toString(36);

test.skip(!PASSWORD, 'Defina E2E_DEMO_PASSWORD (a mesma senha de SEED_DEMO_PASSWORD no preview).');
test.describe.configure({ mode: 'serial' });

async function login(page: Page, email: string) {
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/entrar/);
}

async function logout(page: Page) {
  await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' }));
  await page.context().clearCookies();
}

/** Chamada da API pelo próprio navegador (com cookie e `Origin`, como a tela faz). */
async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, data: text ? JSON.parse(text) : null };
    },
    { method, path, body },
  );
}

interface GameView {
  id: string;
  slug: string;
  requiredAccountFields: { key: string }[];
  modes: { id: string; teamSize: number; matchType: string }[];
  scoringModels: { id: string; matchType: string; isDefault: boolean; ownerId: string | null }[];
}

let slug = '';
let tournamentId = '';
let gameId = '';
let accountFields: { key: string }[] = [];
const name = `Copa E2E ${stamp}`;

test('visitante vê a vitrine de campeonatos vinda da API real', async ({ page }) => {
  const res = await page.request.get('/api/v1/tournaments?limit=5');
  expect(res.ok()).toBe(true);
  await page.goto('/campeonatos');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('organizadora cria e publica um campeonato', async ({ page }) => {
  await login(page, 'camila@novaarena.gg');
  const games = await api<GameView[]>(page, 'GET', '/games');
  // Um jogo de duelo 1x1 com modelo padrão (eFootball ou 8 Ball Pool no seed).
  const game = games.data.find((g) => g.modes.some((m) => m.teamSize === 1 && m.matchType === 'DUEL') && g.scoringModels.some((s) => s.matchType === 'DUEL' && s.ownerId === null));
  if (!game) throw new Error('Nenhum jogo de duelo no catálogo do preview (o seed rodou?)');
  const mode = game.modes.find((m) => m.teamSize === 1 && m.matchType === 'DUEL');
  const model = game.scoringModels.find((s) => s.matchType === 'DUEL' && s.ownerId === null && s.isDefault) ?? game.scoringModels.find((s) => s.matchType === 'DUEL' && s.ownerId === null);
  gameId = game.id;
  accountFields = game.requiredAccountFields;

  const day = 24 * 3600_000;
  const created = await api<{ id: string; slug: string }>(page, 'POST', '/tournaments', {
    name,
    description: '<p>Campeonato criado pelo teste automático.</p>',
    rules: '<p>Regulamento de teste.</p>',
    gameId: game.id,
    gameModeId: mode?.id,
    maxParticipants: 8,
    registrationClosesAt: new Date(Date.now() + 5 * day).toISOString(),
    startsAt: new Date(Date.now() + 6 * day).toISOString(),
    stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: model?.id, config: {}, qualification: null, tiebreakers: ['points', 'wins'], seeding: 'RANDOM' }],
  });
  expect(created.status, JSON.stringify(created.data)).toBe(201);
  tournamentId = created.data.id;
  const published = await api<{ status: string; slug: string }>(page, 'POST', `/tournaments/${tournamentId}/publish`);
  expect(published.status, JSON.stringify(published.data)).toBe(200);
  expect(published.data.status).toBe('REGISTRATION_OPEN');
  slug = published.data.slug;

  await page.goto(`/organizador/campeonatos/${tournamentId}`);
  await expect(page.getByText(name).first()).toBeVisible();
  await logout(page);
});

test('página pública vem do servidor com título, descrição e imagem de compartilhamento', async ({ page }) => {
  const html = await (await page.request.get(`/c/${slug}`)).text();
  expect(html).toContain(`<title>${name} · Nova Arena</title>`);
  expect(html).toMatch(/<meta property="og:image" content="[^"]*\/c\/[^"]+\/opengraph-image/);
  expect(html).toContain('"@type":"SportsEvent"');
  const image = await page.request.get(`/c/${slug}/opengraph-image`);
  expect(image.headers()['content-type']).toContain('image/png');
  await page.goto(`/c/${slug}`);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
});

test('participante se inscreve e aparece na lista', async ({ page }) => {
  await login(page, 'bianca@novaarena.gg');
  if (accountFields.length > 0) {
    const fields = Object.fromEntries(accountFields.map((f) => [f.key, '1234567890']));
    const saved = await api(page, 'PUT', `/me/game-accounts/${gameId}`, { fields });
    expect(saved.status, JSON.stringify(saved.data)).toBe(200);
  }
  const reg = await api<{ status: string }>(page, 'POST', `/tournaments/${tournamentId}/registrations`, { acceptRules: true });
  expect(reg.status, JSON.stringify(reg.data)).toBe(201);
  expect(reg.data.status).toBe('CONFIRMED');
  await page.goto(`/c/${slug}?aba=inscritos`);
  await expect(page.getByText('Bianca').first()).toBeVisible();
  await logout(page);
});

test.afterAll(async ({ browser }) => {
  if (!tournamentId) return;
  const page = await browser.newPage();
  await login(page, 'camila@novaarena.gg');
  await api(page, 'POST', `/tournaments/${tournamentId}/cancel`, { reason: 'Campeonato do teste automático' });
  await page.close();
});
