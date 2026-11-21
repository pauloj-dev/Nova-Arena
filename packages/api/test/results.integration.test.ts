/**
 * Resultados, histórico e classificação contra um Postgres de verdade (`TEST_DATABASE_URL`) — issues #85, #86 e #87.
 * Porta dos casos de `apps/web/mocks/competition.test.ts` ("resultados") para a API real, mais CT-01, CT-05 e CT-08.
 */
import { Bracket, ImportResultsResult, Match, ResultEvent, Standings, SubmitResultResponse } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BR_RULES, BR_TB, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('resultados, histórico e classificação (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;
  let tournamentId = '';
  let stageId = '';
  let regs: string[] = [];
  let bracket: Bracket;
  let ffGame: Awaited<ReturnType<Harness['game']>>;

  const getBracket = async () => Bracket.parse((await h.call('dono', `/stages/${stageId}/bracket`)).data);
  const standings = async (who: string | null = null, query = '') => Standings.parse((await h.call(who, `/stages/${stageId}/standings${query}`)).data);
  const drops = () => bracket.matches.filter((m) => m.kind === 'LOBBY');
  /** Queda `q` do grupo `g` (ids do motor: `g1-q1`…); o grupo 1 é o do jogador (seed 1). */
  const dropOf = (g: number, q: number) => bracket.matches.find((m) => m.nodeId === `g${g}-q${q}`) as Match;
  const entriesOf = (m: Match, kills = (i: number) => m.participants.length - i, order?: number[]) =>
    m.participants.map((p, i) => ({ registrationId: p.registrationId as string, placement: order ? (order[i] as number) : i + 1, kills: kills(i) }));
  const put = (who: string | null, m: { id: string }, payload: unknown, headers?: Record<string, string>) => h.call(who, `/matches/${m.id}/result`, { method: 'PUT', body: payload, ...(headers ? { headers } : {}) });

  beforeAll(async () => {
    h = await createHarness(url as string, 'rs');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('outro', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('mod', ['PARTICIPANT']);
    await h.user('adm', ['ADMIN', 'PARTICIPANT']);
    await h.user('jog', ['PARTICIPANT']);
    await h.user('fora', ['PARTICIPANT']);
    ffGame = await h.game('BATTLE_ROYALE', [
      { name: 'padrao', rules: BR_RULES },
      { name: 'liga', rules: [{ type: 'PER_UNIT', stat: 'kills', points: 1 }, { type: 'TABLE', stat: 'placement', table: { '1': 12, '2': 9, '3': 8 } }] },
      { name: 'duelo', matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }] },
    ]);
    const t = await h.tournament({
      owner: 'dono',
      game: ffGame,
      stages: [{ name: 'Fase de grupos', format: 'GROUPS', model: 'padrao', config: { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }, qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, tiebreakers: BR_TB }],
    });
    tournamentId = t.id;
    stageId = t.stageIds[0] as string;
    await h.staff(tournamentId, 'mod', 'MODERATOR', 'dono');
    regs = await h.register(tournamentId, [{ user: 'jog' }, ...Array.from({ length: 11 }, (_, i) => ({ name: `Squad ${String.fromCharCode(65 + i)}` }))]);
    expect((await h.call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANKED' } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${stageId}/confirm`, { method: 'POST' })).status).toBe(200);
    bracket = await getBracket();
    expect(drops()).toHaveLength(12);
  }, 120_000);
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('ao confirmar, avisa os inscritos e publica chave e tabela no tempo real', async () => {
    expect(await h.notificationsOf('jog')).toContain('A chave saiu!');
    expect(h.realtime.events.some((e) => e.channel === `tournament:${tournamentId}` && e.event.type === 'bracket.updated')).toBe(true);
  });

  it('CT-01: os pontos são calculados no servidor (kill 1, Booyah 3); "points" do cliente é ignorado', async () => {
    const drop = dropOf(2, 1);
    const [alfa, bravo, charlie] = drop.participants.map((p) => p.registrationId as string);
    h.realtime.events.length = 0;
    const res = await put('dono', drop, { entries: [{ registrationId: alfa, placement: 1, kills: 7 }, { registrationId: bravo, placement: 2, kills: 9 }, { registrationId: charlie, placement: 3, kills: 4 }] });
    expect(res.status, res.detail).toBe(200);
    const parsed = SubmitResultResponse.parse(res.data);
    expect(parsed.results.map((r) => r.points)).toEqual([10, 9, 4]);
    expect(parsed.results[0]?.breakdown.map((b) => b.points)).toEqual([7, 3]);
    expect(parsed.match.status).toBe('VALIDATED');
    // A projeção guarda os pontos calculados pelo motor (RN-01).
    expect((await h.db.matchParticipant.findMany({ where: { matchId: drop.id }, orderBy: { slot: 'asc' } })).map((p) => Number(p.points))).toEqual([10, 9, 4]);
    // Tempo real: só o que mudou, depois do commit.
    const types = h.realtime.events.filter((e) => e.channel === `tournament:${tournamentId}`).map((e) => e.event.type);
    expect(types).toEqual(expect.arrayContaining(['match.updated', 'bracket.updated', 'standings.updated']));

    const second = dropOf(2, 2);
    const cheat = await put('dono', second, { entries: second.participants.map((p, i) => ({ registrationId: p.registrationId, placement: i + 1, kills: 0, points: 999 })) });
    expect(SubmitResultResponse.parse(cheat.data).results.map((r) => r.points)).toEqual([3, 0, 0]);
  });

  it('colocação repetida e kills negativas = 400; participante e outro organizador = 403; visitante = 401', async () => {
    const drop = dropOf(2, 3);
    const ids = drop.participants.map((p) => p.registrationId as string);
    const repeated = await put('dono', drop, { entries: ids.map((id) => ({ registrationId: id, placement: 1, kills: 0 })) });
    expect(repeated.status).toBe(400);
    const negative = await put('dono', drop, { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: -1 })) });
    expect(negative.status).toBe(400);
    expect(negative.code).toBe('VALIDATION');
    const intruder = await put('dono', drop, { entries: [{ registrationId: regs.find((r) => !ids.includes(r)) as string, placement: 1, kills: 0 }] });
    expect(intruder.code).toBe('INVALID_RESULT');
    const ok = { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: 0 })) };
    expect((await put(null, drop, ok)).status).toBe(401);
    expect((await put('jog', drop, ok)).status).toBe(403);
    expect((await put('fora', drop, ok)).status).toBe(403);
    expect((await put('outro', drop, ok)).status).toBe(403);
    // Moderador do campeonato lança; dono e Admin corrigem (com motivo).
    expect((await put('mod', drop, ok)).status).toBe(200);
    expect((await put('adm', drop, { ...ok, correctionReason: 'Conferido com a transmissão' })).status).toBe(200);
    expect((await put('dono', drop, { ...ok, correctionReason: 'Conferido de novo' })).status).toBe(200);
    expect((await h.call(null, `/matches/00000000-0000-0000-0000-000000000000/result`, { method: 'PUT', body: ok })).status).toBe(404);
  });

  it('a mesma Idempotency-Key não grava duas vezes (e devolve a mesma resposta)', async () => {
    const drop = dropOf(3, 1);
    const payload = { entries: entriesOf(drop, () => 2) };
    const first = await put('dono', drop, payload, { 'Idempotency-Key': 'chave-abc' });
    const second = await put('dono', drop, payload, { 'Idempotency-Key': 'chave-abc' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.data).toEqual(first.data);
    expect(await h.auditCount({ action: 'RESULT_ENTERED', entityId: drop.id })).toBe(1);
    expect(await h.db.resultEvent.count({ where: { matchId: drop.id } })).toBe(1);
    // Outra chave = outra requisição: agora é correção e exige motivo.
    expect((await put('dono', drop, payload, { 'Idempotency-Key': 'chave-xyz' })).code).toBe('CORRECTION_REASON_REQUIRED');
  });

  it('CT-08: corrigir exige motivo, recalcula a tabela, fica na auditoria e no histórico (com autor e valores anteriores)', async () => {
    // Um grupo ainda sem nenhum resultado (e que não é o do jogador, usado no teste das kills).
    bracket = await getBracket();
    const drop = dropOf(4, 1);
    expect(drop.participants.some((p) => p.registrationId === regs[0])).toBe(false);
    const ids = drop.participants.map((p) => p.registrationId as string);
    expect((await put('dono', drop, { entries: ids.map((id, i) => ({ registrationId: id, placement: i + 1, kills: 0 })) })).status).toBe(200);
    const groupOf = (s: Standings) => s.groups.find((g) => g.rows.some((r) => r.registrationId === ids[0]));
    const before = await standings();
    expect(groupOf(before)?.rows[0]?.registrationId).toBe(ids[0]);
    const atBefore = new Date();
    await new Promise((r) => setTimeout(r, 20));

    const corrected = { entries: ids.map((id, i) => ({ registrationId: id, placement: ids.length - i, kills: 0 })) };
    const missing = await put('dono', drop, corrected);
    expect(missing.status).toBe(400);
    expect(missing.code).toBe('CORRECTION_REASON_REQUIRED');
    expect((await put('dono', drop, { ...corrected, correctionReason: 'Print estava invertido' })).status).toBe(200);

    const after = await standings();
    expect(groupOf(after)?.rows[0]?.registrationId).toBe(ids[ids.length - 1]);
    const log = await h.db.auditLog.findFirstOrThrow({ where: { action: 'RESULT_CORRECTED', entityId: drop.id } });
    expect(log.reason).toBe('Print estava invertido');
    expect(log.before).not.toBeNull();
    expect(log.actorId).toBe(h.id('dono'));
    // Tabela `standings` regravada junto.
    const persisted = await h.db.standing.findFirstOrThrow({ where: { stageId, registrationId: ids[ids.length - 1] } });
    expect(persisted.position).toBe(1);

    // Linha do tempo (#86): pública, do mais novo ao mais antigo, com autor e motivo.
    const events = z.array(ResultEvent).parse((await h.call(null, `/matches/${drop.id}/events`)).data);
    expect(events.map((e) => e.type)).toEqual(['CORRECTED', 'ENTERED']);
    expect(events[0]).toMatchObject({ reason: 'Print estava invertido', actorNickname: expect.stringContaining('rsdono') });
    const stored = await h.db.resultEvent.findFirstOrThrow({ where: { matchId: drop.id, type: 'CORRECTED' } });
    expect((stored.before as { result: { entries: unknown[] } }).result.entries).toHaveLength(ids.length);
    // O histórico é somente inserção: o banco recusa apagar ou alterar.
    await expect(h.db.resultEvent.deleteMany({ where: { matchId: drop.id } })).rejects.toThrow();
    await expect(h.db.resultEvent.updateMany({ where: { matchId: drop.id }, data: { reason: 'x' } })).rejects.toThrow();

    // Reconstituir a tabela num instante passado (#86): antes da correção, o 1º do grupo era o de antes.
    const past = await standings(null, `?at=${atBefore.toISOString()}`);
    expect(groupOf(past)?.rows[0]?.registrationId).toBe(ids[0]);
    expect((await h.call(null, `/stages/${stageId}/standings?at=ontem`)).code).toBe('INVALID_DATE');
  });

  it('kills por jogador (RN-03): a soma precisa bater com a da equipe; o MVP sai delas', async () => {
    bracket = await getBracket();
    const drop = dropOf(1, 1);
    expect(drop.status).not.toBe('VALIDATED');
    const entries = entriesOf(drop, () => 4);
    const mine = entries.find((e) => e.registrationId === regs[0]) as (typeof entries)[number];
    const wrong = await put('dono', drop, { entries: entries.map((e) => (e === mine ? { ...e, playerKills: { [h.id('jog')]: 3 } } : e)) });
    expect(wrong.code).toBe('PLAYER_KILLS_MISMATCH');
    const stranger = await put('dono', drop, { entries: entries.map((e) => (e === mine ? { ...e, playerKills: { [h.id('fora')]: 4 } } : e)) });
    expect(stranger.code).toBe('INVALID_RESULT');
    const ok = await put('dono', drop, { entries: entries.map((e) => (e === mine ? { ...e, playerKills: { [h.id('jog')]: 4 } } : e)) });
    expect(ok.status, ok.detail).toBe(200);
    const match = Match.parse((await h.call(null, `/matches/${drop.id}`)).data);
    expect(match.participants.find((p) => p.registrationId === regs[0])?.playerKills).toEqual({ [h.id('jog')]: 4 });
    expect((await standings()).mvp[0]).toMatchObject({ userId: h.id('jog'), kills: 4 });
  });

  it('importação em lotes: cada resultado passa pela mesma regra; os que falham voltam com o motivo', async () => {
    const pending = drops().filter((m) => m.participants.every((p) => p.points === null));
    bracket = await getBracket();
    const open = bracket.matches.filter((m) => m.kind === 'LOBBY' && m.status !== 'VALIDATED');
    expect(open.length).toBeGreaterThan(2);
    const [a, b] = open as [Match, Match];
    const done = bracket.matches.find((m) => m.status === 'VALIDATED') as Match;
    const batch = { results: [{ matchId: a.id, entries: entriesOf(a) }, { matchId: b.id, entries: entriesOf(b) }, { matchId: done.id, entries: entriesOf(done) }, { matchId: '00000000-0000-0000-0000-000000000000', entries: entriesOf(a) }] };
    expect((await h.call('jog', `/tournaments/${tournamentId}/results/import`, { method: 'POST', body: batch })).status).toBe(403);
    expect((await h.call(null, `/tournaments/${tournamentId}/results/import`, { method: 'POST', body: batch })).status).toBe(401);
    const tooMany = { results: Array.from({ length: 51 }, () => ({ matchId: a.id, entries: entriesOf(a) })) };
    expect((await h.call('dono', `/tournaments/${tournamentId}/results/import`, { method: 'POST', body: tooMany })).code).toBe('VALIDATION');
    const res = await h.call('mod', `/tournaments/${tournamentId}/results/import`, { method: 'POST', body: batch });
    expect(res.status).toBe(200);
    const result = ImportResultsResult.parse(res.data);
    expect(result.applied).toBe(2);
    expect(result.errors.map((e) => e.matchId)).toEqual([done.id, '00000000-0000-0000-0000-000000000000']);
    expect(result.errors[0]?.message).toBe('Informe o motivo da correção.');
    expect((await h.db.auditLog.findFirstOrThrow({ where: { action: 'RESULT_ENTERED', entityId: a.id } })).after).toMatchObject({ origem: 'IMPORT' });
    expect(pending.length).toBeGreaterThan(0);
  });

  it('classificação: pública, em cache (`standings:{stageId}`) e nova a cada resultado', async () => {
    const first = await standings(null);
    expect(first.groups).toHaveLength(4);
    const cached = await h.cache.get<{ version: string; data: Standings }>(`standings:${stageId}`);
    expect(cached?.data).toEqual(first);
    bracket = await getBracket();
    const open = bracket.matches.find((m) => m.kind === 'LOBBY' && m.status !== 'VALIDATED') as Match;
    expect((await put('dono', open, { entries: entriesOf(open, () => 9) })).status).toBe(200);
    const next = await standings(null);
    expect(next).not.toEqual(first);
    expect(next.updatedAt >= first.updatedAt).toBe(true);
    // Rascunho: só a organização vê.
    const draft = await h.tournament({ owner: 'dono', game: ffGame, status: 'DRAFT', stages: [{ name: 'Quedas', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 2 } }] });
    expect((await h.call(null, `/stages/${draft.stageIds[0]}/standings`)).status).toBe(404);
    expect((await h.call('outro', `/stages/${draft.stageIds[0]}/standings`)).status).toBe(404);
    expect((await h.call('dono', `/stages/${draft.stageIds[0]}/standings`)).status).toBe(200);
    expect((await h.call(null, `/stages/nao-existe/standings`)).status).toBe(404);
  });

  it('troca do modelo de pontuação com a fase em andamento: recalcula tudo, com auditoria; só dono/co-organizador/Admin', async () => {
    const before = await standings();
    const body = { scoringModelId: ffGame.model('liga') };
    expect((await h.call(null, `/stages/${stageId}/scoring`, { method: 'PATCH', body })).status).toBe(401);
    expect((await h.call('jog', `/stages/${stageId}/scoring`, { method: 'PATCH', body })).status).toBe(403);
    expect((await h.call('mod', `/stages/${stageId}/scoring`, { method: 'PATCH', body })).status).toBe(403);
    expect((await h.call('outro', `/stages/${stageId}/scoring`, { method: 'PATCH', body })).status).toBe(403);
    expect((await h.call('dono', `/stages/${stageId}/scoring`, { method: 'PATCH', body: { scoringModelId: ffGame.model('duelo') } })).code).toBe('SCORING_MODEL_MISMATCH');
    const other = await h.game('BATTLE_ROYALE', [{ name: 'x', rules: BR_RULES }]);
    expect((await h.call('dono', `/stages/${stageId}/scoring`, { method: 'PATCH', body: { scoringModelId: other.model('x') } })).code).toBe('VALIDATION');
    const custom = await h.db.scoringModel.create({ data: { gameId: ffGame.id, name: 'do outro', matchType: 'BATTLE_ROYALE', rules: BR_RULES, tiebreakers: BR_TB, ownerId: h.id('outro') } });
    expect((await h.call('dono', `/stages/${stageId}/scoring`, { method: 'PATCH', body: { scoringModelId: custom.id } })).status).toBe(403);

    h.realtime.events.length = 0;
    const res = await h.call('dono', `/stages/${stageId}/scoring`, { method: 'PATCH', body });
    expect(res.status, res.detail).toBe(200);
    const after = Standings.parse(res.data);
    const pointsOf = (s: Standings, id: string) => s.overall.find((r) => r.registrationId === id)?.points;
    const leader = before.overall.find((r) => r.booyahs > 0) as Standings['overall'][number];
    // Booyah valia 3; na "liga" vale 12: a diferença é 9 por Booyah.
    expect(pointsOf(after, leader.registrationId)).toBe((leader.points ?? 0) + 9 * leader.booyahs);
    const log = await h.db.auditLog.findFirstOrThrow({ where: { action: 'STAGE_SCORING_CHANGED', entityId: stageId } });
    expect(log.after).toMatchObject({ modelo: 'liga', faseEmAndamento: true });
    expect((log.after as { partidasRecalculadas: number }).partidasRecalculadas).toBeGreaterThan(5);
    // Pontos da projeção e kills por jogador continuam (estatísticas por jogador não se perdem).
    expect(await h.db.playerStat.count({ where: { userId: h.id('jog') } })).toBe(1);
    expect(h.realtime.events.map((e) => e.event.type)).toEqual(expect.arrayContaining(['standings.updated', 'bracket.updated', 'tournament.updated']));
  });

  it('CT-05: empate em pontos no grupo é decidido pelos Booyahs', async () => {
    const t = await h.tournament({ owner: 'dono', game: ffGame, stages: [{ name: 'Quedas', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 2, lobbySize: 12 }, tiebreakers: BR_TB, seeding: 'RANKED' }] });
    const [a, b, c] = await h.register(t.id, [{ name: 'Alfa' }, { name: 'Bravo' }, { name: 'Charlie' }]);
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    const [q1, q2] = Bracket.parse((await h.call('dono', `/stages/${sid}/bracket`)).data).matches as [Match, Match];
    // Alfa: Booyah sem kill (3) + 3º (0) = 3 pts, 1 Booyah. Bravo: 2º com 2 kills + 2º com 1 kill = 3 pts, 0 Booyah.
    await put('dono', q1, { entries: [{ registrationId: a, placement: 1, kills: 0 }, { registrationId: b, placement: 2, kills: 2 }, { registrationId: c, placement: 3, kills: 0 }] });
    await put('dono', q2, { entries: [{ registrationId: a, placement: 3, kills: 0 }, { registrationId: b, placement: 2, kills: 1 }, { registrationId: c, placement: 1, kills: 1 }] });
    const table = Standings.parse((await h.call(null, `/stages/${sid}/standings`)).data).overall;
    const alfa = table.find((r) => r.registrationId === a) as Standings['overall'][number];
    const bravo = table.find((r) => r.registrationId === b) as Standings['overall'][number];
    expect(alfa.points).toBe(bravo.points);
    expect(alfa.position).toBeLessThan(bravo.position);
    expect(table[0]?.registrationId).toBe(c);
  });
});
