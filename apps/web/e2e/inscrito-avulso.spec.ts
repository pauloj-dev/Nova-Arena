import type { Page } from '@playwright/test';
import { expect, loginAs, mid, test, waitForApp } from './fixtures';

/**
 * Inscrito avulso e elenco sem conta (RN-18), em 1440 px e 360 px.
 * Seed: Arena Contra Squad 4v4 (Free Fire 4x4: 4 titulares + 1 reserva), do Diego, com inscrições abertas.
 */
test.describe.configure({ timeout: 120_000 });

const ARENA_ID = mid('tn_contra_squad');
const ARENA_STAGE = mid('tn_contra_squad_s1');
const ARENA_PUBLIC = '/c/arena-contra-squad-4v4';
const ARENA = `/organizador/campeonatos/${ARENA_ID}?aba=inscricoes`;

interface ApiMatch {
  id: string;
  kind: 'DUEL' | 'LOBBY';
  status: string;
  waitingPrevious: boolean;
  participants: { registrationId: string | null; name: string }[];
}
interface ApiBracket {
  state: string;
  complete: boolean;
  matches: ApiMatch[];
}

/** Chama a API de dentro da página (a sessão é a de quem está logado). */
async function ok<T = unknown>(page: Page, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await page.evaluate(
    async ({ path: p, init: i }) => {
      const r = await fetch(`/api/v1${p}`, { method: i?.method ?? 'GET', headers: i?.body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: i?.body === undefined ? undefined : JSON.stringify(i.body) });
      const text = await r.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // resposta sem JSON
      }
      return { status: r.status, data: data as never };
    },
    { path, init },
  );
  expect(res.status, `${init?.method ?? 'GET'} ${path} → ${JSON.stringify(res.data)}`).toBeLessThan(300);
  return res.data as T;
}
const bracketOf = (page: Page, stageId: string) => ok<ApiBracket>(page, `/stages/${stageId}/bracket`);
const pending = (bracket: ApiBracket) => bracket.matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious);
const manage = (page: Page, tab: string) => page.goto(`/organizador/campeonatos/${ARENA_ID}?aba=${tab}`);
const registrationRow = (page: Page, name: string) => page.locator('tbody tr:visible, ul[aria-label^="Inscrições de"] > li:visible').filter({ hasText: name });

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function openArena(page: Page): Promise<void> {
  await loginAs(page, 'u_diego');
  await page.goto(ARENA);
  await waitForApp(page);
}

test.describe('inscrito avulso e elenco sem conta', () => {
  test('organizador cadastra um squad à mão, com o elenco, e depois corrige e completa pelo botão Elenco', async ({ page }) => {
    await openArena(page);
    await page.getByRole('button', { name: 'Adicionar inscrito' }).click();
    const form = page.getByRole('dialog', { name: 'Adicionar squad' });
    await expect(form.getByTestId('roster-slot')).toHaveCount(5);
    await form.getByLabel('Nome do squad').fill('Squad Manual');
    await form.getByLabel('Tag').fill('manu');
    for (const [index, name] of ['Ana', 'Bia', 'Caio'].entries()) {
      const slot = form.getByTestId('roster-slot').nth(index);
      await slot.getByLabel('Nome').fill(name);
      await slot.getByLabel('ID no jogo').fill(String(1001 + index));
    }
    await expectNoHorizontalScroll(page);
    await form.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(page.getByText('Squad Manual entrou no campeonato')).toBeVisible();
    await expect(form).toHaveCount(0);

    // Entra confirmado (mesmo com a aprovação manual ligada) e mostra quantos titulares já tem.
    const row = registrationRow(page, 'Squad Manual');
    await expect(row).toContainText('Confirmada');
    await expect(row).toContainText('3 de 4 (sem conta)');

    await row.getByRole('button', { name: 'Editar o elenco do Squad Manual' }).click();
    const dialog = page.getByRole('dialog', { name: 'Elenco do Squad Manual' });
    const roster = dialog.getByRole('list', { name: 'Elenco do Squad Manual' });
    await expect(roster.getByRole('listitem')).toHaveCount(3);
    await expect(roster.getByRole('listitem').first()).toContainText('ID 1001');

    await dialog.getByLabel('Nome do jogador').fill('Dani');
    await dialog.getByRole('button', { name: 'Colocar no elenco' }).click();
    await expect(page.getByText('Dani entrou no elenco')).toBeVisible();
    await expect(roster.getByRole('listitem')).toHaveCount(4);
    // Titulares completos: o quinto entra como reserva.
    await expect(dialog.getByText('Os titulares já estão completos: o próximo jogador entra como reserva.')).toBeVisible();
    await dialog.getByLabel('Nome do jogador').fill('Banco');
    await dialog.getByRole('button', { name: 'Colocar no elenco' }).click();
    await expect(roster.getByRole('listitem').filter({ hasText: 'Banco' })).toContainText('Reserva');
    await expect(dialog.getByText(/O elenco está completo/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Corrigir os dados de Dani' }).click();
    await dialog.getByLabel('ID no jogo').fill('1004');
    await dialog.getByRole('button', { name: 'Salvar' }).click();
    await expect(roster.getByRole('listitem').filter({ hasText: 'Dani' })).toContainText('ID 1004');
    await dialog.getByRole('button', { name: 'Tirar Caio do elenco' }).click();
    await expect(roster.getByRole('listitem')).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(registrationRow(page, 'Squad Manual')).toContainText('3 de 4 (sem conta)');
  });

  test('a planilha do Free Fire 4x4 traz o elenco; linha com titular a mais fica de fora com o motivo', async ({ page }) => {
    await openArena(page);
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar inscritos por CSV' });
    await expect(dialog.getByText(/4 titulares e 1 reserva/)).toBeVisible();

    const header = 'nome;tag;contato;id_no_jogo;jogador_1;id_jogador_1;jogador_2;id_jogador_2;jogador_3;id_jogador_3;jogador_4;id_jogador_4;jogador_5;reserva_1;id_reserva_1';
    const csv = [header, 'Squad Planilha;PLAN;;;P1;2001;P2;2002;P3;2003;P4;2004;;PR;2005', 'Squad Gordo;GORD;;;G1;;G2;;G3;;G4;;G5;;', 'Squad Sem Elenco;;;;;;;;;;;;;;'].join('\r\n');
    await dialog.getByTestId('csv-input').setInputFiles({ name: 'squads.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${csv}`, 'utf8') });

    await expect(dialog.getByText(/2 linhas prontas para importar e 1 com erro/)).toBeVisible();
    await expect(dialog.getByTestId('csv-line-2')).toContainText('P1, P2, P3, P4, PR (reserva)');
    await expect(dialog.getByTestId('csv-line-3')).toContainText('Este modo tem 4 titulares por squad: o elenco ficaria com 5.');
    await expectNoHorizontalScroll(page);
    await dialog.getByRole('button', { name: 'Importar 2 inscritos' }).click();
    await expect(dialog.getByTestId('import-result')).toContainText('Inscritos criados');
    await dialog.getByRole('button', { name: 'Concluir' }).click();

    await expect(registrationRow(page, 'Squad Planilha')).toContainText('4 de 4 (sem conta)');
    await expect(registrationRow(page, 'Squad Sem Elenco')).toContainText('0 de 4 (sem conta)');
    await registrationRow(page, 'Squad Planilha').getByRole('button', { name: 'Editar o elenco do Squad Planilha' }).click();
    await expect(page.getByRole('dialog', { name: 'Elenco do Squad Planilha' }).getByRole('list', { name: 'Elenco do Squad Planilha' }).getByRole('listitem')).toHaveCount(5);
  });

  test('campeonato manual completo: squad cadastrado à mão entra na chave, vence, troca o elenco em andamento e sobe ao pódio', async ({ page }) => {
    // 1. Inscrição à mão, já com os 4 titulares (com os 3 squads confirmados da seed, a chave fecha em 4).
    await openArena(page);
    await page.getByRole('button', { name: 'Adicionar inscrito' }).click();
    const form = page.getByRole('dialog', { name: 'Adicionar squad' });
    await form.getByLabel('Nome do squad').fill('Squad Manual');
    for (const [index, name] of ['Ana', 'Bia', 'Caio', 'Dani'].entries()) {
      const slot = form.getByTestId('roster-slot').nth(index);
      await slot.getByLabel('Nome').fill(name);
      await slot.getByLabel('ID no jogo').fill(String(1001 + index));
    }
    await form.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await expect(registrationRow(page, 'Squad Manual')).toContainText('4 de 4 (sem conta)');

    // 2. Fecha as inscrições, sorteia e confirma a chave: o squad sem conta é um participante como os outros.
    await manage(page, 'fases');
    await page.getByRole('button', { name: 'Fechar inscrições' }).click();
    const generate = page.getByRole('form', { name: 'Gerar chave' });
    await generate.getByLabel(/Seed do sorteio/).fill('e2e-manual');
    await generate.getByRole('button', { name: 'Gerar chave' }).click();
    await expect(page.getByText('Prévia da chave.')).toBeVisible();
    await expect(page.getByTestId('seeding-board').getByTestId('seed-slot').filter({ hasText: 'Squad Manual' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Confirmar chave' }).click();
    await page.getByRole('dialog', { name: 'Confirmar a chave?' }).getByRole('button', { name: 'Confirmar chave' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirmar a chave?' })).toHaveCount(0);
    const started = await bracketOf(page, ARENA_STAGE);
    expect(started.state).toBe('CONFIRMED');
    // Status pela rota da organização: a pública é guardada em cache pelo navegador por alguns segundos.
    expect((await ok<{ status: string }>(page, `/organizer/tournaments/${ARENA_ID}`)).status).toBe('IN_PROGRESS');

    // 3. A organização lança o resultado da partida do squad sem conta; os pontos saem do motor.
    const mine = pending(started).find((m) => m.participants.some((p) => p.name === 'Squad Manual'));
    expect(mine, 'o Squad Manual deveria ter uma partida pronta na primeira rodada').toBeDefined();
    const rival = mine?.participants.find((p) => p.name !== 'Squad Manual')?.name as string;
    await manage(page, 'partidas');
    await page.locator(`[data-match-id="${mine?.id}"]`).getByRole('button', { name: /Lançar resultado/ }).click();
    await page.getByRole('textbox', { name: 'Jogos vencidos de Squad Manual' }).fill('2');
    await page.getByRole('textbox', { name: `Jogos vencidos de ${rival}` }).fill('0');
    await expect(page.getByTestId('score-status')).toContainText('Squad Manual vence');
    await page.getByRole('button', { name: 'Salvar resultado' }).click();
    await expect(page.getByTestId('server-points')).toContainText('Squad Manual');
    await expectNoHorizontalScroll(page);

    // 4. Com o campeonato em andamento, a organização ainda troca o elenco do squad sem conta.
    await manage(page, 'inscricoes');
    await registrationRow(page, 'Squad Manual').getByRole('button', { name: 'Editar o elenco do Squad Manual' }).click();
    const roster = page.getByRole('dialog', { name: 'Elenco do Squad Manual' });
    await roster.getByLabel('Nome do jogador').fill('Banco');
    await roster.getByRole('button', { name: 'Colocar no elenco' }).click();
    await expect(roster.getByRole('list', { name: 'Elenco do Squad Manual' }).getByRole('listitem').filter({ hasText: 'Banco' })).toContainText('Reserva');
    await page.keyboard.press('Escape');

    // 5. O resto da chave é jogado (a primeira vaga vence por 2 a 0) e o campeonato é encerrado com o pódio.
    for (let guard = 0; guard < 20; guard += 1) {
      const ready = pending(await bracketOf(page, ARENA_STAGE));
      if (ready.length === 0) break;
      for (const m of ready) {
        await ok(page, `/matches/${m.id}/result`, { method: 'PUT', body: { entries: [{ registrationId: m.participants[0]?.registrationId, score: 2 }, { registrationId: m.participants[1]?.registrationId, score: 0 }] } });
      }
    }
    expect((await bracketOf(page, ARENA_STAGE)).complete).toBe(true);
    await manage(page, 'fases');
    await page.getByRole('button', { name: 'Encerrar campeonato' }).click();
    const finish = page.getByRole('dialog', { name: 'Encerrar campeonato' });
    await expect(finish.getByLabel(/1º lugar/)).not.toHaveValue('');
    await finish.getByRole('button', { name: 'Encerrar com este pódio' }).click();
    await expect(page.getByTestId('closing-card').getByTestId('podium')).toContainText('Campeão');
    expect((await ok<{ status: string }>(page, `/organizer/tournaments/${ARENA_ID}`)).status).toBe('FINISHED');
    // O squad sem conta ficou entre os quatro e aparece na classificação final da fase.
    const standings = await ok<{ overall: { name: string }[] }>(page, `/stages/${ARENA_STAGE}/standings`);
    expect(standings.overall.map((r) => r.name)).toContain('Squad Manual');

    // 6. A página pública mostra o squad e os nomes do elenco (sem os IDs no jogo).
    await page.goto(`${ARENA_PUBLIC}?aba=inscritos`);
    await waitForApp(page);
    const members = page.getByRole('list', { name: 'Membros de Squad Manual' });
    await expect(members.getByRole('listitem')).toHaveCount(5);
    await expect(members).toContainText('Ana');
    await expect(members).toContainText('Banco');
    await expect(members).not.toContainText('1001');
    await expectNoHorizontalScroll(page);
  });
});
