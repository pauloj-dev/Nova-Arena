import type { Locator, Page } from '@playwright/test';
import { expect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

/**
 * Chave, tabelas e partidas do participante (F2.2, F2.4 e F2.10; issues #41, #42 e #46), em 1440 px e 360 px.
 * Seed: na "Liga Semanal Clash Royale 1v1" (mata-mata MD3, em andamento) a Bianca venceu as oitavas e tem
 * as quartas contra BrunoPro7 com check-in aberto e sala `NOVA-7Q2`; a quartas PedroZz4 x KauePro1 ainda
 * não foi jogada. O "Open 8 Ball Pool" (suíço) está finalizado, com pódio: Bianca, MarinaGG23 e KaueX21.
 */
test.describe.configure({ timeout: 120_000 });

const LIGA = '/c/liga-semanal-clash-royale';
const OPEN = '/c/open-8-ball-pool';
const LIGA_STAGE = 'tn_liga_cr_s1';

function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 768;
}

async function visit(page: Page, path: string, user?: DemoUser): Promise<void> {
  if (user) await loginAs(page, user);
  await page.goto(path);
  await waitForApp(page);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Todos os confrontos da chave na tela (SVG no desktop, cartões no celular). */
function bracketMatches(page: Page): Locator {
  return page.getByTestId('bracket-view').getByTestId('bracket-match');
}

/** Tabela de classificação: a linha de um participante. */
function standingsRow(page: Page, name: string): Locator {
  return page.getByTestId('standings-table').locator('tr[data-registration-id]').filter({ hasText: name });
}

/** A célula de pontos de um participante. */
function standingsPoints(page: Page, name: string): Locator {
  return standingsRow(page, name).locator('[data-col="points"]');
}

/**
 * Lança um resultado "em segundo plano", como a organização faria em outro lugar: troca a sessão da
 * API simulada para a Camila, lança o placar e devolve a sessão a quem estava vendo. A tela não é tocada.
 */
async function launchResult(page: Page, nodeId: string, winnerSlot: 0 | 1, restore: DemoUser | null): Promise<void> {
  const status = await page.evaluate(
    async ({ stageId, node, winner, back }) => {
      const send = (path: string, method: string, body?: unknown) =>
        fetch(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      await send('/auth/dev-login', 'POST', { userId: 'u_camila' });
      const bracket = (await (await send(`/stages/${stageId}/bracket`, 'GET')).json()) as { matches: { id: string; nodeId: string; participants: { registrationId: string }[] }[] };
      const match = bracket.matches.find((m) => m.nodeId === node);
      const res = await send(`/matches/${match?.id}/result`, 'PUT', { entries: match?.participants.map((p, i) => ({ registrationId: p.registrationId, score: i === winner ? 2 : 0 })) });
      if (back) await send('/auth/dev-login', 'POST', { userId: back });
      else await send('/auth/logout', 'POST');
      return res.status;
    },
    { stageId: LIGA_STAGE, node: nodeId, winner: winnerSlot, back: restore },
  );
  expect(status).toBe(200);
}

test.describe('chave e partida da Bianca na Liga Semanal', () => {
  test('vê a chave com o caminho dela destacado; no celular a chave vira lista por rodada com abas', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`, 'u_bianca');
    await expect(page.getByRole('tab', { name: 'Chave/Tabela' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('AO VIVO', { exact: true })).toBeVisible();
    const view = page.getByTestId('bracket-view');
    await expect(view).toBeVisible();

    if (isMobile(page)) {
      // Sem SVG: uma aba por rodada, aberta na rodada do confronto pendente dela.
      await expect(view).toHaveAttribute('data-mode', 'list');
      await expect(page.getByTestId('bracket-canvas')).toHaveCount(0);
      const rounds = page.getByRole('tablist', { name: 'Rodadas da chave' });
      await expect(rounds.getByRole('tab')).toHaveText(['Oitavas de final', 'Quartas de final', 'Semifinal', 'Final']);
      await expect(rounds.getByRole('tab', { name: 'Quartas de final' })).toHaveAttribute('aria-selected', 'true');
      await expect(bracketMatches(page)).toHaveCount(4);
      const mine = view.locator('[data-testid="bracket-match"][data-highlight="true"]');
      await expect(mine).toHaveCount(1);
      await expect(mine).toContainText('Seu confronto');
      await expect(mine).toContainText('Bianca');
      await expect(mine).toContainText('Check-in');
      // Outra rodada: o confronto que ela já venceu também vem marcado.
      await rounds.getByRole('tab', { name: 'Oitavas de final' }).click();
      await expect(bracketMatches(page)).toHaveCount(8);
      await expect(view.locator('[data-testid="bracket-match"][data-highlight="true"]')).toHaveCount(1);
      await rounds.getByRole('tab', { name: 'Final', exact: true }).click();
      await expect(view.getByText('Disputa de 3º lugar')).toBeVisible();
    } else {
      // SVG com todas as rodadas, conectores e controles de zoom.
      await expect(view).toHaveAttribute('data-mode', 'canvas');
      await expect(bracketMatches(page)).toHaveCount(16);
      const highlighted = view.locator('[data-testid="bracket-match"][data-highlight="true"]');
      await expect(highlighted).toHaveCount(2); // oitavas (vencida) e quartas (por jogar)
      await expect(highlighted.first()).toHaveAttribute('aria-label', /^Oitavas de final: ThiagoBR2 contra Bianca, .*horário de Brasília, concluída, Bianca venceu por 2 a 1, seu confronto$/);
      await expect(highlighted.last()).toHaveAttribute('aria-label', /^Quartas de final: BrunoPro7 contra Bianca, \d\d\/\d\d às \d+h(\d\d)?, horário de Brasília, check-in aberto, seu confronto$/);
      await expect(view.locator('path[data-path="walked"]')).toHaveCount(1);
      await expect(view.locator('path[data-path="projected"]')).toHaveCount(2); // quartas → semi → final
      await expect(page.getByText(/Seu caminho na chave está marcado/)).toBeVisible();

      // Zoom pelos botões.
      const zoom = page.getByTestId('bracket-zoom');
      const before = Number.parseInt((await zoom.textContent()) ?? '', 10);
      await page.getByRole('button', { name: 'Aumentar zoom' }).click();
      await expect(zoom).not.toHaveText(`${before}%`);
      await page.getByRole('button', { name: 'Ajustar a chave à tela' }).click();
      await expect(bracketMatches(page).first()).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
  });

  test('abre a partida das quartas, vê a contagem regressiva, faz check-in e vê a sala', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`, 'u_bianca');
    const mine = page.getByTestId('bracket-view').locator('[data-testid="bracket-match"][data-highlight="true"][data-status="CHECK_IN"]');
    await expect(mine).toHaveCount(1);
    // No desktop o confronto é o próprio botão (SVG); no celular, o botão fica dentro do cartão.
    if (isMobile(page)) await mine.getByRole('button', { name: /^Quartas de final: BrunoPro7 contra Bianca/ }).click();
    else await mine.click();

    const dialog = page.getByRole('dialog', { name: 'Detalhes da partida' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Quartas de final' })).toBeVisible();
    await expect(dialog.getByText('Sua partida')).toBeVisible();
    await expect(dialog.getByText(/horário de Brasília/).first()).toBeVisible();

    // Check-in aberto, com contagem regressiva andando.
    const panel = dialog.getByTestId('checkin-panel');
    await expect(panel.getByText('Check-in aberto')).toBeVisible();
    const countdown = panel.getByTestId('checkin-countdown');
    await expect(countdown).toHaveText(/^0\d:\d\d$/);
    const first = await countdown.textContent();
    await expect(countdown).not.toHaveText(first ?? '', { timeout: 5_000 });

    // A sala aparece para quem está na partida, com botões de copiar.
    const lobby = dialog.getByRole('region', { name: 'Sala da partida' });
    await expect(lobby.getByTestId('lobby-code')).toHaveText('NOVA-7Q2');
    await expect(lobby.getByTestId('lobby-password')).toHaveText('4821');
    await expect(lobby.getByRole('button', { name: 'Copiar código da sala' })).toBeVisible();
    await expect(lobby.getByRole('button', { name: 'Copiar senha da sala' })).toBeVisible();

    await panel.getByRole('button', { name: 'Fazer check-in' }).click();
    await expect(panel.getByText('Check-in feito', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Fazer check-in' })).toHaveCount(0);
    await expect(dialog.getByText('check-in feito', { exact: true })).toBeVisible(); // o lado dela no confronto
    await expect(lobby.getByTestId('lobby-code')).toHaveText('NOVA-7Q2');
    await expectNoHorizontalScroll(page);

    // O check-in fica gravado: recarregando, continua feito.
    await page.reload();
    await waitForApp(page);
    await page.getByRole('tab', { name: 'Partidas' }).click();
    const card = page.locator('[data-testid="match-card"][data-status="CHECK_IN"]');
    await expect(card.getByTestId('checkin-panel').getByText('Check-in feito', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Fazer check-in' })).toHaveCount(0);
  });

  test('home e "Meus campeonatos" mostram a próxima partida com check-in e link direto', async ({ page }) => {
    await visit(page, '/', 'u_bianca');
    const section = page.getByRole('region', { name: 'Suas próximas partidas' });
    const next = section.getByTestId('next-match');
    await expect(next).toHaveCount(1);
    await expect(next).toContainText('Mata-mata · Quartas de final · contra BrunoPro7');
    await expect(next).toContainText('horário de Brasília');
    await expect(next.getByTestId('checkin-countdown')).toBeVisible();
    await expect(next.getByRole('button', { name: 'Fazer check-in' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await next.getByRole('button', { name: 'Fazer check-in' }).click();
    await expect(next.getByText('Check-in feito', { exact: true })).toBeVisible();

    // O link abre a partida já no detalhe.
    await next.getByRole('link', { name: /Ver partida/ }).click();
    await expect(page).toHaveURL(/\/c\/liga-semanal-clash-royale\?aba=partidas&partida=/);
    const dialog = page.getByRole('dialog', { name: 'Detalhes da partida' });
    await expect(dialog.getByTestId('lobby-code')).toHaveText('NOVA-7Q2');
    await expect(dialog.getByTestId('checkin-panel').getByText('Check-in feito', { exact: true })).toBeVisible();

    await visit(page, '/minha-conta/campeonatos');
    await expect(page.getByTestId('next-match')).toContainText('contra BrunoPro7');
    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Open 8 Ball Pool' })).toContainText('1º lugar');
  });
});

test.describe('quem não está na partida', () => {
  test('jogador de fora e visitante veem a chave e a tabela, mas não a sala nem o check-in', async ({ page }) => {
    // Jogador logado que não está no campeonato.
    await visit(page, `${LIGA}?aba=chave`, 'u_p40');
    await expect(page.getByTestId('bracket-view')).toBeVisible();
    await expect(page.getByTestId('bracket-view').locator('[data-highlight="true"]')).toHaveCount(0);
    await expect(standingsRow(page, 'Bianca')).toBeVisible();

    await page.getByRole('tab', { name: 'Partidas' }).click();
    const card = page.locator('[data-testid="match-card"][data-status="CHECK_IN"]');
    await expect(card).toHaveCount(1);
    const matchId = await card.getAttribute('data-match-id');
    await card.getByRole('button', { name: /^Quartas de final: BrunoPro7 contra Bianca/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalhes da partida' });
    await expect(dialog.getByRole('list', { name: 'Lados do confronto' })).toContainText('Bianca');
    await expect(dialog.getByTestId('lobby-panel')).toHaveCount(0);
    await expect(dialog.getByTestId('checkin-panel')).toHaveCount(0);
    await expect(dialog.getByText('NOVA-7Q2')).toHaveCount(0);
    // A API também recusa: a sala só sai para quem está na partida.
    const forbidden = await page.evaluate(async (id) => (await fetch(`/api/v1/matches/${id}/lobby`)).status, matchId);
    expect(forbidden).toBe(403);
    await page.keyboard.press('Escape');

    // Visitante.
    await page.evaluate(() => fetch('/api/v1/auth/logout', { method: 'POST' }));
    await visit(page, `${LIGA}?aba=chave`);
    await expect(bracketMatches(page).first()).toBeVisible();
    await expect(page.getByTestId('standings-table')).toBeVisible();
    await expect(standingsPoints(page, 'LeoX15')).toHaveText('10');
    await page.getByRole('tab', { name: 'Partidas' }).click();
    await expect(page.getByRole('checkbox', { name: 'Só as minhas partidas' })).toHaveCount(0);
    await page.locator('[data-testid="match-card"][data-status="CHECK_IN"]').getByRole('button', { name: /^Quartas de final: BrunoPro7 contra Bianca/ }).click();
    await expect(page.getByRole('dialog', { name: 'Detalhes da partida' }).getByRole('list', { name: 'Lados do confronto' })).toBeVisible();
    await expect(page.getByTestId('lobby-panel')).toHaveCount(0);
    await expect(page.getByTestId('checkin-panel')).toHaveCount(0);
    expect(await page.evaluate(async (id) => (await fetch(`/api/v1/matches/${id}/lobby`)).status, matchId)).toBe(401);
  });

  test('as abas de competição só existem quando o campeonato tem chave confirmada', async ({ page }) => {
    await visit(page, '/c/copa-nova-ff-squad?aba=chave');
    await expect(page.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Chave/Tabela' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Partidas' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Resultados' })).toHaveCount(0);
    await expect(page.getByText('AO VIVO', { exact: true })).toHaveCount(0);
  });
});

test.describe('Open 8 Ball Pool (suíço, finalizado)', () => {
  test('tabela do suíço, explicação do desempate ao tocar na posição e pódio', async ({ page }) => {
    await visit(page, `${OPEN}?aba=chave`, 'u_bianca');
    const table = page.getByTestId('standings-table');
    const rows = table.locator('tr[data-registration-id]');
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText('Bianca');
    await expect(rows.first()).toContainText('Você');
    await expect(rows.first()).toContainText('15');
    await expect(rows.first()).toHaveAttribute('data-mine', 'true');
    await expect(rows.nth(1)).toContainText('MarinaGG23');

    if (isMobile(page)) {
      // Só Pos, Jogador e Pts; o resto na linha expansível.
      await expect(table.getByRole('columnheader', { name: 'Saldo' })).toBeHidden();
      await page.getByRole('button', { name: 'Ver os números de MarinaGG23' }).click();
      await expect(table.getByText('Vitórias')).toBeVisible();
      await expect(table.getByText('Pró / contra')).toBeVisible();
    } else {
      await expect(table.getByRole('columnheader').filter({ visible: true })).toHaveText(['Pos', 'Jogador', 'J', 'V', 'E', 'D', 'Saldo', 'Pts']);
    }

    // Desempate: tocar na posição explica o critério.
    await page.getByRole('button', { name: '2º lugar. Ver como o desempate foi decidido' }).click();
    const popover = page.getByTestId('tiebreak-popover');
    await expect(popover).toContainText('Empate em pontos com KaueX21. Desempate por saldo (+2).');
    await page.keyboard.press('Escape');
    await expect(popover).toHaveCount(0);
    // Posição sem desempate não é botão.
    await expect(page.getByRole('button', { name: /^1º lugar/ })).toHaveCount(0);

    // Rodadas do suíço (formato sem chave em árvore): abas por rodada, aberta na última.
    const rounds = page.getByRole('tablist', { name: 'Rodadas do suíço' });
    await expect(rounds.getByRole('tab')).toHaveText(['Rodada 1', 'Rodada 2', 'Rodada 3']);
    await expect(rounds.getByRole('tab', { name: 'Rodada 3' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('rounds-view').getByTestId('bracket-match')).toHaveCount(4);
    await expect(page.getByTestId('bracket-canvas')).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    // Pódio na aba Resultados.
    await page.getByRole('tab', { name: 'Resultados' }).click();
    const podium = page.getByTestId('podium');
    await expect(podium.getByRole('heading', { name: 'Pódio' })).toBeVisible();
    await expect(podium.locator('[data-place="1"]')).toContainText('1º lugar · Campeão');
    await expect(podium.locator('[data-place="1"]')).toContainText('Bianca');
    await expect(podium.locator('[data-place="2"]')).toContainText('MarinaGG23');
    await expect(podium.locator('[data-place="3"]')).toContainText('KaueX21');
    // Partidas concluídas, da mais recente para a mais antiga.
    const done = page.getByRole('list', { name: /^Partidas concluídas/ }).getByTestId('match-card');
    await expect(done).toHaveCount(12);
    await expect(done.first()).toContainText('Rodada 3');
    await expect(done.last()).toContainText('Rodada 1');
    await expectNoHorizontalScroll(page);
  });
});

test.describe('ao vivo', () => {
  test('a tabela e a chave mudam sozinhas quando um resultado é lançado em segundo plano', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`, 'u_bianca');
    const kaue = standingsPoints(page, 'KauePro1');
    await expect(kaue).toHaveText('5'); // 1 vitória
    const positionBefore = await page.getByTestId('standings-table').locator('tr[data-registration-id]').evaluateAll((rows) => rows.findIndex((r) => r.textContent?.includes('KauePro1')));

    // A organização lança PedroZz4 0 x 2 KauePro1 nas quartas. Ninguém mexe nesta tela.
    await launchResult(page, 'w-r2-m4', 1, 'u_bianca');

    await expect(kaue).toHaveText('10');
    const positionAfter = await page.getByTestId('standings-table').locator('tr[data-registration-id]').evaluateAll((rows) => rows.findIndex((r) => r.textContent?.includes('KauePro1')));
    expect(positionAfter).toBeLessThan(positionBefore);
    await expect(page.getByTestId('standings-announcement')).toContainText(/Classificação atualizada: .*KauePro1 subiu para/);

    // A chave também: KauePro1 aparece na semifinal.
    if (isMobile(page)) await page.getByRole('tablist', { name: 'Rodadas da chave' }).getByRole('tab', { name: 'Semifinal' }).click();
    await expect(page.getByTestId('bracket-view').getByRole('button', { name: /^Semifinal: a definir \(Vencedor: Quartas de final 3\) contra KauePro1/ })).toBeVisible();
    // Continua sendo a Bianca (a troca de sessão foi só na API).
    await expect(standingsRow(page, 'Bianca')).toContainText('Você');
  });

  test('CT-10: sem tempo real aparece "Reconectando…" e a tabela segue atualizando por polling', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`);
    await expect(page.getByText('AO VIVO', { exact: true })).toBeVisible();
    const kaue = standingsPoints(page, 'KauePro1');
    await expect(kaue).toHaveText('5');

    await page.evaluate(() => (window as unknown as { __novaRealtime: { setOnline: (online: boolean) => void } }).__novaRealtime.setOnline(false));
    await expect(page.getByText(/Reconectando…/)).toBeVisible();
    await expect(page.getByText('AO VIVO', { exact: true })).toHaveCount(0);

    // Com a conexão caída o evento não chega; quem traz a mudança é o polling de 10 s.
    await launchResult(page, 'w-r2-m4', 1, null);
    await page.waitForTimeout(1_500);
    await expect(kaue).toHaveText('5'); // o evento não chegou: nada mudou ainda
    await expect(kaue).toHaveText('10', { timeout: 20_000 });

    // Voltou a conexão: volta o "AO VIVO".
    await page.evaluate(() => (window as unknown as { __novaRealtime: { setOnline: (online: boolean) => void } }).__novaRealtime.setOnline(true));
    await expect(page.getByText('AO VIVO', { exact: true })).toBeVisible();
    await expect(page.getByText(/Reconectando…/)).toHaveCount(0);
  });
});

test.describe('teclado e layout', () => {
  test('Tab e setas percorrem os confrontos e Enter abre o detalhe', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`);
    const view = page.getByTestId('bracket-view');
    await expect(bracketMatches(page).first()).toBeVisible();

    if (isMobile(page)) {
      // Lista: do seletor de rodada, Tab chega ao primeiro confronto; ↓ ↑ andam entre eles.
      await page.getByRole('tablist', { name: 'Rodadas da chave' }).getByRole('tab', { name: 'Quartas de final' }).focus();
      const buttons = view.locator('[data-bracket-match]');
      for (let i = 0; i < 3 && !(await buttons.first().evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press('Tab');
      await expect(buttons.first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(buttons.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(buttons.nth(2)).toBeFocused();
      await expect(buttons.nth(2)).toHaveAttribute('aria-label', /^Quartas de final: BrunoPro7 contra Bianca/);
      await page.keyboard.press('ArrowUp');
      await expect(buttons.nth(1)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Detalhes da partida' }).getByRole('list', { name: 'Lados do confronto' })).toContainText('CaioX9');
    } else {
      // SVG: depois dos botões de zoom, o Tab entra na chave em um confronto só (roving tabindex).
      await page.getByRole('button', { name: 'Ajustar a chave à tela' }).focus();
      await page.keyboard.press('Tab');
      const first = view.locator('[data-testid="bracket-match"][aria-label^="Oitavas de final: LeoX15 contra LarissaBR8"]');
      await expect(first).toBeFocused();
      await expect(view.getByTestId('bracket-focus-ring')).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Oitavas de final: NinaZz10 contra VitorGG11"]')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Quartas de final: LeoX15 contra NinaZz10"]')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Semifinal: LeoX15 contra CaioX9"]')).toBeFocused();
      await page.keyboard.press('ArrowRight');
      const final = view.locator('[data-testid="bracket-match"][aria-label^="Final:"]');
      await expect(final).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Disputa de 3º lugar:"]')).toBeFocused();
      // O confronto em foco é trazido para a área visível.
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Disputa de 3º lugar:"]')).toBeInViewport();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Detalhes da partida' });
      await expect(dialog.getByRole('heading', { name: 'Semifinal' })).toBeVisible();
      await expect(dialog.getByRole('list', { name: 'Lados do confronto' })).toContainText('LeoX15');
      // Fechar devolve o foco ao confronto.
      await page.keyboard.press('Escape');
      await expect(view.locator('[data-testid="bracket-match"][aria-label^="Semifinal: LeoX15 contra CaioX9"]')).toBeFocused();
    }
  });

  test('nenhuma rolagem horizontal nas três abas; filtros de partidas funcionam', async ({ page }) => {
    await visit(page, `${LIGA}?aba=chave`, 'u_bianca');
    await expect(page.getByTestId('standings-table')).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (isMobile(page)) {
      // Linha expansível aberta também não estoura a tela.
      await page.getByRole('button', { name: 'Ver os números de LeoX15' }).click();
      await expectNoHorizontalScroll(page);
    }

    await page.getByRole('tab', { name: 'Partidas' }).click();
    await expect(page).toHaveURL(/aba=partidas/);
    const cards = page.getByTestId('match-card');
    await expect(cards).toHaveCount(16);
    await expect(page.getByRole('heading', { level: 3, name: /^Hoje · / })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Sem horário definido' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('checkbox', { name: 'Só as minhas partidas' }).check();
    await expect(cards).toHaveCount(2);
    await expect(page.getByText('2 partidas de 16')).toBeVisible();
    await page.getByLabel('Status').selectOption('CHECK_IN');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('BrunoPro7');
    await page.getByLabel('Status').selectOption('LIVE');
    await expect(page.getByText('Nenhuma partida com esses filtros')).toBeVisible();
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await expect(cards).toHaveCount(16);

    await page.getByRole('tab', { name: 'Resultados' }).click();
    await expect(page.getByRole('list', { name: /^Partidas concluídas/ }).getByTestId('match-card')).toHaveCount(10);
    await expect(page.getByTestId('podium')).toHaveCount(0); // campeonato em andamento: ainda sem pódio
    await expectNoHorizontalScroll(page);
  });
});
