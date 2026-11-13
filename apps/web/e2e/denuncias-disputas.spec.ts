/**
 * Denúncias (F2.9, #58), envio de resultado com disputa (F2.5, #49) e perfil competitivo (F2.7, #51),
 * em 1440 px e 360 px.
 * Seed: a Bianca joga as quartas da Liga Semanal Clash Royale (MD3, partida pronta e sem resultado);
 * a Camila organiza a Liga; a Ana é Admin; o Open 8 Ball Pool terminou com a Bianca campeã.
 */
import type { Locator, Page } from '@playwright/test';
import { expect as baseExpect, loginAs, test, waitForApp, type DemoUser } from './fixtures';

// Folga para o servidor de desenvolvimento, que compila cada rota na primeira visita.
const expect = baseExpect.configure({ timeout: 20_000 });
test.describe.configure({ timeout: 180_000 });

const DB_KEY = 'nova-mock-db';
const LIGA = '/c/liga-semanal-clash-royale?aba=partidas';
const LIGA_STAGE = 'tn_liga_cr_s1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });

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

/**
 * Fecha os avisos (toasts) antes de abrir um modal: no celular eles ficam por cima do modal de tela cheia.
 * Só chamar sem modal aberto — o aviso fica fora do diálogo, e clicar fora fecha o diálogo.
 */
async function dismissToasts(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: 'Fechar aviso' });
  while ((await close.count()) > 0) {
    await close
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
  }
}

interface LiveMatch {
  matchId: string;
  opponent: DemoUser;
  opponentName: string;
}

/** A partida das quartas da Bianca (pronta, sem resultado) e quem é o adversário. Chamar logado como Bianca. */
async function biancaMatch(page: Page): Promise<LiveMatch> {
  return page.evaluate(async (key) => {
    const matches = (await (await fetch('/api/v1/tournaments/tn_liga_cr/matches?mine=1')).json()) as { id: string; status: string; participants: { registrationId: string | null; name: string }[] }[];
    const db = JSON.parse(localStorage.getItem(key) ?? '{}') as { registrations: { id: string; userId: string | null; tournamentId: string }[] };
    const mine = db.registrations.find((r) => r.tournamentId === 'tn_liga_cr' && r.userId === 'u_bianca')?.id;
    const match = matches.find((m) => m.status !== 'VALIDATED' && m.participants.every((p) => p.registrationId));
    const other = match?.participants.find((p) => p.registrationId !== mine);
    const opponent = db.registrations.find((r) => r.id === other?.registrationId)?.userId;
    if (!match || !other || !opponent) throw new Error('Partida da Bianca não encontrada no seed');
    return { matchId: match.id, opponent: opponent as `u_p${string}`, opponentName: other.name };
  }, DB_KEY);
}

const card = (page: Page, matchId: string): Locator => page.locator(`[data-testid="match-card"][data-match-id="${matchId}"]`);

/** Linhas da classificação que importam para comparar "mudou / não mudou". */
async function standings(page: Page): Promise<unknown> {
  const res = await apiCall<{ overall: { registrationId: string; played: number; wins: number; losses: number; points: number; scoreFor: number }[] }>(page, 'GET', `/stages/${LIGA_STAGE}/standings`);
  return res.data.overall.map((r) => [r.registrationId, r.played, r.wins, r.losses, r.points, r.scoreFor]);
}

test.describe('denúncias', () => {
  test('denunciar um perfil com anexo e acompanhar em "Minhas denúncias"', async ({ page }) => {
    await visitAs(page, 'u_bianca', '/u/Lucas');
    await page.getByRole('button', { name: 'Denunciar Lucas' }).click();
    const dialog = page.getByRole('dialog', { name: 'Denunciar Lucas' });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Sem motivo nem descrição não envia.
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(dialog.getByText('Escolha um motivo')).toBeVisible();
    await expect(dialog.getByText('Conte o que aconteceu (pelo menos 10 caracteres)')).toBeVisible();

    await dialog.getByLabel('Motivo').selectOption({ label: 'Ofensa ou assédio' });
    await dialog.getByLabel('O que aconteceu?').fill('Xingou o meu squad inteiro no chat depois da partida de ontem.');
    await dialog.getByLabel('Anexos (opcional)').setInputFiles([image('chat-1.png'), image('chat-2.png')]);
    await expect(dialog.getByRole('img', { name: 'Anexo 2' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Remover anexo 2' }).click();
    await expect(dialog.getByRole('img')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();

    const done = page.getByRole('dialog', { name: 'Denúncia enviada' });
    await expect(done).toContainText('Recebemos sua denúncia sobre Lucas.');
    await expect(done).toContainText('A moderação da Nova Arena analisa');
    await expect(page.getByRole('status').filter({ hasText: 'Denúncia enviada' })).toContainText('Acompanhe em Minha conta › Denúncias.');
    await done.getByRole('link', { name: 'Ver minhas denúncias' }).click();

    await expect(page).toHaveURL(/\/minha-conta\/denuncias$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Denúncias' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Minha conta' }).getByRole('link', { name: 'Denúncias' })).toHaveAttribute('aria-current', 'page');
    const mine = page.getByRole('list', { name: 'Minhas denúncias' }).getByRole('article');
    await expect(mine).toHaveCount(2);
    const fresh = mine.first();
    await expect(fresh).toContainText('Jogador');
    await expect(fresh.getByRole('link', { name: 'Lucas' })).toHaveAttribute('href', '/u/Lucas');
    await expect(fresh).toContainText('Aberta');
    await expect(fresh).toContainText('Ofensa ou assédio');
    await expect(fresh).toContainText('Xingou o meu squad inteiro no chat depois da partida de ontem.');
    await expect(fresh).toContainText('Aguardando a análise da moderação.');
    // O anexo abre em tamanho grande.
    await fresh.getByRole('button', { name: 'Abrir anexo' }).click();
    await expect(page.getByRole('dialog', { name: 'Anexo' }).getByRole('img', { name: 'Anexo' })).toBeVisible();
    await page.keyboard.press('Escape');

    // A denúncia de demonstração já respondida mostra o status e a resposta da moderação.
    const answered = mine.nth(1);
    await expect(answered).toContainText('Medida aplicada');
    await expect(answered).toContainText('Resposta da moderação (Ana)');
    await expect(answered).toContainText('o jogador recebeu uma advertência');
    await expectNoHorizontalScroll(page);

    // O que foi gravado é o que a moderação vai ler: alvo, autor e dono do alvo.
    const stored = await page.evaluate((key) => ((JSON.parse(localStorage.getItem(key) ?? '{}') as { extra: { reports: Record<string, unknown>[] } }).extra.reports ?? []).find((r) => r.reporterId === 'u_bianca' && r.targetId === 'u_lucas'), DB_KEY);
    expect(stored).toMatchObject({ targetType: 'USER', targetLabel: 'Lucas', targetLink: '/u/Lucas', reporterNickname: 'Bianca', reason: 'HARASSMENT', status: 'OPEN', targetOwnerUserId: 'u_lucas' });
    expect((stored?.evidenceUrls as string[]).length).toBe(1);
  });

  test('visitante é levado ao login; o próprio perfil não tem botão de denúncia', async ({ page }) => {
    await page.goto('/u/Lucas');
    await waitForApp(page);
    await page.getByRole('button', { name: 'Denunciar Lucas' }).click();
    await expect(page).toHaveURL(/\/entrar\?next=%2Fu%2FLucas/);

    await visitAs(page, 'u_lucas', '/u/Lucas');
    await expect(page.getByRole('link', { name: 'Editar perfil' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Denunciar/ })).toHaveCount(0);
  });

  test('página do squad: quem não é o capitão pode denunciar o squad', async ({ page }) => {
    await visitAs(page, 'u_lucas', '/minha-conta/squads/t_alfa');
    await expect(page.getByRole('heading', { level: 1, name: 'Squad Alfa' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Denunciar/ })).toHaveCount(0);

    await visitAs(page, 'u_bianca', '/minha-conta/squads/t_alfa');
    await page.getByRole('button', { name: 'Denunciar Squad Alfa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Denunciar Squad Alfa' });
    await dialog.getByLabel('Motivo').selectOption({ label: 'Nome, tag ou imagem ofensiva' });
    await dialog.getByLabel('O que aconteceu?').fill('A logo do squad tem um símbolo ofensivo.');
    await dialog.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(page.getByRole('dialog', { name: 'Denúncia enviada' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Denúncia enviada' }).getByRole('button', { name: 'Entendi' }).click();

    await page.goto('/minha-conta/denuncias');
    await waitForApp(page);
    const first = page.getByRole('list', { name: 'Minhas denúncias' }).getByRole('article').first();
    await expect(first).toContainText('Squad');
    await expect(first.getByRole('link', { name: 'Squad Alfa [ALFA]' })).toHaveAttribute('href', '/minha-conta/squads/t_alfa');
  });
});

test.describe('envio de resultado e disputa', () => {
  test('envio → contestação com prova → mensagens → escalar → Admin resolve com o resultado corrigido', async ({ page }) => {
    test.slow();

    // 1. A Bianca envia o placar com print, pela página do campeonato.
    await visitAs(page, 'u_bianca', LIGA);
    const m = await biancaMatch(page);
    const before = await standings(page);
    const hers = card(page, m.matchId);
    await hers.getByRole('button', { name: 'Enviar resultado' }).click();
    const send = page.getByRole('dialog', { name: 'Enviar resultado' });
    await send.getByLabel('Placar de Bianca (você)').fill('2');
    await send.getByLabel(`Placar de ${m.opponentName}`).fill('1');
    // Sem print não envia (prova obrigatória).
    await send.getByRole('button', { name: 'Enviar resultado' }).click();
    await expect(send.getByText('Anexe pelo menos um print do resultado')).toBeVisible();
    await send.getByLabel('Print do resultado').setInputFiles(image('placar.png'));
    await expect(send.getByRole('img', { name: 'Anexo 1' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await send.getByRole('button', { name: 'Enviar resultado' }).click();
    await expect(send).toHaveCount(0);
    await expect(hers).toContainText('Aguardando o adversário confirmar (até');
    await expect(hers).toHaveAttribute('data-status', 'AWAITING_VALIDATION');
    await expect(hers.getByRole('button', { name: 'Enviar resultado' })).toHaveCount(0);

    // 2. O adversário vê o envio e contesta, com prova.
    await visitAs(page, m.opponent, LIGA);
    const theirs = card(page, m.matchId);
    await expect(theirs).toContainText('Bianca enviou');
    await expect(theirs.getByRole('button', { name: 'Confirmar' })).toBeVisible();
    await theirs.getByRole('button', { name: 'Contestar' }).click();
    const contest = page.getByRole('dialog', { name: 'Contestar resultado' });
    await contest.getByLabel('O que está errado?').fill('O placar real foi 2 a 0 para mim. O print dela é de outra partida.');
    await contest.getByRole('button', { name: 'Contestar resultado' }).click();
    await expect(contest.getByText('Anexe pelo menos uma prova')).toBeVisible();
    await contest.getByLabel('Prova').setInputFiles(image('prova.png'));
    await expect(contest.getByRole('img', { name: 'Anexo 1' })).toBeVisible();
    await contest.getByRole('button', { name: 'Contestar resultado' }).click();

    // 3. Tela da disputa: histórico com o envio original e a contestação.
    await expect(page).toHaveURL(/\/disputas\/dp_/);
    const disputeUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Disputa: Quartas de final');
    const main = page.getByRole('main');
    await expect(main.getByText('Aberta', { exact: true })).toBeVisible();
    const timeline = page.getByRole('list', { name: 'Histórico da disputa' });
    // Só os eventos (as miniaturas das provas também são itens de lista, dentro de cada evento).
    const events = timeline.locator(':scope > li');
    await expect(events).toHaveCount(2);
    await expect(events.nth(0)).toContainText('Resultado enviado');
    await expect(events.nth(0)).toContainText(/Bianca 2 x 1|1 x 2 Bianca/);
    await expect(events.nth(1)).toContainText('Resultado contestado');
    await expect(events.nth(1)).toContainText('O print dela é de outra partida.');
    await expect(timeline.getByRole('button', { name: 'Abrir print do envio' })).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Abrir prova da contestação' })).toBeVisible();
    // Participante não vê as ações de decisão.
    await expect(page.getByRole('button', { name: 'Resolver disputa' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Escalar para a administração' })).toHaveCount(0);

    // Resultado contestado não altera a tabela.
    expect(await standings(page)).toEqual(before);
    await dismissToasts(page);

    // 4. Mensagem com anexo.
    await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Segue também o histórico de batalhas do jogo.');
    await page.getByLabel('Anexos (opcional)').setInputFiles(image('historico.png'));
    await expect(page.getByRole('img', { name: 'Anexo 1' })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(events).toHaveCount(3);
    await expect(events.nth(2)).toContainText('Participante');
    await expect(events.nth(2)).toContainText('Segue também o histórico de batalhas do jogo.');
    await expect(page.getByRole('textbox', { name: 'Mensagem', exact: true })).toHaveValue('');
    await expectNoHorizontalScroll(page);

    // 5. A Bianca é avisada e a partida aparece em disputa, com o link.
    await visitAs(page, 'u_bianca', LIGA);
    await expect(card(page, m.matchId)).toHaveAttribute('data-status', 'DISPUTED');
    await expect(card(page, m.matchId)).toContainText('Resultado em disputa');
    await expect(card(page, m.matchId).getByRole('link', { name: 'Acompanhar a disputa' })).toHaveAttribute('href', disputeUrl);
    await page.getByRole('button', { name: /^Notificações/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notificações' })).toContainText('Seu resultado foi contestado');
    await page.keyboard.press('Escape');

    // 6. A organizadora responde e escala para a administração.
    await visitAs(page, 'u_camila', disputeUrl);
    await expect(page.getByRole('heading', { level: 2, name: 'Decisão' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Mensagem', exact: true }).fill('Os dois prints parecem verdadeiros. Vou pedir a análise da administração.');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(events.nth(3)).toContainText('Organização');
    await dismissToasts(page);
    await page.getByRole('button', { name: 'Escalar para a administração' }).click();
    await page.getByRole('dialog', { name: 'Escalar para a administração' }).getByRole('button', { name: 'Escalar disputa' }).click();
    await expect(main.getByText('Escalada', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resolver disputa' })).toHaveCount(0);
    await expect(page.getByText('Você escalou esta disputa')).toBeVisible();
    expect(await standings(page)).toEqual(before);

    // 7. A Admin resolve lançando o resultado correto.
    await visitAs(page, 'u_ana', disputeUrl);
    await expect(main.getByText('Escalada', { exact: true })).toBeVisible();
    await dismissToasts(page);
    await page.getByRole('button', { name: 'Resolver disputa' }).click();
    const resolve = page.getByRole('dialog', { name: 'Resolver disputa' });
    await expect(resolve.getByRole('radio', { name: /Manter o resultado enviado/ })).toBeChecked();
    await resolve.getByRole('radio', { name: /Lançar o resultado correto/ }).check();
    await resolve.getByLabel('Placar de Bianca').fill('0');
    await resolve.getByLabel(`Placar de ${m.opponentName}`).fill('2');
    // Sem a decisão por escrito não resolve.
    await resolve.getByRole('button', { name: 'Resolver disputa' }).click();
    await expect(resolve.getByText('Descreva a decisão')).toBeVisible();
    await resolve.getByLabel('Decisão').fill('O histórico de batalhas confirma 2 a 0 para o adversário. Resultado corrigido.');
    await expectNoHorizontalScroll(page);
    await resolve.getByRole('button', { name: 'Resolver disputa' }).click();
    await expect(resolve).toHaveCount(0);

    await expect(main.getByText('Resolvida', { exact: true })).toBeVisible();
    const last = events.last();
    await expect(last).toContainText('Disputa resolvida');
    await expect(last).toContainText('O histórico de batalhas confirma 2 a 0 para o adversário.');
    await expect(last).toContainText('Resultado oficial:');
    await expect(last).toContainText('Bianca 0');
    // Encerrada: sem caixa de mensagem nem ações.
    await expect(page.getByRole('textbox', { name: 'Mensagem', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Resolver disputa' })).toHaveCount(0);

    // Agora sim a tabela mudou, e a auditoria registrou a decisão.
    expect(await standings(page)).not.toEqual(before);
    const audit = await page.evaluate((key) => ((JSON.parse(localStorage.getItem(key) ?? '{}') as { extra: { auditLogs: { action: string; actorId: string; after: Record<string, unknown> | null }[] } }).extra.auditLogs ?? []).filter((l) => l.action === 'DISPUTE_RESOLVED' || l.action === 'RESULT_ENTERED'), DB_KEY);
    expect(audit.find((l) => l.action === 'DISPUTE_RESOLVED')).toMatchObject({ actorId: 'u_ana', after: { status: 'RESOLVED', resultadoLancado: true } });
    expect(audit.find((l) => l.action === 'RESULT_ENTERED')?.after).toMatchObject({ origem: 'DISPUTE' });

    // 8. Para a Bianca: partida concluída com o resultado corrigido e aviso da resolução.
    await visitAs(page, 'u_bianca', LIGA);
    await expect(card(page, m.matchId)).toHaveAttribute('data-status', 'VALIDATED');
    await expect(card(page, m.matchId).getByRole('button', { name: 'Enviar resultado' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Notificações/ }).click();
    await expect(page.getByRole('dialog', { name: 'Notificações' })).toContainText('Disputa resolvida');
    await page.getByRole('dialog', { name: 'Notificações' }).getByRole('button', { name: /Disputa resolvida/ }).click();
    // Navegação pelo roteador: no servidor de desenvolvimento a rota pode recompilar antes de trocar.
    await expect(page).toHaveURL(new RegExp(`${disputeUrl}$`), { timeout: 60_000 });
    await expect(main.getByText('Resolvida', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('adversário confirma pela partida; quem não joga não vê ações nem acessa a disputa', async ({ page }) => {
    await visitAs(page, 'u_bianca', LIGA);
    const m = await biancaMatch(page);
    await card(page, m.matchId).getByRole('button', { name: 'Enviar resultado' }).click();
    const send = page.getByRole('dialog', { name: 'Enviar resultado' });
    await send.getByLabel('Placar de Bianca (você)').fill('2');
    await send.getByLabel(`Placar de ${m.opponentName}`).fill('0');
    await send.getByLabel('Print do resultado').setInputFiles(image('placar.png'));
    await expect(send.getByRole('img', { name: 'Anexo 1' })).toBeVisible();
    await send.getByRole('button', { name: 'Enviar resultado' }).click();
    await expect(send).toHaveCount(0);

    // Outro jogador do campeonato vê a partida, sem ações de resultado.
    await visitAs(page, 'u_camila', LIGA);
    await expect(card(page, m.matchId)).toHaveAttribute('data-status', 'AWAITING_VALIDATION');
    await expect(card(page, m.matchId).getByTestId('match-result-actions')).toHaveCount(0);

    await visitAs(page, m.opponent, LIGA);
    await dismissToasts(page);
    await card(page, m.matchId).getByRole('button', { name: 'Confirmar' }).click();
    await expect(card(page, m.matchId)).toContainText('Os dois lados concordam com');
    await expect(card(page, m.matchId)).toContainText('Aguardando a validação da organização.');
    await expect(card(page, m.matchId).getByRole('button', { name: 'Confirmar' })).toHaveCount(0);

    // Ainda não é oficial: a organização valida (fila do organizador).
    const queue = await (async () => {
      await loginAs(page, 'u_camila');
      return apiCall<{ id: string; status: string }[]>(page, 'GET', '/tournaments/tn_liga_cr/submissions');
    })();
    expect(queue.data.map((s) => s.status)).toEqual(['CONFIRMED']);

    // Disputa inexistente e disputa de outra partida.
    await visitAs(page, 'u_lucas', '/disputas/dp_nao_existe');
    await expect(page.getByRole('heading', { name: 'Disputa não encontrada' })).toBeVisible();
  });
});

test.describe('perfil competitivo', () => {
  test('o perfil público da Bianca mostra números por jogo, conquistas e campeonatos', async ({ page }) => {
    await page.goto('/u/Bianca');
    await waitForApp(page);
    const history = page.getByRole('region', { name: 'Histórico competitivo' });
    await expect(history).toBeVisible();

    const pool = history.getByRole('article', { name: 'Estatísticas em 8 Ball Pool' });
    for (const [label, value] of [['Campeonatos', '1'], ['Títulos', '1'], ['Partidas', '3'], ['Vitórias', '3'], ['Aproveitamento', '100%'], ['Placar somado', '6']] as const) {
      await expect(pool.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last()).toContainText(value);
    }
    const royale = history.getByRole('article', { name: 'Estatísticas em Clash Royale' });
    await expect(royale).toContainText('Títulos');
    await expect(royale.locator('div').filter({ has: page.getByText('Partidas', { exact: true }) }).last()).toContainText('1');

    const achievements = history.getByRole('list', { name: 'Conquistas' });
    await expect(achievements.getByRole('listitem')).toHaveCount(2);
    await expect(achievements).toContainText('Campeão');
    await expect(achievements).toContainText('Primeiro campeonato');
    await expect(achievements).toContainText('Open 8 Ball Pool');

    const played = history.getByRole('list', { name: 'Campeonatos disputados' }).getByRole('listitem');
    await expect(played).toHaveCount(2);
    await expect(played.nth(0)).toContainText('Liga Semanal Clash Royale 1v1');
    await expect(played.nth(0)).toContainText('Em andamento');
    await expect(played.nth(1)).toContainText('Open 8 Ball Pool');
    await expect(played.nth(1)).toContainText('1º lugar');
    await expect(played.nth(1).getByRole('link', { name: 'Open 8 Ball Pool' })).toHaveAttribute('href', '/c/open-8-ball-pool');
    await expectNoHorizontalScroll(page);
  });

  test('quem ainda não disputou campeonatos vê o estado vazio com ação sugerida', async ({ page }) => {
    await page.goto('/u/Lucas');
    await waitForApp(page);
    const history = page.getByRole('region', { name: 'Histórico competitivo' });
    await expect(history.getByRole('heading', { name: 'Ainda sem campeonatos disputados' })).toBeVisible();
    await expect(history.getByRole('link', { name: 'Ver campeonatos abertos' })).toHaveAttribute('href', '/campeonatos?status=open');
    await expectNoHorizontalScroll(page);
  });
});
