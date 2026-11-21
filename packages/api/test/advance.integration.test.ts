/**
 * Avanço de fase, suíço e encerramento contra um Postgres de verdade (`TEST_DATABASE_URL`) — issue #88.
 * Critérios de aceite: CT-06 (reduzido) via API com o campeão esperado; Clash Royale 1v1 em eliminação dupla e
 * 8 Ball em suíço completos via API. Porta de "CT-06 (reduzido)" de `apps/web/mocks/competition.test.ts`.
 */
import { AdvancePreview, Bracket, Match, Podium, PodiumSuggestion, Standings } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BR_RULES, BR_TB, DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('avanço de fase e encerramento (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;

  const bracketOf = async (stageId: string) => Bracket.parse((await h.call('dono', `/stages/${stageId}/bracket`)).data);
  const put = (m: { id: string }, body: unknown) => h.call('dono', `/matches/${m.id}/result`, { method: 'PUT', body });

  /** Lança todas as quedas de uma fase BR: a ordem das vagas vira a colocação; kills decrescentes. */
  async function playLobbies(stageId: string): Promise<void> {
    const bracket = await bracketOf(stageId);
    for (const m of bracket.matches.filter((x) => x.kind === 'LOBBY')) {
      const res = await put(m, { entries: m.participants.map((p, i) => ({ registrationId: p.registrationId as string, placement: i + 1, kills: m.participants.length - i })) });
      expect(res.status, res.detail).toBe(200);
    }
  }

  /** Joga os duelos prontos até a fase terminar: a primeira vaga vence por 2 a 0 (ou 1 a 0 em jogo único). */
  async function playDuels(stageId: string, wins = 2): Promise<void> {
    for (let guard = 0; guard < 30; guard += 1) {
      const bracket = await bracketOf(stageId);
      const ready = bracket.matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious);
      if (ready.length === 0) return;
      for (const m of ready) {
        const [a, b] = m.participants;
        const res = await put(m, { entries: [{ registrationId: a?.registrationId, score: wins }, { registrationId: b?.registrationId, score: 0 }] });
        expect(res.status, res.detail).toBe(200);
      }
    }
  }

  beforeAll(async () => {
    h = await createHarness(url as string, 'av');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('outro', ['ORGANIZER', 'PARTICIPANT']);
    await h.user('mod', ['PARTICIPANT']);
    await h.user('adm', ['ADMIN', 'PARTICIPANT']);
    await h.user('fan', ['PARTICIPANT']);
    for (let i = 1; i <= 8; i += 1) await h.user(`p${i}`, ['PARTICIPANT']);
  }, 120_000);
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('CT-06 (reduzido): grupos BR → mata-mata MD3 → final BR, com avanço, pódio, conquistas e avisos', async () => {
    const ff = await h.game('BATTLE_ROYALE', [{ name: 'padrao', rules: BR_RULES }, { name: 'cs', matchType: 'TEAM_VS_TEAM', rules: [{ type: 'OUTCOME', win: 3, draw: 0, loss: 0 }] }]);
    const t = await h.tournament({
      owner: 'dono',
      game: ff,
      name: 'Copa Nova FF',
      stages: [
        { name: 'Fase de grupos', format: 'GROUPS', model: 'padrao', config: { groupCount: 4, groupMode: 'BATTLE_ROYALE', drops: 3, lobbySize: 12 }, qualification: { type: 'TOP_N_PER_GROUP', n: 2, repechage: 0 }, tiebreakers: BR_TB },
        { name: 'Mata-mata 4v4', format: 'TEAM_VS_TEAM', model: 'cs', config: { bestOf: 3 }, qualification: { type: 'WINNERS', n: 2, repechage: 0 }, tiebreakers: DUEL_TB, seeding: 'RANKED' },
        { name: 'Grande Final', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 5, lobbySize: 12 }, tiebreakers: BR_TB, seeding: 'RANKED' },
      ],
    });
    const [s1, s2, s3] = t.stageIds as [string, string, string];
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    await h.db.follow.create({ data: { userId: h.id('fan'), targetType: 'TOURNAMENT', targetId: t.id } });
    const regs = await h.register(t.id, [...[1, 2, 3, 4].map((i) => ({ user: `p${i}` })), ...Array.from({ length: 8 }, (_, i) => ({ name: `Squad ${i + 1}` }))]);
    const userOfReg = new Map([1, 2, 3, 4].map((i) => [regs[i - 1] as string, `p${i}`]));

    expect((await h.call('dono', `/stages/${s1}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'ct06' } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${s1}/confirm`, { method: 'POST' })).status).toBe(200);
    expect(await h.notificationsOf('fan')).toContain('A chave saiu!');

    // Avançar com partida pendente é recusado; só a organização (dono, co-organizador, Admin) avança.
    expect((await h.call('dono', `/stages/${s1}/advance`)).code).toBe('STAGE_INCOMPLETE');
    await playLobbies(s1);
    const table = Standings.parse((await h.call(null, `/stages/${s1}/standings`)).data);
    expect(table.groups).toHaveLength(4);
    for (const g of table.groups) {
      expect(g.rows.filter((r) => r.qualifying)).toHaveLength(2);
      expect(g.rows[0]?.booyahs).toBe(3);
      expect(g.rows[0]?.perDrop).toHaveLength(3);
    }
    for (const who of [null, 'p1', 'mod', 'outro']) expect((await h.call(who, `/stages/${s1}/advance`)).status, String(who)).toBe(who ? 403 : 401);
    const preview = AdvancePreview.parse((await h.call('dono', `/stages/${s1}/advance`)).data);
    expect(preview.qualified).toHaveLength(8);
    expect(preview.eliminated).toHaveLength(4);
    expect(preview.next.state).toBe('PREVIEW');
    // A prévia não grava nada.
    expect(Bracket.parse((await h.call('dono', `/stages/${s2}/bracket`)).data).state).toBe('NONE');
    expect((await h.call('mod', `/stages/${s1}/advance`, { method: 'POST' })).status).toBe(403);
    const advanced = await h.call('dono', `/stages/${s1}/advance`, { method: 'POST' });
    expect(advanced.status, advanced.detail).toBe(200);
    expect(AdvancePreview.parse(advanced.data).next.matches.every((m) => /^[0-9a-f-]{36}$/.test(m.id))).toBe(true);
    expect((await h.call('dono', `/stages/${s1}/advance`, { method: 'POST' })).code).toBe('ALREADY_ADVANCED');
    expect(h.realtime.events.some((e) => e.event.type === 'stage.advanced')).toBe(true);
    // Eliminados com conta são avisados.
    for (const e of preview.eliminated) {
      const who = userOfReg.get(e.registrationId);
      if (who) expect(await h.notificationsOf(who)).toContain('Fim da linha neste campeonato');
    }

    // Fase 2: mata-mata até sobrarem 2 finalistas (prévia pública só depois de confirmar).
    expect(Bracket.parse((await h.call(null, `/stages/${s2}/bracket`)).data).state).toBe('NONE');
    expect(Bracket.parse((await h.call('dono', `/stages/${s2}/bracket`)).data).state).toBe('PREVIEW');
    expect((await h.call('dono', `/stages/${s2}/confirm`, { method: 'POST' })).status).toBe(200);
    await playDuels(s2);
    const b2 = await bracketOf(s2);
    expect(b2.complete).toBe(true);
    expect(b2.matches).toHaveLength(6); // 4 quartas + 2 semifinais
    const toFinal = AdvancePreview.parse((await h.call('dono', `/stages/${s2}/advance`, { method: 'POST' })).data);
    expect(toFinal.qualified).toHaveLength(2);
    expect((await h.call('dono', `/stages/${s3}/confirm`, { method: 'POST' })).status).toBe(200);
    expect((await h.call('dono', `/stages/${s3}/advance`)).code).toBe('LAST_STAGE');

    // Encerrar antes da última fase terminar é recusado.
    expect((await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { first: regs[0], second: regs[1], third: null } })).code).toBe('STAGE_INCOMPLETE');
    await playLobbies(s3);
    const finalTable = Standings.parse((await h.call(null, `/stages/${s3}/standings`)).data);
    expect(finalTable.overall).toHaveLength(2);
    const [first, second] = finalTable.overall;
    // 5 quedas: o campeão levou 5 Booyahs (3 pts) + 2 kills por queda = 25; o vice, 1 kill por queda = 5.
    expect(first?.points).toBe(25);
    expect(second?.points).toBe(5);

    // Sugestão de pódio: só a organização.
    expect((await h.call('p1', `/tournaments/${t.id}/podium-suggestion`)).status).toBe(403);
    const suggestion = PodiumSuggestion.parse((await h.call('adm', `/tournaments/${t.id}/podium-suggestion`)).data);
    expect(suggestion).toMatchObject({ complete: true, ranking: [{ registrationId: first?.registrationId, position: 1 }, { registrationId: second?.registrationId, position: 2 }] });

    const body = { first: first?.registrationId, second: second?.registrationId, third: null };
    expect((await h.call('mod', `/tournaments/${t.id}/finish`, { method: 'POST', body })).status).toBe(403);
    expect((await h.call('outro', `/tournaments/${t.id}/finish`, { method: 'POST', body })).status).toBe(403);
    expect((await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { ...body, second: first?.registrationId } })).code).toBe('DUPLICATE_PODIUM');
    expect((await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { ...body, third: '00000000-0000-0000-0000-000000000000' } })).status).toBe(400);
    expect(await h.call(null, `/tournaments/${t.id}/podium`)).toMatchObject({ status: 200, data: null });
    const finish = await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body });
    expect(finish.status, finish.detail).toBe(200);
    expect(Podium.parse(finish.data).places[0]?.registrationId).toBe(first?.registrationId);
    expect((await h.db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('FINISHED');
    expect(Podium.parse((await h.call(null, `/tournaments/${t.slug}/podium`)).data).places.map((p) => p.place)).toEqual([1, 2]);
    expect((await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body })).code).toBe('INVALID_TRANSITION');
    expect(await h.auditCount({ action: 'STAGE_ADVANCED', tournamentId: t.id })).toBe(2);
    expect(await h.auditCount({ action: 'TOURNAMENT_STATUS_CHANGED', entityId: t.id })).toBe(1);
    expect(await h.notificationsOf('fan')).toContain('Copa Nova FF terminou');
    // Conquistas gravadas no encerramento para quem tem conta.
    const champion = userOfReg.get(first?.registrationId as string);
    if (champion) expect((await h.db.achievement.findMany({ where: { userId: h.id(champion), tournamentId: t.id } })).map((a) => a.type)).toContain('CHAMPION');
  });

  it('Clash Royale 1v1 em eliminação dupla, completo via API; correção recalcula a chave (CT-08) até a próxima partida', async () => {
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: cr, name: 'Liga CR', stages: [{ name: 'Dupla', format: 'DOUBLE_ELIM', model: 'coroas', config: { bestOf: 3, grandFinalReset: true }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    const sid = t.stageIds[0] as string;
    await h.register(t.id, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ user: `p${i}` })));
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });

    // Correção antes da próxima partida: o novo vencedor é quem avança.
    let bracket = await bracketOf(sid);
    const m1 = bracket.matches.find((m) => m.nodeId === 'w-r1-m1') as Match;
    const [a, b] = m1.participants.map((p) => p.registrationId as string);
    expect((await put(m1, { entries: [{ registrationId: a, score: 3 }, { registrationId: b, score: 0 }] })).status).toBe(400); // MD3: 2 vitórias
    expect((await put(m1, { entries: [{ registrationId: a, score: 1 }, { registrationId: b, score: 1 }] })).code).toBe('DRAW_NOT_ALLOWED');
    expect((await put(m1, { entries: [{ registrationId: a, score: 2 }, { registrationId: b, score: 1 }] })).status).toBe(200);
    bracket = await bracketOf(sid);
    const next = bracket.matches.find((m) => m.id === m1.nextMatchId) as Match;
    expect(next.participants.some((p) => p.registrationId === a)).toBe(true);
    const fixed = await put(m1, { entries: [{ registrationId: a, score: 1 }, { registrationId: b, score: 2 }], correctionReason: 'Placar invertido no print' });
    expect(fixed.status, fixed.detail).toBe(200);
    bracket = await bracketOf(sid);
    const after = bracket.matches.find((m) => m.id === m1.nextMatchId) as Match;
    expect(after.participants.some((p) => p.registrationId === b)).toBe(true);
    expect(after.participants.some((p) => p.registrationId === a)).toBe(false);
    // O perdedor foi para a chave de baixo.
    expect(bracket.matches.find((m) => m.id === m1.loserNextMatchId)?.participants.some((p) => p.registrationId === a)).toBe(true);

    await playDuels(sid);
    const done = await bracketOf(sid);
    expect(done.complete).toBe(true);
    // Depois que a partida seguinte tem resultado, a correção trava (409).
    expect((await put(m1, { entries: [{ registrationId: a, score: 2 }, { registrationId: b, score: 0 }], correctionReason: 'Tarde demais' })).status).toBe(409);
    const suggestion = PodiumSuggestion.parse((await h.call('dono', `/tournaments/${t.id}/podium-suggestion`)).data);
    expect(suggestion.complete).toBe(true);
    const [p1, p2, p3] = suggestion.ranking;
    const finish = await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { first: p1?.registrationId, second: p2?.registrationId, third: p3?.registrationId } });
    expect(finish.status, finish.detail).toBe(200);
    expect(Podium.parse(finish.data).places).toHaveLength(3);
  });

  it('empate em jogo único decidido pelo campo de desempate do jogo (RN-14)', async () => {
    const ef = await h.game('DUEL', [{ name: '310', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }] }], [{ key: 'penalties', label: 'Pênaltis', when: 'tiebreak' }]);
    const t = await h.tournament({ owner: 'dono', game: ef, stages: [{ name: 'Final', format: 'SINGLE_ELIM', model: '310', config: { bestOf: 1 }, seeding: 'RANKED' }] });
    const [a, b] = await h.register(t.id, [{ name: 'Time A' }, { name: 'Time B' }]);
    const sid = t.stageIds[0] as string;
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    const final = (await bracketOf(sid)).matches[0] as Match;
    const res = await put(final, { entries: [{ registrationId: a, score: 1, stats: { penalties: 3 } }, { registrationId: b, score: 1, stats: { penalties: 4 } }] });
    expect(res.status, res.detail).toBe(200);
    expect(Match.parse((await h.call(null, `/matches/${final.id}`)).data).participants.find((p) => p.registrationId === b)?.isWinner).toBe(true);
  });

  it('8 Ball em suíço, completo via API: próxima rodada só com a atual terminada; só a organização gera', async () => {
    const pool = await h.game('DUEL', [{ name: 'frames', rules: SERIES_RULES }]);
    const t = await h.tournament({ owner: 'dono', game: pool, name: 'Open 8 Ball', stages: [{ name: 'Suíço', format: 'SWISS', model: 'frames', config: { rounds: 3, bestOf: 3 }, tiebreakers: ['points', 'scoreDiff', 'headToHead', 'draw'], seeding: 'RANKED' }] });
    const sid = t.stageIds[0] as string;
    await h.staff(t.id, 'mod', 'MODERATOR', 'dono');
    await h.register(t.id, [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ user: `p${i}` })));
    await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' });
    expect((await h.call('dono', `/stages/${sid}/next-round`, { method: 'POST' })).code).toBe('STAGE_INCOMPLETE');
    for (let round = 1; round <= 3; round += 1) {
      await playDuels(sid);
      if (round < 3) {
        expect((await h.call('p1', `/stages/${sid}/next-round`, { method: 'POST' })).status).toBe(403);
        expect((await h.call('mod', `/stages/${sid}/next-round`, { method: 'POST' })).status).toBe(403);
        const res = await h.call('dono', `/stages/${sid}/next-round`, { method: 'POST' });
        expect(res.status, res.detail).toBe(200);
        expect(Bracket.parse(res.data).matches.filter((m) => m.round === round + 1)).toHaveLength(4);
      }
    }
    expect((await h.call('dono', `/stages/${sid}/next-round`, { method: 'POST' })).status).toBe(400);
    const table = Standings.parse((await h.call(null, `/stages/${sid}/standings`)).data).overall;
    expect(table).toHaveLength(8);
    expect(table.every((r) => r.played === 3)).toBe(true);
    expect(table[0]).toMatchObject({ wins: 3, points: 15 });
    const suggestion = PodiumSuggestion.parse((await h.call('dono', `/tournaments/${t.id}/podium-suggestion`)).data);
    expect(suggestion.complete).toBe(true);
    const [p1, p2, p3] = suggestion.ranking;
    expect((await h.call('dono', `/tournaments/${t.id}/finish`, { method: 'POST', body: { first: p1?.registrationId, second: p2?.registrationId, third: p3?.registrationId } })).status).toBe(200);
    // Formato errado para "próxima rodada".
    const other = await h.tournament({ owner: 'dono', game: pool, stages: [{ name: 'Mata', format: 'SINGLE_ELIM', model: 'frames', config: { bestOf: 1 } }] });
    await h.register(other.id, [{ name: 'X' }, { name: 'Y' }]);
    await h.call('dono', `/stages/${other.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('dono', `/stages/${other.stageIds[0]}/confirm`, { method: 'POST' });
    expect((await h.call('dono', `/stages/${other.stageIds[0]}/next-round`, { method: 'POST' })).status).toBe(400);
  });
});
