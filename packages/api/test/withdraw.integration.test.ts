/**
 * Desistência, desclassificação, substituição e chave regerada contra um Postgres de verdade — issue #100 (RN-05,
 * RN-06, RN-07). Critérios de aceite: desistência no meio do mata-mata dá W.O. ao adversário e a chave segue
 * consistente; desistência em grupo/BR não quebra a tabela. Porta de "desistência e desclassificação" de
 * `apps/web/mocks/competition.test.ts`.
 */
import { Bracket, Match, Registration, ResultEvent, Standings } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BR_RULES, BR_TB, DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('desistência, desclassificação e substituição (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;
  let cr: Awaited<ReturnType<Harness['game']>>;

  const bracketOf = async (stageId: string, who = 'dono') => Bracket.parse((await h.call(who, `/stages/${stageId}/bracket`)).data);
  const put = (m: { id: string }, body: unknown) => h.call('dono', `/matches/${m.id}/result`, { method: 'PUT', body });
  const withdraw = (who: string | null, regId: string, kind: 'WITHDRAWN' | 'DISQUALIFIED', reason = 'Uso de hack') => h.call(who, `/registrations/${regId}/withdraw`, { method: 'POST', body: { kind, reason } });

  async function startedSingleElim(players: string[]) {
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    const regs = await h.register(t.id, players.map((p) => ({ user: p })));
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);
    return { t, sid, regs };
  }

  beforeAll(async () => {
    h = await createHarness(url as string, 'wd');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('outro', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('mod', ['PARTICIPANT']);
    await h.user('adm', ['ADMIN', 'PARTICIPANT']);
    for (let i = 1; i <= 9; i += 1) await h.user(`p${i}`, ['PARTICIPANT']);
    cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
  }, 120_000);
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('desclassificar no meio do mata-mata dá W.O. ao adversário; moderador e outros não podem; fica na auditoria e no histórico', async () => {
    const { t, sid, regs } = await startedSingleElim(['p1', 'p2', 'p3', 'p4']);
    // Quartas... aqui: as semifinais da rodada 1; a 1ª vai para a final.
    const round1 = (await bracketOf(sid)).matches.filter((m) => m.round === 1);
    const [semi1, semi2] = round1 as [Match, Match];
    const [w] = semi1.participants;
    await put(semi1, { entries: [{ registrationId: w?.registrationId, score: 2 }, { registrationId: semi1.participants[1]?.registrationId, score: 0 }] });
    const [loser, winner] = semi2.participants;

    expect((await withdraw(null, loser?.registrationId as string, 'DISQUALIFIED')).status).toBe(401);
    expect((await withdraw('p1', loser?.registrationId as string, 'DISQUALIFIED')).status).toBe(403);
    expect((await withdraw('mod', loser?.registrationId as string, 'DISQUALIFIED')).status).toBe(403);
    expect((await withdraw('outro', loser?.registrationId as string, 'DISQUALIFIED')).status).toBe(403);
    expect((await withdraw('dono', '00000000-0000-0000-0000-000000000000', 'DISQUALIFIED')).status).toBe(404);
    expect((await withdraw('dono', loser?.registrationId as string, 'DISQUALIFIED', 'x')).code).toBe('VALIDATION');
    const res = await withdraw('dono', loser?.registrationId as string, 'DISQUALIFIED');
    expect(res.status, res.detail).toBe(200);
    expect(Registration.parse(res.data)).toMatchObject({ status: 'DISQUALIFIED', statusReason: 'Uso de hack' });

    const after = await bracketOf(sid);
    const match = after.matches.find((m) => m.id === semi2.id) as Match;
    expect(match.status).toBe('WALKOVER');
    expect(match.participants.find((p) => p.registrationId === winner?.registrationId)?.isWinner).toBe(true);
    // A chave segue consistente: o vencedor do W.O. está na final, pronta para jogar.
    const final = after.matches.find((m) => m.round === 2) as Match;
    expect(final.participants.map((p) => p.registrationId).sort()).toEqual([w?.registrationId, winner?.registrationId].sort());
    expect(final.waitingPrevious).toBe(false);
    const log = await h.db.auditLog.findFirstOrThrow({ where: { action: 'ENTRANT_DISQUALIFIED', entityId: loser?.registrationId as string } });
    expect(log.reason).toBe('Uso de hack');
    const events = z.array(ResultEvent).parse((await h.call(null, `/matches/${semi2.id}/events`)).data);
    expect(events[0]).toMatchObject({ type: 'WALKOVER', reason: 'Uso de hack' });
    const loserUser = regs.indexOf(loser?.registrationId as string) + 1;
    expect(await h.notificationsOf(`p${loserUser}`)).toContain('Você foi desclassificado');
    expect((await withdraw('dono', loser?.registrationId as string, 'DISQUALIFIED')).code).toBe('REGISTRATION_NOT_ACTIVE');
    expect(t.id).toBeTruthy();
  });

  it('desistência: o próprio inscrito (ou a organização) registra; ninguém mais', async () => {
    const { sid, regs } = await startedSingleElim(['p5', 'p6', 'p7', 'p8']);
    const mine = regs[0] as string;
    expect((await withdraw('p6', mine, 'WITHDRAWN', 'Não posso jogar')).status).toBe(403);
    expect((await withdraw('mod', mine, 'WITHDRAWN', 'Não posso jogar')).status).toBe(403);
    // Participante não desclassifica ninguém, nem a si mesmo.
    expect((await withdraw('p5', mine, 'DISQUALIFIED', 'Não posso jogar')).status).toBe(403);
    const res = await withdraw('p5', mine, 'WITHDRAWN', 'Não posso jogar');
    expect(res.status, res.detail).toBe(200);
    expect(await h.auditCount({ action: 'ENTRANT_WITHDRAWN', entityId: mine })).toBe(1);
    const m = (await bracketOf(sid)).matches.find((x) => x.round === 1 && x.participants.some((p) => p.registrationId === mine)) as Match;
    expect(m.status).toBe('WALKOVER');
    // E a organização registra a desistência de outro (sem ser o inscrito).
    expect((await withdraw('dono', regs[1] as string, 'WITHDRAWN', 'Avisou no Discord')).status).toBe(200);
  });

  it('desistência em pontos corridos: com menos da metade jogada, os resultados são anulados e a tabela não quebra', async () => {
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Liga', format: 'ROUND_ROBIN', model: 'coroas', config: { bestOf: 1 }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    const regs = await h.register(t.id, [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    const played = (await bracketOf(sid)).matches.find((m) => m.participants.some((p) => p.registrationId === regs[0])) as Match;
    const other = played.participants.find((p) => p.registrationId !== regs[0])?.registrationId as string;
    await put(played, { entries: [{ registrationId: regs[0], score: 1 }, { registrationId: other, score: 0 }] });
    expect((await withdraw('dono', regs[0] as string, 'WITHDRAWN', 'Saiu do time')).status).toBe(200);
    const res = await h.call(null, `/stages/${sid}/standings`);
    expect(res.status).toBe(200);
    const table = Standings.parse(res.data).overall;
    expect(table).toHaveLength(4);
    expect(table.find((r) => r.registrationId === regs[0])).toMatchObject({ status: 'WITHDRAWN', points: 0 });
    // O resultado anulado sai da tabela de quem tinha jogado contra ele, e fica no histórico como revertido.
    expect(table.find((r) => r.registrationId === other)?.played).toBe(0);
    const events = z.array(ResultEvent).parse((await h.call(null, `/matches/${played.id}/events`)).data);
    expect(events.map((e) => e.type)).toEqual(['REVERTED', 'ENTERED']);
    expect(Match.parse((await h.call(null, `/matches/${played.id}`)).data).status).toBe('CANCELLED');
  });

  it('desclassificação em Battle Royale zera os pontos e reordena a tabela (RN-05); as quedas seguintes continuam', async () => {
    const ff = await h.game('BATTLE_ROYALE', [{ name: 'padrao', rules: BR_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: ff, stages: [{ name: 'Quedas', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 2, lobbySize: 12 }, tiebreakers: BR_TB, seeding: 'RANKED' }] });
    const [a, b, c] = await h.register(t.id, [{ name: 'Alfa' }, { name: 'Bravo' }, { name: 'Charlie' }]);
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    const [q1, q2] = (await bracketOf(sid)).matches as [Match, Match];
    await put(q1, { entries: [{ registrationId: a, placement: 1, kills: 9 }, { registrationId: b, placement: 2, kills: 1 }, { registrationId: c, placement: 3, kills: 0 }] });
    expect((await withdraw('dono', a as string, 'DISQUALIFIED', 'Conta compartilhada')).status).toBe(200);
    const table = Standings.parse((await h.call(null, `/stages/${sid}/standings`)).data).overall;
    expect(table.find((r) => r.registrationId === a)).toMatchObject({ status: 'DISQUALIFIED', points: 0 });
    expect(table[0]?.registrationId).toBe(b);
    // A queda seguinte é lançada só com quem segue no campeonato.
    const next = await put(q2, { entries: [{ registrationId: b, placement: 1, kills: 2 }, { registrationId: c, placement: 2, kills: 3 }] });
    expect(next.status, next.detail).toBe(200);
  });

  it('substituição pela lista de espera antes da confirmação: o substituto entra no mesmo lugar da prévia (RN-06)', async () => {
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 1 }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    const regs = await h.register(t.id, [{ user: 'p1' }, { user: 'p2' }, { user: 'p3' }, { user: 'p4' }]);
    // Vagas cheias: o da lista de espera só entra por substituição.
    await h.db.tournament.update({ where: { id: t.id }, data: { maxParticipants: 4 } });
    const waiting = await h.db.registration.create({ data: { tournamentId: t.id, userId: h.id('p9'), status: 'WAITLIST' } });
    const sid = t.stageIds[0] as string;
    const preview = Bracket.parse((await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } })).data);
    const slotOf = (b: Bracket, regId: string) => b.matches.find((m) => m.participants.some((p) => p.registrationId === regId));
    const before = slotOf(preview, regs[2] as string) as Match;

    const res = await h.call('dono', `/registrations/${regs[2]}`, { method: 'PATCH', body: { action: 'replace', withRegistrationId: waiting.id } });
    expect(res.status, res.detail).toBe(200);
    const after = await bracketOf(sid);
    expect(after.state).toBe('PREVIEW');
    expect(after.entrants.some((e) => e.registrationId === regs[2])).toBe(false);
    const now = slotOf(after, waiting.id) as Match;
    expect(now.nodeId).toBe(before.nodeId);
    expect(now.participants.findIndex((p) => p.registrationId === waiting.id)).toBe(before.participants.findIndex((p) => p.registrationId === regs[2]));
    expect(after.entrants.find((e) => e.registrationId === waiting.id)?.name).toContain('wdp9');
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);
    // Com a fase em andamento não há mais substituição.
    const late = await h.call('dono', `/registrations/${regs[3]}`, { method: 'PATCH', body: { action: 'replace', withRegistrationId: regs[0] } });
    expect(late.code).toBe('TOURNAMENT_STARTED');
  });

  it('quem foi removido depois da prévia entra como desistente na confirmação: W.O. para o adversário; regerar antes de começar descarta a prévia', async () => {
    const t = await h.tournament({ owner: 'dono', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 1 }, tiebreakers: DUEL_TB, seeding: 'RANDOM' }] });
    const regs = await h.register(t.id, [{ name: 'Um' }, { name: 'Dois' }, { name: 'Três' }, { name: 'Quatro' }]);
    const sid = t.stageIds[0] as string;
    const first = Bracket.parse((await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'primeira' } })).data);
    // RN-07: regerar antes da 1ª partida concluída descarta a anterior, com nova seed e auditoria (seed antiga e nova).
    const second = Bracket.parse((await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).data);
    expect(second.seedUsed).not.toBe(first.seedUsed);
    const log = await h.db.auditLog.findFirstOrThrow({ where: { action: 'BRACKET_GENERATED', entityId: sid }, orderBy: { createdAt: 'desc' } });
    expect(log.before).toMatchObject({ seed: 'primeira' });

    expect((await h.call('dono', `/registrations/${regs[1]}`, { method: 'PATCH', body: { action: 'remove', reason: 'Não apareceu no grupo' } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);
    const confirmed = await bracketOf(sid);
    const m = confirmed.matches.find((x) => x.round === 1 && x.participants.some((p) => p.registrationId === regs[1])) as Match;
    expect(m.status).toBe('WALKOVER');
    expect(m.participants.find((p) => p.registrationId !== regs[1])?.isWinner).toBe(true);
    expect(z.array(ResultEvent).parse((await h.call(null, `/matches/${m.id}/events`)).data)[0]?.type).toBe('WALKOVER');
  });
});
