import type { Page } from '@playwright/test';
import { expect, loginAs, test } from './fixtures';

/**
 * Fluxos que ficaram sem E2E em F2 (issue 155): próxima rodada do suíço, ordem manual da chave,
 * kills por jogador (MVP) e importação de resultados em vários lotes.
 * Cada teste ajusta o banco simulado (localStorage) para criar o cenário, como os demais E2E.
 */

const DB_KEY = 'nova-mock-db';
const COPA = 'tn_copa_ff';
const COPA_S1 = 'tn_copa_ff_s1';
const EF = 'tn_efootball';
const EF_S1 = 'tn_efootball_s1';

interface ApiMatch {
  id: string;
  kind: 'DUEL' | 'LOBBY';
  round: number;
  status: string;
  groupName: string | null;
  roundLabel: string;
  waitingPrevious: boolean;
  participants: { registrationId: string | null; name: string }[];
}
interface ApiBracket {
  state: string;
  seeding: string | null;
  complete: boolean;
  entrants: { registrationId: string; name: string; seed: number }[];
  matches: ApiMatch[];
}

async function api<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ path: p, init: i }) => {
      const res = await fetch(`/api/v1${p}`, {
        method: i?.method ?? 'GET',
        headers: i?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: i?.body === undefined ? undefined : JSON.stringify(i.body),
      });
      const text = await res.text();
      return { status: res.status, data: (text ? JSON.parse(text) : null) as never };
    },
    { path, init },
  );
}

async function ok<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await api<T>(page, path, init);
  expect(res.status, `${init?.method ?? 'GET'} ${path} → ${JSON.stringify(res.data)}`).toBeLessThan(300);
  return res.data;
}

const bracketOf = (page: Page, stageId: string) => ok<ApiBracket>(page, `/stages/${stageId}/bracket`);
const manage = (page: Page, id: string, tab: string) => page.goto(`/organizador/campeonatos/${id}?aba=${tab}`);

/** Muda uma fase direto no banco simulado. Vale a partir da próxima carga de página. */
async function patchStage(page: Page, stageId: string, patch: { format?: string; config?: Record<string, unknown>; qualification?: unknown }): Promise<void> {
  await page.waitForFunction((key) => localStorage.getItem(key) !== null, DB_KEY);
  await page.evaluate(
    ({ key, id, change }) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}') as { tournaments: { stages: { id: string; format: string; config: Record<string, unknown>; qualification: unknown }[] }[] };
      for (const t of db.tournaments) {
        const stage = t.stages.find((s) => s.id === id);
        if (!stage) continue;
        if (change.format) stage.format = change.format;
        if (change.config) stage.config = { ...stage.config, ...change.config };
        if (change.qualification !== undefined) stage.qualification = change.qualification;
      }
      localStorage.setItem(key, JSON.stringify(db));
    },
    { key: DB_KEY, id: stageId, change: patch },
  );
  await page.reload();
}

/** Joga os duelos prontos: a primeira vaga vence por 2 a 0. */
async function playReadyDuels(page: Page, stageId: string): Promise<number> {
  const bracket = await bracketOf(page, stageId);
  const ready = bracket.matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious);
  for (const m of ready) {
    await ok(page, `/matches/${m.id}/result`, { method: 'PUT', body: { entries: [{ registrationId: m.participants[0]?.registrationId, score: 2 }, { registrationId: m.participants[1]?.registrationId, score: 0 }] } });
  }
  return ready.length;
}

test.describe('suíço: gerar a próxima rodada', () => {
  test('com a rodada 1 toda lançada, o botão gera a rodada 2 e volta a ficar desativado', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await patchStage(page, EF_S1, { format: 'SWISS', config: { rounds: 3, bestOf: 1 }, qualification: { type: 'TOP_N_OVERALL', n: 4, repechage: 0 } });
    await ok(page, `/tournaments/${EF}/close-registration`, { method: 'POST' });
    await ok(page, `/stages/${EF_S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'e2e-suico' } });
    await ok(page, `/stages/${EF_S1}/confirm`, { method: 'POST' });

    await manage(page, EF, 'fases');
    const next = page.getByRole('button', { name: 'Gerar próxima rodada' });
    // Rodada 1 ainda em aberto: não dá para gerar a próxima.
    await expect(next).toBeDisabled();

    expect(await playReadyDuels(page, EF_S1)).toBe(4);
    await page.reload();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.getByText('Próxima rodada gerada')).toBeVisible();

    const bracket = await bracketOf(page, EF_S1);
    expect(bracket.matches.filter((m) => m.round === 2)).toHaveLength(4);
    // Ninguém repete o adversário da rodada 1.
    const pairs = (round: number) => bracket.matches.filter((m) => m.round === round).map((m) => m.participants.map((p) => p.registrationId).sort().join('|'));
    expect(pairs(2).some((p) => pairs(1).includes(p))).toBe(false);
    await expect(next).toBeDisabled();
  });
});

test.describe('chave com ordem manual', () => {
  test('o organizador põe o último inscrito como cabeça de chave 1 e a chave sai nessa ordem', async ({ page }) => {
    await loginAs(page, 'u_diego');
    await ok(page, `/tournaments/${EF}/close-registration`, { method: 'POST' });
    await manage(page, EF, 'fases');

    const form = page.getByRole('form', { name: 'Gerar chave' });
    await form.getByLabel('Como distribuir os participantes').selectOption('MANUAL');
    const order = form.getByRole('list', { name: 'Ordem dos participantes' });
    await expect(order.getByRole('listitem')).toHaveCount(8);
    const handle = await order.getByRole('listitem').last().getByRole('button', { name: /^Arrastar / }).getAttribute('aria-label');
    const last = (handle ?? '').replace(/^Arrastar /, '');
    expect(last).not.toBe('');

    // Só com os botões "Subir" (alternativa ao arrastar): do 8º ao 1º lugar.
    for (let i = 0; i < 7; i += 1) await form.getByRole('button', { name: `Subir ${last}` }).click();
    await expect(form.getByRole('button', { name: `Subir ${last}` })).toBeDisabled();
    await form.getByRole('button', { name: 'Gerar chave' }).click();

    const bracket = await bracketOf(page, EF_S1);
    expect(bracket.state).toBe('PREVIEW');
    expect(bracket.seeding).toBe('MANUAL');
    expect(bracket.entrants.find((e) => e.seed === 1)?.name).toBe(last);
  });
});

test.describe('kills por jogador (MVP)', () => {
  test('a queda pede as kills de cada jogador, confere a soma e o ranking de MVP aparece na tabela', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await patchStage(page, COPA_S1, { config: { killsPerPlayer: true } });
    await ok(page, `/tournaments/${COPA}/close-registration`, { method: 'POST' });
    await ok(page, `/stages/${COPA_S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'e2e-mvp' } });
    await ok(page, `/stages/${COPA_S1}/confirm`, { method: 'POST' });
    const drop = (await bracketOf(page, COPA_S1)).matches.find((m) => m.kind === 'LOBBY') as ApiMatch;
    const squads = drop.participants.map((p) => p.name);

    await manage(page, COPA, 'partidas');
    await page.locator(`[data-match-id="${drop.id}"]`).getByRole('button', { name: /Lançar resultado/ }).click();
    await expect(page.getByTestId('result-panel')).toBeVisible();

    const teamKills = [6, 3, 0];
    for (const [i, squad] of squads.entries()) {
      await page.getByRole('textbox', { name: `Colocação de ${squad}` }).fill(String(i + 1));
      await page.getByRole('textbox', { name: `Kills de ${squad}` }).fill(String(teamKills[i]));
      const players = page.getByRole('textbox', { name: new RegExp(`^Kills de .+ \\(${squad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)$`) });
      await expect(players).not.toHaveCount(0);
      const count = await players.count();
      // Soma errada primeiro: o campo aponta a diferença.
      await players.first().fill(String((teamKills[i] ?? 0) + 1));
      for (let j = 1; j < count; j += 1) await players.nth(j).fill('0');
      if (i === 0) await expect(page.getByTestId('drop-row-error').first()).toContainText(`A soma por jogador (${(teamKills[0] ?? 0) + 1}) precisa ser igual às kills da equipe (${teamKills[0]})`);
      await players.first().fill(String(teamKills[i]));
    }
    await expect(page.getByTestId('drop-row-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Validar queda' }).click();
    await expect(page.getByTestId('server-points')).toBeVisible();

    const standings = await ok<{ mvp: { nickname: string; teamName: string; kills: number }[] }>(page, `/stages/${COPA_S1}/standings`);
    expect(standings.mvp[0]).toMatchObject({ teamName: squads[0], kills: 6 });
  });
});

test.describe('importação de resultados em vários lotes', () => {
  test('52 quedas no CSV são enviadas em 2 lotes (50 + 2) e todas entram', async ({ page }) => {
    await loginAs(page, 'u_camila');
    // 4 grupos × 13 quedas = 52 quedas: passa do limite de 50 por chamada.
    await patchStage(page, COPA_S1, { config: { drops: 13 } });
    await ok(page, `/tournaments/${COPA}/close-registration`, { method: 'POST' });
    await ok(page, `/stages/${COPA_S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'e2e-lotes' } });
    await ok(page, `/stages/${COPA_S1}/confirm`, { method: 'POST' });
    const lobbies = (await bracketOf(page, COPA_S1)).matches.filter((m) => m.kind === 'LOBBY');
    expect(lobbies).toHaveLength(52);

    const lines = ['grupo;queda;squad;colocacao;kills'];
    for (const m of lobbies) {
      const drop = m.roundLabel.replace(/\D/g, '');
      m.participants.forEach((p, i) => lines.push(`${m.groupName};${drop};${p.name};${i + 1};${m.participants.length - i}`));
    }
    const batches: number[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/results/import')) batches.push((JSON.parse(req.postData() ?? '{}') as { results: unknown[] }).results.length);
    });

    await manage(page, COPA, 'partidas');
    await page.getByRole('button', { name: 'Importar resultados (CSV)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar resultados por CSV' });
    await dialog.getByTestId('results-csv-input').setInputFiles({ name: 'quedas.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\r\n'), 'utf8') });
    await expect(dialog.locator('[data-testid="results-match"][data-ready="true"]')).toHaveCount(52);
    await dialog.getByRole('button', { name: 'Importar 52 quedas' }).click();

    const report = dialog.getByTestId('results-report');
    await expect(report).toContainText('Quedas aplicadas');
    await expect(report.locator('dd').first()).toHaveText('52');
    expect(batches).toEqual([50, 2]);

    const after = await bracketOf(page, COPA_S1);
    expect(after.matches.filter((m) => m.kind === 'LOBBY' && m.status === 'VALIDATED')).toHaveLength(52);
  });
});
