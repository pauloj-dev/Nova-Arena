/**
 * Lacunas encontradas ao trocar o mock pela API real nas telas de F2 (issue #102), contra o Postgres:
 * - `GET /games/:slug/ranking` (a tela /ranking): números dos resultados, ordem e empates;
 * - `GET /me/registrations`: `nextMatch` (home e "Meus campeonatos") e `finalPlacement`;
 * - comunicado do campeonato notifica inscritos e seguidores (RN-15) e avisa a página ao vivo.
 */
import { GameRanking, MyTournamentEntry } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('telas de F2 com a API real (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;
  let tournament: { id: string; slug: string; stageIds: string[] };
  let gameSlug = '';
  let regs: string[] = [];

  beforeAll(async () => {
    h = await createHarness(url as string, 'tf');
    await h.user('dono', ['ORGANIZER', 'PARTICIPANT']);
    for (const k of ['ana', 'bia', 'cris', 'duda', 'fan']) await h.user(k, ['PARTICIPANT']);
    const game = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    gameSlug = (await h.db.game.findUniqueOrThrow({ where: { id: game.id } })).slug;
    tournament = await h.tournament({ owner: 'dono', game, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, tiebreakers: DUEL_TB, seeding: 'MANUAL' }] });
    regs = await h.register(tournament.id, ['ana', 'bia', 'cris', 'duda'].map((user) => ({ user })));
    const sid = tournament.stageIds[0] as string;
    expect((await h.call('dono', `/stages/${sid}/generate`, { method: 'POST', body: { seeding: 'MANUAL', order: regs } })).status).toBe(200);
    expect((await h.call('dono', `/stages/${sid}/confirm`, { method: 'POST' })).status).toBe(200);
    await h.db.tournament.update({ where: { id: tournament.id }, data: { status: 'IN_PROGRESS' } });
  });
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('"Meus campeonatos" traz a próxima partida (rótulo e adversário) de quem está na chave', async () => {
    const mine = z.array(MyTournamentEntry).parse((await h.call('ana', '/me/registrations')).data);
    const entry = mine.find((e) => e.tournament.id === tournament.id);
    expect(entry?.nextMatch).toMatchObject({ opponent: expect.any(String), checkInOpen: false });
    expect(entry?.nextMatch?.label).toContain('Mata-mata');
    expect(entry?.finalPlacement).toBeNull();
  });

  it('ranking do jogo: vitórias e placar vindos dos resultados; jogo inexistente = 404', async () => {
    const bracket = (await h.call('dono', `/stages/${tournament.stageIds[0]}/bracket`)).data as { matches: { id: string; round: number; participants: { registrationId: string }[] }[] };
    for (const m of bracket.matches.filter((x) => x.round === 1)) {
      const [a, b] = m.participants;
      expect((await h.call('dono', `/matches/${m.id}/result`, { method: 'PUT', body: { entries: [{ registrationId: a?.registrationId, score: 2 }, { registrationId: b?.registrationId, score: 1 }] } })).status).toBe(200);
    }
    const ranking = GameRanking.parse((await h.call(null, `/games/${gameSlug}/ranking`)).data);
    expect(ranking).toMatchObject({ gameSlug, resultsAvailable: true, highlight: 'SCORE' });
    expect(ranking.entries).toHaveLength(4);
    // Os dois vencedores (1 vitória, 2 de placar) empatam no topo; os perdedores (0 vitória, 1 de placar) depois.
    expect(ranking.entries.map((e) => [e.position, e.wins, e.score])).toEqual([
      [1, 1, 2],
      [1, 1, 2],
      [3, 0, 1],
      [3, 0, 1],
    ]);
    expect((await h.call(null, '/games/nao-existe/ranking')).status).toBe(404);
  });

  it('comunicado do campeonato notifica os inscritos e quem segue (não quem escreveu) e avisa a página ao vivo', async () => {
    await h.db.follow.create({ data: { userId: h.id('fan'), targetType: 'TOURNAMENT', targetId: tournament.id } });
    const res = await h.call('dono', `/tournaments/${tournament.id}/announcements`, { method: 'POST', body: { title: 'Final adiada', body: 'A final começa às 21h.', stageId: null, groupId: null } });
    expect(res.status, res.detail).toBe(201);
    for (const who of ['ana', 'bia', 'cris', 'duda', 'fan']) expect(await h.notificationsOf(who), who).toContain(`Copa tf: Final adiada`);
    expect(await h.notificationsOf('dono')).not.toContain('Copa tf: Final adiada');
    expect(h.realtime.events.some((e) => e.channel === `tournament:${tournament.id}` && e.event.type === 'announcement.created')).toBe(true);
  });
});
