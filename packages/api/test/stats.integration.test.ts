/**
 * Perfil competitivo contra um Postgres de verdade — issue #89. Porta de
 * `apps/web/features/profile/competitive/api.test.ts`: os números saem dos resultados gravados, do pódio, da tabela
 * final e das conquistas gravadas no encerramento.
 */
import { Bracket, CompetitiveStats, Podium, Standings, type Match } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BR_RULES, BR_TB, DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('perfil competitivo (Postgres)', { timeout: 60_000 }, () => {
  let h: Harness;
  const nick = new Map<string, string>();
  let open8 = { id: '', slug: '', stageIds: [] as string[] };
  let liga = { id: '', slug: '', stageIds: [] as string[] };
  let regsOpen: string[] = [];

  const stats = async (key: string) => CompetitiveStats.parse((await h.call(null, `/users/${nick.get(key)}/stats`)).data);
  const bracketOf = async (stageId: string) => Bracket.parse((await h.call('org', `/stages/${stageId}/bracket`)).data);
  const put = (m: { id: string }, body: unknown) => h.call('org', `/matches/${m.id}/result`, { method: 'PUT', body });

  /** Joga os duelos prontos: vence a melhor seed (menor índice de inscrição), 2 a 0. */
  async function playBySeed(stageId: string, order: string[]): Promise<void> {
    for (let guard = 0; guard < 20; guard += 1) {
      const ready = (await bracketOf(stageId)).matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious);
      if (ready.length === 0) return;
      for (const m of ready) {
        const [a, b] = m.participants.map((p) => p.registrationId as string) as [string, string];
        const aWins = order.indexOf(a) < order.indexOf(b);
        expect((await put(m, { entries: [{ registrationId: a, score: aWins ? 2 : 0 }, { registrationId: b, score: aWins ? 0 : 2 }] })).status).toBe(200);
      }
    }
  }

  beforeAll(async () => {
    h = await createHarness(url as string, 'st');
    nick.set('org', (await h.user('org', ['ORGANIZER', 'PARTICIPANT'])).nickname);
    for (const k of ['bia', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'lucas', 'kil', 'nunca']) nick.set(k, (await h.user(k, ['PARTICIPANT'])).nickname);
    const pool = await h.game('DUEL', [{ name: 'frames', rules: SERIES_RULES }]);
    const cr = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);

    // Open 8 Ball (suíço, 3 rodadas, 8 jogadores): a seed 1 (Bianca) vence tudo; o campeonato é encerrado.
    open8 = await h.tournament({ owner: 'org', game: pool, name: 'Open 8 Ball Pool', stages: [{ name: 'Suíço', format: 'SWISS', model: 'frames', config: { rounds: 3, bestOf: 3 }, tiebreakers: ['points', 'scoreDiff', 'headToHead', 'draw'], seeding: 'RANKED' }] });
    regsOpen = await h.register(open8.id, ['bia', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'].map((user) => ({ user })));
    const s = open8.stageIds[0] as string;
    await h.call('org', `/stages/${s}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('org', `/stages/${s}/confirm`, { method: 'POST' });
    for (let round = 1; round <= 3; round += 1) {
      await playBySeed(s, regsOpen);
      if (round < 3) expect((await h.call('org', `/stages/${s}/next-round`, { method: 'POST' })).status).toBe(200);
    }
    const table = Standings.parse((await h.call(null, `/stages/${s}/standings`)).data).overall;
    const [first, second, third] = table;
    expect((await h.call('org', `/tournaments/${open8.id}/finish`, { method: 'POST', body: { first: first?.registrationId, second: second?.registrationId, third: third?.registrationId } })).status).toBe(200);

    // Liga CR em andamento: a Bianca venceu a 1ª partida por 2 a 1.
    liga = await h.tournament({ owner: 'org', game: cr, name: 'Liga CR', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
    const regsLiga = await h.register(liga.id, ['bia', 'p2', 'p3', 'p4'].map((user) => ({ user })));
    await h.call('org', `/stages/${liga.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('org', `/stages/${liga.stageIds[0]}/confirm`, { method: 'POST' });
    const m = (await bracketOf(liga.stageIds[0] as string)).matches.find((x) => x.participants.some((p) => p.registrationId === regsLiga[0])) as Match;
    const other = m.participants.find((p) => p.registrationId !== regsLiga[0])?.registrationId;
    expect((await put(m, { entries: [{ registrationId: regsLiga[0], score: 2 }, { registrationId: other, score: 1 }] })).status).toBe(200);

    // Lucas inscrito num campeonato que ainda não começou (sem chave confirmada).
    const soon = await h.tournament({ owner: 'org', game: cr, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas' }] });
    await h.register(soon.id, [{ user: 'lucas' }, { name: 'Alguém' }]);
  }, 120_000);
  afterAll(async () => {
    await h.db.$disconnect();
  });

  it('é público, sem diferenciar maiúsculas, e 404 para apelido inexistente', async () => {
    expect((await h.call(null, `/users/${nick.get('bia')}/stats`)).status).toBe(200);
    expect((await h.call(null, `/users/${nick.get('bia')?.toUpperCase()}/stats`)).status).toBe(200);
    expect((await h.call(null, '/users/NaoExiste123/stats')).status).toBe(404);
    // A rota do perfil público continua respondendo (as duas convivem).
    expect((await h.call(null, `/users/${nick.get('bia')}`)).status).toBe(200);
  });

  it('as estatísticas da Bianca no Open 8 Ball batem com a tabela e o pódio', async () => {
    const reg = regsOpen[0] as string;
    const row = Standings.parse((await h.call(null, `/stages/${open8.stageIds[0]}/standings`)).data).overall.find((r) => r.registrationId === reg);
    const podium = Podium.parse((await h.call(null, `/tournaments/${open8.id}/podium`)).data);
    const s = await stats('bia');
    expect(s.userId).toBe(h.id('bia'));
    const pool = s.perGame.find((g) => g.gameName.includes('DUEL') && g.tournaments === 1 && g.titles === 1);
    expect(pool).toMatchObject({ tournaments: 1, titles: 1, matches: row?.played, wins: row?.wins, kills: 0, score: row?.scoreFor });
    // Suíço de 3 rodadas com 8 jogadores: a seed 1 vence todas e leva o título.
    expect(pool).toMatchObject({ matches: 3, wins: 3, titles: 1, score: 6 });
    const entry = s.history.find((x) => x.tournamentId === open8.id);
    expect(entry).toMatchObject({ tournamentName: 'Open 8 Ball Pool', tournamentSlug: open8.slug, placement: 1, finishedAt: podium.finishedAt, teamName: null });
    expect(s.achievements.find((a) => a.type === 'CHAMPION')).toMatchObject({ label: 'Campeão', tournamentName: 'Open 8 Ball Pool', awardedAt: podium.finishedAt });
    expect(s.achievements.find((a) => a.type === 'FIRST_TOURNAMENT')).toBeDefined();
    expect(s.achievements.some((a) => a.type === 'TEN_TOURNAMENTS')).toBe(false);
  });

  it('campeonato em andamento conta partidas e fica no histórico sem colocação, antes dos encerrados', async () => {
    const s = await stats('bia');
    const cr = s.perGame.find((g) => g.titles === 0);
    expect(cr).toMatchObject({ tournaments: 1, titles: 0, matches: 1, wins: 1, score: 2 });
    expect(s.history.find((x) => x.tournamentId === liga.id)).toMatchObject({ placement: null, finishedAt: null });
    expect(s.history.map((x) => x.tournamentId)).toEqual([liga.id, open8.id]);
  });

  it('pódio: vice e 3º lugar viram conquista; quem não subiu ao pódio fica com a posição da tabela', async () => {
    const podium = Podium.parse((await h.call(null, `/tournaments/${open8.id}/podium`)).data);
    const table = Standings.parse((await h.call(null, `/stages/${open8.stageIds[0]}/standings`)).data).overall;
    const keyOf = (registrationId: string) => ['bia', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'][regsOpen.indexOf(registrationId)] as string;
    const second = await stats(keyOf(podium.places.find((p) => p.place === 2)?.registrationId as string));
    expect(second.achievements.map((a) => a.type)).toEqual(expect.arrayContaining(['RUNNER_UP', 'FIRST_TOURNAMENT']));
    expect(second.history.find((x) => x.tournamentId === open8.id)?.placement).toBe(2);
    const third = await stats(keyOf(podium.places.find((p) => p.place === 3)?.registrationId as string));
    expect(third.achievements.map((a) => a.type)).toContain('THIRD_PLACE');

    const last = table[table.length - 1];
    const loser = await stats(keyOf(last?.registrationId as string));
    expect(loser.history.find((x) => x.tournamentId === open8.id)?.placement).toBe(last?.position);
    expect(loser.perGame.find((g) => g.titles === 0 && g.tournaments >= 1)).toBeDefined();
    const loserPool = loser.perGame.find((g) => g.matches === last?.played && g.wins === last?.wins);
    expect(loserPool).toMatchObject({ score: last?.scoreFor });
  });

  it('quem nunca jogou tem tudo vazio; inscrição sem chave confirmada não conta', async () => {
    expect(await stats('lucas')).toEqual({ userId: h.id('lucas'), perGame: [], achievements: [], history: [] });
    expect(await stats('nunca')).toEqual({ userId: h.id('nunca'), perGame: [], achievements: [], history: [] });
    expect(await stats('org')).toEqual({ userId: h.id('org'), perGame: [], achievements: [], history: [] });
  });

  it('kills por jogador contam no perfil e o MVP do campeonato encerrado vira conquista', async () => {
    const ff = await h.game('BATTLE_ROYALE', [{ name: 'padrao', rules: BR_RULES }]);
    const t = await h.tournament({ owner: 'org', game: ff, name: 'Copa Kills', stages: [{ name: 'Quedas', format: 'BATTLE_ROYALE', model: 'padrao', config: { drops: 1 }, tiebreakers: BR_TB, seeding: 'RANKED' }] });
    const [mine, other] = await h.register(t.id, [{ user: 'kil' }, { name: 'Rival' }]);
    await h.call('org', `/stages/${t.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await h.call('org', `/stages/${t.stageIds[0]}/confirm`, { method: 'POST' });
    const drop = (await bracketOf(t.stageIds[0] as string)).matches[0] as Match;
    expect((await put(drop, { entries: [{ registrationId: mine, placement: 1, kills: 6, playerKills: { [h.id('kil')]: 6 } }, { registrationId: other, placement: 2, kills: 2 }] })).status).toBe(200);
    expect((await h.call('org', `/tournaments/${t.id}/finish`, { method: 'POST', body: { first: mine, second: other, third: null } })).status).toBe(200);
    const s = await stats('kil');
    expect(s.perGame[0]).toMatchObject({ tournaments: 1, titles: 1, matches: 1, wins: 1, kills: 6 });
    expect(s.achievements.map((a) => a.type)).toEqual(expect.arrayContaining(['CHAMPION', 'MVP', 'FIRST_TOURNAMENT']));
  });

  it('campeonato cancelado sai do histórico (e das conquistas)', async () => {
    await h.db.tournament.update({ where: { id: open8.id }, data: { status: 'CANCELLED' } });
    const s = await stats('bia');
    expect(s.history.map((x) => x.tournamentId)).toEqual([liga.id]);
    expect(s.perGame).toHaveLength(1);
    expect(s.achievements.some((a) => a.type === 'CHAMPION')).toBe(false);
  });
});
