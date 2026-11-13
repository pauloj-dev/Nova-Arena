import { stat } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, loginAs, test, type DemoUser } from './fixtures';

/**
 * Operação do campeonato pelo organizador (F2.3, F2.4 e F2.6): chave com prévia e ajuste, agenda,
 * lançamento de resultados (duelo, queda BR e CSV), equipe do evento, comunicados, pausa,
 * desclassificação, encerramento com pódio, arte de resultado e onboarding.
 */

const COPA = 'tn_copa_ff';
const COPA_SLUG = 'copa-nova-ff-squad';
const S1 = 'tn_copa_ff_s1';
const S2 = 'tn_copa_ff_s2';
const S3 = 'tn_copa_ff_s3';
const LIGA = 'tn_liga_cr';
const LIGA_SLUG = 'liga-semanal-clash-royale';
const LIGA_S1 = 'tn_liga_cr_s1';

interface ApiMatch {
  id: string;
  kind: 'DUEL' | 'LOBBY';
  round: number;
  status: string;
  groupName: string | null;
  roundLabel: string;
  waitingPrevious: boolean;
  nextMatchId: string | null;
  participants: { registrationId: string | null; name: string }[];
}
interface ApiBracket {
  state: string;
  complete: boolean;
  groups: { id: string; name: string; registrationIds: string[] }[];
  matches: ApiMatch[];
}

/** Chama a API simulada de dentro da página (a sessão é a de quem está logado). */
async function api<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ path: p, init: i }) => {
      const res = await fetch(`/api/v1${p}`, {
        method: i?.method ?? 'GET',
        headers: i?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: i?.body === undefined ? undefined : JSON.stringify(i.body),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      return { status: res.status, data: data as never };
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
const isMobile = () => test.info().project.name === 'mobile-360';
const manage = (page: Page, id: string, tab?: string) => page.goto(`/organizador/campeonatos/${id}${tab ? `?aba=${tab}` : ''}`);
const card = (page: Page, matchId: string) => page.locator(`[data-match-id="${matchId}"]`);
/** Linha de uma inscrição: linha da tabela (desktop) ou cartão (celular) — só a que está visível. */
const registrationRow = (page: Page, name: string) => page.locator('tbody tr:visible, ul[aria-label^="Inscrições de"] > li:visible').filter({ hasText: name });

/** Nenhuma rolagem horizontal na página (em 360 px é o que quebra o uso no celular). */
async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'a página não pode rolar na horizontal').toBeLessThanOrEqual(1);
}

/** Apelido de um usuário de demonstração, lido do banco simulado. */
async function nicknameOf(page: Page, userId: DemoUser): Promise<string> {
  const nickname = await page.evaluate((id) => {
    const db = JSON.parse(localStorage.getItem('nova-mock-db') ?? '{}') as { users?: { id: string; nickname: string }[] };
    return db.users?.find((u) => u.id === id)?.nickname ?? '';
  }, userId);
  expect(nickname).not.toBe('');
  return nickname;
}

/** Fecha as inscrições, gera e confirma a chave da fase 1 da Copa, pela API. */
async function startCopa(page: Page, seed: string): Promise<ApiBracket> {
  await ok(page, `/tournaments/${COPA}/close-registration`, { method: 'POST' });
  await ok(page, `/stages/${S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed } });
  await ok(page, `/stages/${S1}/confirm`, { method: 'POST' });
  return bracketOf(page, S1);
}

/** Lança todas as quedas de uma fase BR pela API: a ordem das vagas vira a colocação. */
async function playLobbies(page: Page, stageId: string): Promise<void> {
  const bracket = await bracketOf(page, stageId);
  for (const m of bracket.matches.filter((x) => x.kind === 'LOBBY' && x.status !== 'VALIDATED')) {
    await ok(page, `/matches/${m.id}/result`, { method: 'PUT', body: { entries: m.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: m.participants.length - i })) } });
  }
}

/** Joga os duelos prontos até a fase terminar: a primeira vaga vence a série por 2 a 0. */
async function playDuels(page: Page, stageId: string): Promise<void> {
  for (let guard = 0; guard < 20; guard += 1) {
    const bracket = await bracketOf(page, stageId);
    const ready = bracket.matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious);
    if (ready.length === 0) return;
    for (const m of ready) {
      await ok(page, `/matches/${m.id}/result`, { method: 'PUT', body: { entries: [{ registrationId: m.participants[0]?.registrationId, score: 2 }, { registrationId: m.participants[1]?.registrationId, score: 0 }] } });
    }
  }
}

/** Quartas da Liga CR ainda sem resultado: a da Bianca e a outra. */
async function pendingQuarters(page: Page): Promise<{ hers: ApiMatch; other: ApiMatch }> {
  const bracket = await bracketOf(page, LIGA_S1);
  const pending = bracket.matches.filter((m) => m.round === 2 && !m.waitingPrevious && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status));
  const hers = pending.find((m) => m.participants.some((p) => p.name === 'Bianca'));
  const other = pending.find((m) => m !== hers);
  expect(hers, 'a quarta de final da Bianca deveria estar pendente').toBeDefined();
  expect(other, 'deveria haver outra quarta de final pendente').toBeDefined();
  return { hers: hers as ApiMatch, other: other as ApiMatch };
}

async function confirmBracket(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirmar chave' }).click();
  await page.getByRole('dialog', { name: 'Confirmar a chave?' }).getByRole('button', { name: 'Confirmar chave' }).click();
  await expect(page.getByRole('dialog', { name: 'Confirmar a chave?' })).toHaveCount(0);
}

test.describe('chave: gerar, ajustar e confirmar', () => {
  test('fecha as inscrições, gera a chave com seed, troca dois participantes e confirma', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await manage(page, COPA, 'fases');

    // Inscrições abertas: a tela explica e oferece fechar.
    await expect(page.getByText('As inscrições ainda estão abertas.')).toBeVisible();
    await page.getByRole('button', { name: 'Fechar inscrições' }).click();

    const form = page.getByRole('form', { name: 'Gerar chave' });
    await form.getByLabel(/Seed do sorteio/).fill('e2e-chave');
    await form.getByRole('button', { name: 'Gerar chave' }).click();

    // Prévia: só a organização vê, com a seed usada à mostra.
    await expect(page.getByText('Prévia da chave.')).toBeVisible();
    await expect(page.getByTestId('seed-info')).toContainText('e2e-chave');
    const containers = page.getByTestId('seeding-board').getByTestId('seed-container');
    await expect(containers).toHaveCount(4);
    await expectNoHorizontalScroll(page);

    const a = containers.nth(0).getByTestId('seed-slot').first();
    const b = containers.nth(1).getByTestId('seed-slot').first();
    const idA = await a.getAttribute('data-registration');
    const idB = await b.getAttribute('data-registration');
    expect(idA && idB && idA !== idB).toBeTruthy();

    if (isMobile()) {
      // Alternativa sem arrastar: seleciona um, depois o outro.
      await a.click();
      await expect(a).toHaveAttribute('aria-pressed', 'true');
      await b.click();
    } else {
      // Arrastar e soltar (dnd-kit).
      const from = await a.boundingBox();
      const to = await b.boundingBox();
      if (!from || !to) throw new Error('participantes sem posição na tela');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    await expect(containers.nth(0).locator(`[data-registration="${idB}"]`)).toBeVisible();
    await expect(containers.nth(1).locator(`[data-registration="${idA}"]`)).toBeVisible();
    const preview = await bracketOf(page, S1);
    expect(preview.state).toBe('PREVIEW');
    expect(preview.groups[0]?.registrationIds).toContain(idB);

    // A prévia não aparece para o público.
    await confirmBracket(page);
    await expect(page.getByTestId('stage-card').first()).toHaveAttribute('data-status', 'ACTIVE');
    await expect(page.getByTestId('stage-progress')).toContainText('Faltam 12 partidas');
    expect((await bracketOf(page, S1)).state).toBe('CONFIRMED');
    // Com partida pendente, o avanço fica desabilitado e diz quantas faltam.
    await expect(page.getByRole('button', { name: 'Avançar fase' })).toBeDisabled();
    await expect(page.getByText(/fica disponível quando as 12 partidas que faltam tiverem resultado/)).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('depois da primeira partida concluída a chave trava; só o Admin vê "Destravar"', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const bracket = await startCopa(page, 'e2e-trava');
    const first = bracket.matches[0] as ApiMatch;
    await ok(page, `/matches/${first.id}/result`, { method: 'PUT', body: { entries: first.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 1 })) } });

    await manage(page, COPA, 'fases');
    await expect(page.getByTestId('bracket-locked')).toContainText('Só um administrador');
    await expect(page.getByRole('button', { name: 'Gerar de novo' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Destravar' })).toHaveCount(0);

    await loginAs(page, 'u_ana');
    await manage(page, COPA, 'fases');
    await page.getByRole('button', { name: 'Destravar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Destravar a chave' });
    await dialog.getByLabel(/Motivo/).fill('Erro no sorteio dos grupos');
    await dialog.getByRole('button', { name: 'Destravar chave' }).click();
    await expect(page.getByTestId('bracket-locked')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ajustar posições' })).toBeVisible();
  });
});

test.describe('configuração das fases', () => {
  test('edita uma fase que ainda não começou e troca a pontuação da fase em andamento, com confirmação', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const bracket = await startCopa(page, 'e2e-config');
    const drop = bracket.matches[0] as ApiMatch;
    const [alfa] = drop.participants.map((p) => p.name) as [string];
    await ok(page, `/matches/${drop.id}/result`, { method: 'PUT', body: { entries: drop.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: [7, 9, 4][i] })) } });
    await manage(page, COPA, 'fases');
    await expect(page.getByTestId('stage-standings').locator('tr').filter({ hasText: alfa }).first()).toContainText('10');

    // Fase em andamento: só a pontuação muda, com confirmação e recálculo (RN-02).
    await page.getByRole('button', { name: 'Trocar pontuação' }).click();
    const scoring = page.getByRole('dialog', { name: /Pontuação de/ });
    await scoring.getByLabel('Modelo de pontuação').selectOption({ label: 'Free Fire · Liga (tabela de colocação)' });
    await expect(scoring.getByRole('button', { name: 'Trocar e recalcular' })).toBeDisabled();
    await scoring.getByRole('checkbox', { name: /Entendi que a tabela desta fase será recalculada/ }).click();
    await scoring.getByRole('button', { name: 'Trocar e recalcular' }).click();
    await expect(scoring).toHaveCount(0);
    // 1º lugar na tabela da liga (12) + 7 kills = 19.
    await expect(page.getByTestId('stage-standings').locator('tr').filter({ hasText: alfa }).first()).toContainText('19');

    // Fase que não começou: edita com o mesmo StageBuilder do assistente; a fase em andamento aparece travada.
    await page.getByRole('button', { name: 'Editar fases que não começaram' }).click();
    const editor = page.getByRole('dialog', { name: 'Editar fases' });
    await expect(editor.getByRole('list', { name: 'Fases do campeonato, em ordem' }).getByRole('listitem').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    const t = await ok<{ stages: Record<string, unknown>[] }>(page, `/organizer/tournaments/${COPA}`);
    expect(t.stages[0]?.scoringModelId).toBe('sm_ff_liga');
    await editor.getByRole('button', { name: 'Voltar' }).click();
    await expect(editor).toHaveCount(0);

    await page.getByRole('tab', { name: 'Auditoria' }).click();
    await expect(page.getByText('Pontuação da fase alterada').first()).toBeVisible();
  });
});

test.describe('lançamento de queda BR', () => {
  test('lança uma queda pelo formulário, só com o teclado, e a tabela da fase atualiza', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const bracket = await startCopa(page, 'e2e-queda');
    const drop = bracket.matches[0] as ApiMatch;
    const [alfa, bravo, charlie] = drop.participants.map((p) => p.name) as [string, string, string];

    await manage(page, COPA, 'partidas');
    await card(page, drop.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.getByTestId('dica-lancamento')).toBeVisible(); // dica da primeira vez
    await expect(page.getByTestId('drop-title')).toContainText('Queda 1 de 3');

    // O formulário abre na primeira célula: Tab e Enter andam célula a célula.
    const first = page.getByRole('textbox', { name: `Colocação de ${alfa}` });
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('inputmode', 'numeric');
    await page.keyboard.type('1');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: `Kills de ${alfa}` })).toBeFocused();
    await page.keyboard.type('7');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: `Colocação de ${bravo}` })).toBeFocused();
    await page.keyboard.type('1'); // colocação repetida: apontada no campo
    await expect(page.getByTestId('drop-row-error').first()).toContainText('Colocação 1 repetida');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('2');
    await expect(page.getByTestId('drop-row-error')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.type('9');
    await page.keyboard.press('Enter');
    await page.keyboard.type('3');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('textbox', { name: `Colocação de ${bravo}` })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Tab');
    await page.keyboard.type('4');

    // Prévia calculada pelo motor (CT-01): 10, 9 e 4.
    const points = page.getByTestId('drop-points');
    await expect(points.nth(0)).toContainText('10');
    await expect(points.nth(1)).toContainText('9');
    await expect(points.nth(2)).toContainText('4');
    await expectNoHorizontalScroll(page);

    await page.keyboard.press('Enter'); // última célula → botão "Validar queda"
    await expect(page.getByRole('button', { name: 'Validar queda' })).toBeFocused();
    await page.keyboard.press('Enter');

    // Pontos calculados pelo servidor.
    const saved = page.getByTestId('server-points');
    await expect(saved).toContainText('10 pts');
    await expect(saved.locator('li').filter({ hasText: bravo })).toContainText('9 pts');
    await expect(saved.locator('li').filter({ hasText: charlie })).toContainText('4 pts');

    await page.getByRole('button', { name: 'Voltar para as partidas' }).first().click();
    await expect(card(page, drop.id)).toHaveAttribute('data-status', 'VALIDATED');
    await page.getByRole('tab', { name: 'Fases e chave' }).click();
    const standings = page.getByTestId('stage-standings');
    await expect(standings.locator('tr').filter({ hasText: alfa }).first()).toContainText('10');
    await expect(standings.locator('tr').filter({ hasText: bravo }).first()).toContainText('9');
    await expect(page.getByTestId('stage-progress')).toContainText('Faltam 11 partidas');
    await expectNoHorizontalScroll(page);
  });

  test('o rascunho da queda sobrevive a recarregar a página', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const bracket = await startCopa(page, 'e2e-rascunho');
    const drop = bracket.matches[0] as ApiMatch;
    const name = drop.participants[0]?.name as string;
    await manage(page, COPA, 'partidas');
    await card(page, drop.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await page.getByRole('textbox', { name: `Colocação de ${name}` }).fill('2');
    await page.getByRole('textbox', { name: `Kills de ${name}` }).fill('6');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText(/Rascunho salvo neste aparelho/)).toBeVisible();

    await page.reload();
    await card(page, drop.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await expect(page.getByText(/Recuperamos o rascunho/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: `Colocação de ${name}` })).toHaveValue('2');
    await expect(page.getByRole('textbox', { name: `Kills de ${name}` })).toHaveValue('6');
  });

  test('usabilidade: uma queda de 12 squads é lançada só com o teclado em até 60 s', async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, 'u_camila');
    // Um grupo só: os 12 squads inscritos caem na mesma sala.
    const t = await ok<{ stages: Record<string, unknown>[] }>(page, `/organizer/tournaments/${COPA}`);
    const stages = t.stages.map((s, i) => ({
      id: s.id,
      name: s.name,
      format: s.format,
      scoringModelId: s.scoringModelId,
      config: i === 0 ? { ...(s.config as object), groupCount: 1 } : s.config,
      qualification: i === 0 ? { type: 'TOP_N_PER_GROUP', n: 8, repechage: 0 } : s.qualification,
      tiebreakers: s.tiebreakers,
      seeding: s.seeding,
    }));
    await ok(page, `/tournaments/${COPA}`, { method: 'PATCH', body: { maxParticipants: 12, stages } });
    const bracket = await startCopa(page, 'e2e-doze');
    const drop = bracket.matches[0] as ApiMatch;
    expect(drop.participants).toHaveLength(12);

    await manage(page, COPA, 'partidas');
    await card(page, drop.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await expect(page.getByRole('textbox', { name: `Colocação de ${drop.participants[0]?.name}` })).toBeFocused();
    await expect(page.getByTestId('drop-row')).toHaveCount(12);

    // Ritmo de uma pessoa digitando no teclado numérico: uma tecla a cada 250 ms.
    const KEY_MS = 250;
    const kills = [7, 9, 4, 3, 5, 2, 6, 1, 0, 8, 2, 1];
    let keys = 0;
    const key = async (k: string) => {
      await page.keyboard.press(k);
      keys += 1;
      await page.waitForTimeout(KEY_MS);
    };
    const digits = async (n: number) => {
      for (const d of String(n)) await key(d);
    };

    const startedAt = Date.now();
    for (let i = 0; i < 12; i += 1) {
      await digits(i + 1);
      await key('Tab');
      await digits(kills[i] as number);
      await key(i < 11 ? 'Tab' : 'Enter'); // na última célula, Enter leva ao botão
    }
    await expect(page.getByRole('button', { name: 'Validar queda' })).toBeFocused();
    await key('Enter');
    await expect(page.getByTestId('server-points')).toBeVisible();
    const elapsedMs = Date.now() - startedAt;

    const summary = `queda de 12 squads: ${(elapsedMs / 1000).toFixed(1)} s, ${keys} teclas (1 tecla a cada ${KEY_MS} ms), projeto ${test.info().project.name}`;
    test.info().annotations.push({ type: 'tempo-lancamento-queda', description: summary });
    console.log(`[usabilidade] ${summary}`);
    expect(elapsedMs).toBeLessThanOrEqual(60_000);
    // O campeão da queda: 1º com 7 kills = 10 pontos.
    await expect(page.getByTestId('server-points').locator('li').filter({ hasText: drop.participants[0]?.name as string })).toContainText('10 pts');
  });
});

test.describe('cenário completo reduzido do Free Fire (CT-06)', () => {
  test('grupos BR → mata-mata → final BR → encerrar com pódio e arquivar', async ({ page }) => {
    test.setTimeout(180_000);
    await loginAs(page, 'u_camila');
    await manage(page, COPA, 'fases');

    // Fase 1: fechar inscrições, gerar e confirmar pela tela.
    await page.getByRole('button', { name: 'Fechar inscrições' }).click();
    await page.getByRole('form', { name: 'Gerar chave' }).getByRole('button', { name: 'Gerar chave' }).click();
    await expect(page.getByTestId('seeding-board')).toBeVisible();
    await confirmBracket(page);
    await expect(page.getByRole('button', { name: 'Avançar fase' })).toBeDisabled();

    // O grosso dos resultados vai pela API; a tela acompanha pelo tempo real.
    await playLobbies(page, S1);
    await expect(page.getByTestId('stage-progress')).toContainText('Todas as partidas desta fase têm resultado.');

    // Avançar: prévia com 8 classificados (top 2 de cada grupo) e 4 eliminados.
    await page.getByRole('button', { name: 'Avançar fase' }).click();
    const advance = page.getByRole('dialog', { name: /Avançar de/ });
    await expect(advance.getByTestId('advance-qualified').locator('li')).toHaveCount(8);
    await expect(advance.getByRole('heading', { name: 'Eliminados (4)' })).toBeVisible();
    await expect(advance.getByTestId('advance-qualified')).toContainText('Grupo A');
    await advance.getByRole('button', { name: 'Confirmar avanço' }).click();

    // Fase 2 (mata-mata): a chave chega como prévia; confirma e joga.
    const stage2 = page.locator(`[data-testid="stage-card"][data-stage="${S2}"]`);
    await expect(stage2).toContainText('Fase atual');
    await expect(stage2.getByText('Prévia da chave.')).toBeVisible();
    await expect(page.locator(`[data-testid="stage-card"][data-stage="${S1}"]`)).toHaveAttribute('data-status', 'COMPLETED');
    await confirmBracket(page);
    await playDuels(page, S2);
    await expect(page.getByTestId('stage-progress')).toContainText('Todas as partidas desta fase têm resultado.');
    await page.getByRole('button', { name: 'Avançar fase' }).click();
    const toFinal = page.getByRole('dialog', { name: /Avançar de/ });
    await expect(toFinal.getByTestId('advance-qualified').locator('li')).toHaveCount(2);
    await toFinal.getByRole('button', { name: 'Confirmar avanço' }).click();

    // Fase 3 (final BR em 5 quedas).
    const stage3 = page.locator(`[data-testid="stage-card"][data-stage="${S3}"]`);
    await expect(stage3.getByText('Prévia da chave.')).toBeVisible();
    await confirmBracket(page);
    await expect(page.getByRole('button', { name: 'Encerrar campeonato' })).toBeDisabled();
    await playLobbies(page, S3);
    const finalBracket = await bracketOf(page, S3);
    const champion = finalBracket.matches[0]?.participants[0]?.name as string;

    // Encerrar: pódio sugerido pela última fase, editável.
    await page.getByRole('button', { name: 'Encerrar campeonato' }).click();
    const finish = page.getByRole('dialog', { name: 'Encerrar campeonato' });
    await expect(finish.getByLabel(/1º lugar/)).not.toHaveValue('');
    await expect(finish.getByLabel(/1º lugar/).locator('option:checked')).toContainText(champion);
    await finish.getByRole('button', { name: 'Encerrar com este pódio' }).click();

    // Tela de resultado: pódio e link para a arte.
    const closing = page.getByTestId('closing-card');
    await expect(closing.getByTestId('podium')).toContainText(champion);
    await expect(closing.getByTestId('podium')).toContainText('Campeão');
    await expect(page.getByRole('link', { name: 'Arte de resultado e certificados' })).toHaveAttribute('href', `/c/${COPA_SLUG}/arte`);
    expect((await ok<{ status: string }>(page, `/tournaments/${COPA}`)).status).toBe('FINISHED');
    await expectNoHorizontalScroll(page);

    // Só a transição válida aparece: finalizado → arquivar.
    await expect(page.getByRole('button', { name: 'Pausar campeonato' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Arquivar' }).click();
    await page.getByRole('dialog', { name: 'Arquivar o campeonato?' }).getByRole('button', { name: 'Arquivar campeonato' }).click();
    await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
    expect((await ok<{ status: string }>(page, `/tournaments/${COPA}`)).status).toBe('ARCHIVED');
  });
});

test.describe('Liga Semanal Clash Royale: duelos, agenda e W.O.', () => {
  test('lança uma MD3, o vencedor avança na chave, e a correção exige motivo', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const { hers } = await pendingQuarters(page);
    const rival = hers.participants.find((p) => p.name !== 'Bianca')?.name as string;
    expect(hers.nextMatchId).toBeTruthy();

    await manage(page, LIGA, 'partidas');
    await card(page, hers.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await expect(page.getByText(/Série MD3: vence quem fizer 2 jogos/)).toBeVisible();
    const bianca = page.getByRole('textbox', { name: 'Jogos vencidos de Bianca' });
    const other = page.getByRole('textbox', { name: `Jogos vencidos de ${rival}` });
    await bianca.fill('1');
    await other.fill('1');
    await expect(page.getByRole('alert').filter({ hasText: 'Ninguém chegou a 2 vitórias' })).toBeVisible();
    await bianca.fill('2');
    await expect(page.getByTestId('score-status')).toContainText('Bianca vence e avança na chave');
    await page.getByRole('button', { name: 'Salvar resultado' }).click();
    await expect(page.getByTestId('server-points')).toContainText('Bianca');
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: 'Voltar para as partidas' }).first().click();
    // O vencedor avançou: está na semifinal.
    await expect(card(page, hers.nextMatchId as string)).toContainText('Bianca');
    await expect(card(page, hers.id)).toHaveAttribute('data-status', 'VALIDATED');

    // Corrigir: sem motivo não salva; com motivo, o histórico registra e quem avança muda.
    await card(page, hers.id).getByRole('button', { name: /Corrigir resultado/ }).click();
    await expect(bianca).toHaveValue('2');
    await bianca.fill('0');
    await other.fill('2');
    await page.getByRole('button', { name: 'Salvar correção' }).click();
    await expect(page.getByText('Informe o motivo da correção')).toBeVisible();
    await page.getByLabel(/Motivo da correção/).fill('Print estava invertido');
    await page.getByRole('button', { name: 'Salvar correção' }).click();
    const history = page.getByTestId('result-history');
    await expect(history).toContainText('Resultado corrigido');
    await expect(history).toContainText('Motivo: Print estava invertido');
    await expect(history).toContainText('Resultado lançado');
    await page.getByRole('button', { name: 'Voltar para as partidas' }).first().click();
    await expect(card(page, hers.nextMatchId as string)).toContainText(rival);
    await expect(card(page, hers.nextMatchId as string)).not.toContainText('Bianca');

    // Na aba Fases e chave a chave mostra quem avançou.
    await page.getByRole('tab', { name: 'Fases e chave' }).click();
    await expect(page.getByTestId('bracket-view')).toBeVisible();
  });

  test('agenda uma partida com sala e senha (fuso explícito) e aplica W.O. com motivo', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const { other } = await pendingQuarters(page);
    const winner = other.participants[0]?.name as string;
    await manage(page, LIGA, 'partidas');

    await card(page, other.id).getByRole('button', { name: /^Agendar: / }).click();
    const dialog = page.getByRole('dialog', { name: /^Agendar: / });
    const when = `${new Date(Date.now() + 2 * 24 * 3600_000).toISOString().slice(0, 10)}T20:00`;
    await expect(dialog.getByText('(horário de Brasília)')).toBeVisible();
    await dialog.getByLabel(/Data e hora da partida/).fill(when);
    await dialog.getByLabel('Código da sala').fill('SALA-E2E');
    await dialog.getByLabel('Senha da sala').fill('9988');
    await expect(dialog.getByTestId('lobby-reveal')).toContainText('Só quem está nesta partida vê a sala');
    await dialog.getByRole('button', { name: 'Salvar agenda' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, other.id)).toContainText('20h');
    expect((await ok<{ code: string; password: string }>(page, `/matches/${other.id}/lobby`)).code).toBe('SALA-E2E');
    // O código nunca vai na partida em si.
    expect(JSON.stringify(await ok(page, `/matches/${other.id}`))).not.toContain('SALA-E2E');

    // Iniciar manualmente e voltar para agendada.
    await card(page, other.id).getByRole('button', { name: /^Iniciar partida/ }).click();
    await expect(card(page, other.id)).toHaveAttribute('data-status', 'LIVE');
    await card(page, other.id).getByRole('button', { name: /^Voltar para agendada/ }).click();
    await expect(card(page, other.id)).not.toHaveAttribute('data-status', 'LIVE');

    // W.O. com motivo.
    await card(page, other.id).getByRole('button', { name: /^Aplicar W\.O\./ }).click();
    const wo = page.getByRole('dialog', { name: /^Aplicar W\.O\./ });
    await wo.getByRole('button', { name: 'Aplicar W.O.' }).click();
    await expect(wo.getByText('Escolha quem vence')).toBeVisible();
    await wo.getByLabel(/Quem vence por W\.O\./).selectOption({ label: winner });
    await wo.getByLabel(/Motivo/).fill('Adversário não compareceu');
    await wo.getByRole('button', { name: 'Aplicar W.O.' }).click();
    await expect(card(page, other.id)).toHaveAttribute('data-status', 'WALKOVER');
    await expect(card(page, other.nextMatchId as string)).toContainText(winner);
    await expectNoHorizontalScroll(page);
  });

  test('agenda a rodada inteira, com intervalo entre as partidas', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const { hers, other } = await pendingQuarters(page);
    await manage(page, LIGA, 'partidas');
    await page.getByRole('button', { name: 'Agendar rodada: Quartas de final' }).click();
    const dialog = page.getByRole('dialog', { name: /^Agendar rodada/ });
    await expect(dialog).toContainText('2 partidas pendentes');
    await dialog.getByRole('button', { name: 'Agendar rodada' }).click();
    await expect(dialog.getByText('Informe a data e a hora da primeira partida')).toBeVisible();
    await dialog.getByLabel(/Primeira partida/).fill(`${new Date(Date.now() + 3 * 24 * 3600_000).toISOString().slice(0, 10)}T19:00`);
    await dialog.getByLabel(/Intervalo entre as partidas/).fill('45');
    await dialog.getByRole('button', { name: 'Agendar rodada' }).click();
    await expect(dialog).toHaveCount(0);
    const times = [await ok<{ scheduledAt: string }>(page, `/matches/${hers.id}`), await ok<{ scheduledAt: string }>(page, `/matches/${other.id}`)].map((m) => new Date(m.scheduledAt).getTime()).sort((x, y) => x - y);
    expect(((times[1] as number) - (times[0] as number)) / 60_000).toBe(45);
  });
});

test.describe('equipe do evento, comunicados e ciclo de vida', () => {
  test('adiciona um moderador; ele lança resultado mas não vê "Gerar chave" nem as abas da organização', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const nickname = await nicknameOf(page, 'u_p40');
    const bianca = await nicknameOf(page, 'u_bianca');
    await manage(page, LIGA, 'equipe');

    // Quem está inscrito não entra na equipe.
    const form = page.getByRole('form', { name: 'Adicionar à equipe' });
    await form.getByLabel(/Apelido na Nova Arena/).fill(bianca);
    await form.getByRole('button', { name: 'Adicionar à equipe' }).click();
    await expect(form.getByText(/está inscrito neste campeonato/)).toBeVisible();

    await form.getByLabel(/Apelido na Nova Arena/).fill(nickname);
    await form.getByLabel('Papel').selectOption('MODERATOR');
    await expect(form.getByText(/Ajuda no dia do evento/)).toBeVisible();
    await form.getByRole('button', { name: 'Adicionar à equipe' }).click();
    await expect(page.getByTestId('staff-member').filter({ hasText: nickname })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Como moderador.
    await loginAs(page, 'u_p40');
    const { hers } = await pendingQuarters(page);
    const rival = hers.participants.find((p) => p.name !== 'Bianca')?.name as string;
    await manage(page, LIGA);
    await expect(page.getByRole('tab', { name: 'Partidas e resultados' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Validação' })).toBeVisible();
    for (const hidden of ['Equipe', 'Comunicados', 'Auditoria', 'Página pública']) await expect(page.getByRole('tab', { name: hidden })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Pausar campeonato' })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Fases e chave' }).click();
    await expect(page.getByTestId('stage-progress')).toBeVisible();
    for (const hidden of ['Gerar chave', 'Gerar de novo', 'Ajustar posições', 'Trocar pontuação', 'Encerrar campeonato']) await expect(page.getByRole('button', { name: hidden })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Partidas e resultados' }).click();
    await card(page, hers.id).getByRole('button', { name: /Lançar resultado/ }).click();
    await page.getByRole('textbox', { name: 'Jogos vencidos de Bianca' }).fill('2');
    await page.getByRole('textbox', { name: `Jogos vencidos de ${rival}` }).fill('0');
    await page.getByRole('button', { name: 'Salvar resultado' }).click();
    await expect(page.getByTestId('server-points')).toBeVisible();
    // A API também recusa o que a tela esconde.
    expect((await api(page, `/stages/${LIGA_S1}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).status).toBe(403);
  });

  test('envia um comunicado e ele aparece na página pública', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await manage(page, LIGA, 'comunicados');
    const form = page.getByRole('form', { name: 'Novo comunicado' });
    await form.getByRole('button', { name: 'Enviar comunicado' }).click();
    await expect(form.getByText('Dê um título')).toBeVisible();
    await form.getByLabel(/Título/).fill('Semifinais adiadas em 30 minutos');
    await form.getByLabel(/Mensagem/).fill('As semifinais começam às 20h30. O check-in abre às 20h.');
    await form.getByRole('button', { name: 'Enviar comunicado' }).click();
    await expect(page.getByTestId('announcement').first()).toContainText('Semifinais adiadas em 30 minutos');
    await expectNoHorizontalScroll(page);

    await page.goto(`/c/${LIGA_SLUG}?aba=comunicados`);
    await expect(page.getByText('Semifinais adiadas em 30 minutos')).toBeVisible();
    await expect(page.getByText('As semifinais começam às 20h30. O check-in abre às 20h.')).toBeVisible();

    // A Bianca (inscrita) foi notificada.
    await loginAs(page, 'u_bianca');
    const list = await ok<{ items?: { title: string }[] } | { title: string }[]>(page, '/notifications');
    expect(JSON.stringify(list)).toContain('Semifinais adiadas em 30 minutos');
  });

  test('pausa com motivo e retoma; só as transições válidas aparecem', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await manage(page, LIGA);
    // Em andamento: pausar e encerrar; cancelar não (é preciso pausar antes).
    await expect(page.getByRole('button', { name: 'Cancelar campeonato' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Arquivar' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Pausar campeonato' }).click();
    const pause = page.getByRole('dialog', { name: 'Pausar o campeonato?' });
    await pause.getByRole('button', { name: 'Pausar campeonato' }).click();
    await expect(pause.getByText(/Informe o motivo/)).toBeVisible();
    await pause.getByLabel(/Motivo da pausa/).fill('Queda de energia na arena');
    await pause.getByRole('button', { name: 'Pausar campeonato' }).click();
    await expect(page.getByTestId('pause-reason')).toContainText('Queda de energia na arena');
    expect((await ok<{ status: string }>(page, `/tournaments/${LIGA}`)).status).toBe('PAUSED');

    // Pausado: retomar e cancelar; pausar e encerrar não.
    await expect(page.getByRole('button', { name: 'Pausar campeonato' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Encerrar campeonato' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cancelar campeonato' })).toBeVisible();
    await page.getByRole('tab', { name: 'Partidas e resultados' }).click();
    await expect(page.getByText(/O campeonato está pausado/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Lançar resultado/ }).first()).toBeDisabled();

    await page.getByRole('tab', { name: 'Resumo' }).click();
    await page.getByRole('button', { name: 'Retomar campeonato' }).click();
    await page.getByRole('dialog', { name: 'Retomar o campeonato?' }).getByRole('button', { name: 'Retomar campeonato' }).click();
    await expect(page.getByRole('button', { name: 'Pausar campeonato' })).toBeVisible();
    expect((await ok<{ status: string }>(page, `/tournaments/${LIGA}`)).status).toBe('IN_PROGRESS');
    await expectNoHorizontalScroll(page);
  });

  test('desclassifica com motivo, explicando o efeito no formato (RN-06)', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const { other } = await pendingQuarters(page);
    const [loser, winner] = other.participants.map((p) => p.name) as [string, string];
    await manage(page, LIGA, 'inscricoes');
    await expect(page.getByTestId('started-note')).toContainText('não dá mais para substituir');
    await expect(page.getByRole('button', { name: /^Substituir / })).toHaveCount(0);

    await page.getByRole('button', { name: `Desclassificar ou registrar desistência de ${loser}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Tirar ${loser} do campeonato` });
    await expect(dialog.getByTestId('withdraw-effect')).toContainText('W.O. para o adversário');
    await dialog.getByRole('button', { name: 'Desclassificar' }).click();
    await expect(dialog.getByText(/Informe o motivo/)).toBeVisible();
    await dialog.getByLabel(/Motivo/).fill('Uso de programa proibido');
    await dialog.getByRole('button', { name: 'Desclassificar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(registrationRow(page, loser).first()).toContainText('Desclassificado');

    // No mata-mata, a partida dele virou W.O. para o adversário.
    const after = (await bracketOf(page, LIGA_S1)).matches.find((m) => m.id === other.id);
    expect(after?.status).toBe('WALKOVER');
    await page.getByRole('tab', { name: 'Partidas e resultados' }).click();
    await expect(card(page, other.nextMatchId as string)).toContainText(winner);
    await page.getByRole('tab', { name: 'Auditoria' }).click();
    await expect(page.getByText('Participante desclassificado').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

test.describe('importação de resultados por CSV', () => {
  test('mostra o erro da linha inválida na prévia e importa só a queda certa', async ({ page }) => {
    await loginAs(page, 'u_camila');
    const bracket = await startCopa(page, 'e2e-csv');
    const a1 = bracket.matches.find((m) => m.groupName === 'Grupo A' && m.roundLabel === 'Queda 1') as ApiMatch;
    const b1 = bracket.matches.find((m) => m.groupName === 'Grupo B' && m.roundLabel === 'Queda 1') as ApiMatch;
    const [a, b] = [a1.participants.map((p) => p.name), b1.participants.map((p) => p.name)];
    const csv = ['grupo;queda;squad;colocacao;kills', `Grupo A;1;${a[0]};1;7`, `Grupo A;1;${a[1]};2;9`, `Grupo A;1;${a[2]};3;4`, `Grupo B;1;${b[0]};abc;2`, `Grupo B;1;${b[1]};2;1`, `Grupo B;1;${b[2]};3;0`].join('\r\n');

    await manage(page, COPA, 'partidas');
    await page.getByRole('button', { name: 'Importar resultados (CSV)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar resultados por CSV' });
    await expect(dialog.getByRole('button', { name: 'Baixar modelo de CSV' })).toBeVisible();
    await dialog.getByTestId('results-csv-input').setInputFiles({ name: 'quedas.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });

    // Prévia: a linha 5 tem número inválido e a queda dela fica de fora.
    await expect(dialog.getByTestId('results-line-5')).toContainText('Colocação "abc" não é um número');
    await expect(dialog.locator('[data-testid="results-match"][data-ready="true"]')).toHaveCount(1);
    await expect(dialog.locator('[data-testid="results-match"][data-ready="false"]')).toContainText('Grupo B · Queda 1');
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: 'Importar 1 queda' }).click();

    const report = dialog.getByTestId('results-report');
    await expect(report).toContainText('Quedas aplicadas');
    await expect(report.locator('dd').first()).toHaveText('1');
    await dialog.getByRole('button', { name: 'Concluir' }).click();
    await expect(card(page, a1.id)).toHaveAttribute('data-status', 'VALIDATED');
    await expect(card(page, b1.id)).not.toHaveAttribute('data-status', 'VALIDATED');

    const standings = await ok<{ overall: { name: string; points: number }[] }>(page, `/stages/${S1}/standings`);
    expect(a.map((name) => standings.overall.find((r) => r.name === name)?.points)).toEqual([10, 9, 4]);
  });
});

test.describe('onboarding do organizador', () => {
  test('quem ainda não publicou vê os primeiros passos, chega ao assistente em 2 cliques e pode dispensar', async ({ page }) => {
    await loginAs(page, 'u_lucas');
    await ok(page, '/role-invites/convite-organizador-valido/accept', { method: 'POST' });
    await page.goto('/organizador');

    const steps = page.getByTestId('primeiros-passos');
    await expect(steps).toBeVisible();
    await expect(steps.getByRole('progressbar', { name: 'Primeiros passos concluídos' })).toBeVisible();
    await expect(steps.getByTestId('passo-publicar')).toHaveAttribute('data-done', 'false');
    await expect(steps.getByTestId('explorar-exemplo')).toHaveAttribute('href', `/c/${LIGA_SLUG}`);
    await expectNoHorizontalScroll(page);

    // Clique 1: o passo pendente. Clique 2: começar. Pronto: assistente aberto.
    await steps.getByTestId('passo-modelo').getByRole('link').click();
    await expect(page).toHaveURL(/\/organizador\/novo$/);
    await page.getByRole('button', { name: 'Começar do zero' }).click();
    await expect(page.getByTestId('wizard-step-title')).toHaveText('Informações');
    await expect(page.getByTestId('dica-assistente')).toBeVisible();
    await page.getByRole('button', { name: /Dispensar a dica/ }).click();
    await expect(page.getByTestId('dica-assistente')).toHaveCount(0);

    // O atalho de exemplo abre a página pública, só para leitura.
    await page.goto('/organizador');
    await expect(steps.getByTestId('passo-modelo')).toHaveAttribute('data-done', 'true');
    await steps.getByTestId('explorar-exemplo').click();
    await expect(page).toHaveURL(new RegExp(`/c/${LIGA_SLUG}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Liga Semanal Clash Royale 1v1' })).toBeVisible();

    // Dispensar fica guardado neste aparelho.
    await page.goto('/organizador');
    await steps.getByRole('button', { name: 'Dispensar os primeiros passos' }).click();
    await expect(steps).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Meu painel' })).toBeVisible();
    await expect(steps).toHaveCount(0);
  });

  test('quem já publicou não vê o checklist', async ({ page }) => {
    await loginAs(page, 'u_camila');
    await page.goto('/organizador');
    await expect(page.getByRole('heading', { level: 1, name: 'Meu painel' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Resumo' })).toBeVisible();
    await expect(page.getByTestId('primeiros-passos')).toHaveCount(0);
  });
});

test.describe('arte de resultado', () => {
  async function expectArt(preview: Locator, texts: string[]): Promise<void> {
    await expect(preview).toBeVisible();
    for (const text of texts) await expect(preview).toContainText(text);
  }

  test('página da arte do Open 8 Ball Pool: prévia, baixar PNG e certificado', async ({ page }) => {
    await page.goto('/c/open-8-ball-pool/arte');
    await expect(page.getByRole('heading', { level: 1, name: 'Arte de resultado' })).toBeVisible();
    const podium = await ok<{ places: { place: number; name: string }[] }>(page, '/tournaments/tn_open_8ball/podium');
    const champion = podium.places.find((p) => p.place === 1)?.name as string;

    const preview = page.getByTestId('art-preview');
    await expectArt(preview, ['NOVA ARENA', 'Open 8 Ball Pool', 'CAMPEÃO', champion, '2º LUGAR', '3º LUGAR']);
    await expect(preview).toHaveAttribute('data-format', 'landscape');
    await expectNoHorizontalScroll(page);

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Baixar PNG \(1200 × 630\)/ }).click()]);
    expect(download.suggestedFilename()).toBe('campeoes-open-8-ball-pool-1200x630.png');
    const file = await download.path();
    expect((await stat(file)).size).toBeGreaterThan(5_000);

    await page.getByLabel('Formato da imagem').selectOption('square');
    await expect(preview).toHaveAttribute('data-format', 'square');
    await expect(page.getByRole('button', { name: /Baixar PNG \(1080 × 1080\)/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Certificado' }).click();
    await expectArt(page.getByTestId('art-preview'), ['CERTIFICADO DE CAMPEÃO', champion, 'Open 8 Ball Pool']);
    await expect(page.getByRole('button', { name: 'Compartilhar' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('campeonato que não terminou ainda não tem arte', async ({ page }) => {
    await page.goto(`/c/${LIGA_SLUG}/arte`);
    await expect(page.getByText('A arte fica pronta quando o campeonato termina')).toBeVisible();
    await expect(page.getByTestId('art-preview')).toHaveCount(0);
  });
});
