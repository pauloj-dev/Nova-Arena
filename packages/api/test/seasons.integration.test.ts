/**
 * Ranking de temporada (ELO) e ligas semanais contra um Postgres de verdade — issue #120, ADR-0003.
 * Rotas × papéis (visitante, participante, organizador, outro organizador, Admin), o replay a partir dos resultados
 * gravados, o seeding `RANKED` pelo rating e a tabela da liga pela colocação final.
 */
import { Bracket, League, LeagueDetail, Season, SeasonRanking, Standings, SubjectRatings } from '@nova/schemas';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUEL_TB, SERIES_RULES, createHarness, type Harness } from './fixtures/arena';

const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600_000;

describe.skipIf(!url)('ranking de temporada e ligas (Postgres)', { timeout: 120_000 }, () => {
  let h: Harness;
  let duel: Awaited<ReturnType<Harness['game']>>;
  let other: Awaited<ReturnType<Harness['game']>>;
  let tvt: Awaited<ReturnType<Harness['game']>>;
  let gameSlug = '';
  let tvtSlug = '';
  let seasonId = '';
  const nick = new Map<string, string>();
  let t1 = { id: '', slug: '', stageIds: [] as string[] };
  let regs1: string[] = [];

  const bracketOf = async (stageId: string) => Bracket.parse((await h.call('org', `/stages/${stageId}/bracket`)).data);
  const put = (id: string, body: unknown) => h.call('org', `/matches/${id}/result`, { method: 'PUT', body });

  /** Joga os duelos prontos: vence quem vem antes em `order`, 2 a 0. */
  async function playBy(stageId: string, order: string[]): Promise<void> {
    for (let guard = 0; guard < 20; guard += 1) {
      const ready = (await bracketOf(stageId)).matches.filter((m) => m.kind === 'DUEL' && !['VALIDATED', 'WALKOVER', 'CANCELLED'].includes(m.status) && !m.waitingPrevious && m.participants.length === 2);
      if (ready.length === 0) return;
      for (const m of ready) {
        const [a, b] = m.participants.map((p) => p.registrationId as string) as [string, string];
        const aWins = order.indexOf(a) < order.indexOf(b);
        expect((await put(m.id, { entries: [{ registrationId: a, score: aWins ? 2 : 0 }, { registrationId: b, score: aWins ? 0 : 2 }] })).status).toBe(200);
      }
    }
  }

  const ranking = async (query = '') => SeasonRanking.parse((await h.call(null, `/games/${gameSlug}/season-ranking${query}`)).data);

  beforeAll(async () => {
    h = await createHarness(url as string, 'rk');
    for (const [k, roles] of [
      ['org', ['ORGANIZER', 'PARTICIPANT']],
      ['org2', ['ORGANIZER', 'PARTICIPANT']],
      ['adm', ['ADMIN', 'PARTICIPANT']],
      ['ana', ['PARTICIPANT']],
      ['bia', ['PARTICIPANT']],
      ['caio', ['PARTICIPANT']],
      ['davi', ['PARTICIPANT']],
    ] as const) {
      nick.set(k, (await h.user(k, [...roles])).nickname);
    }
    await h.db.twoFactor.create({ data: { userId: h.id('adm'), secretEnc: 'teste', enabledAt: new Date(), recoveryCodesHash: [] } });
    duel = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    other = await h.game('DUEL', [{ name: 'coroas', rules: SERIES_RULES }]);
    tvt = await h.game('TEAM_VS_TEAM', [{ name: 'vitoria', rules: SERIES_RULES }]);
    gameSlug = (await h.db.game.findUniqueOrThrow({ where: { id: duel.id } })).slug;
    tvtSlug = (await h.db.game.findUniqueOrThrow({ where: { id: tvt.id } })).slug;
  }, 120_000);

  afterAll(async () => {
    await h.db.$disconnect();
  });

  describe('temporadas (Admin)', () => {
    const input = () => ({ gameId: duel.id, name: 'Temporada de teste', startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + 30 * DAY).toISOString() });

    it('criar: visitante 401, participante e organizador 403, Admin 201 (auditado)', async () => {
      expect((await h.call(null, '/admin/seasons', { method: 'POST', body: input() })).status).toBe(401);
      expect((await h.call('ana', '/admin/seasons', { method: 'POST', body: input() })).status).toBe(403);
      expect((await h.call('org', '/admin/seasons', { method: 'POST', body: input() })).status).toBe(403);
      const res = await h.call('adm', '/admin/seasons', { method: 'POST', body: input() });
      expect(res.status).toBe(201);
      const season = Season.parse(res.data);
      expect(season).toMatchObject({ gameId: duel.id, status: 'ACTIVE', name: 'Temporada de teste' });
      seasonId = season.id;
      expect(await h.auditCount({ action: 'SEASON_CHANGED', entityId: seasonId })).toBe(1);
    });

    it('datas que cruzam outra temporada do jogo: 409; fim antes do início: 400', async () => {
      const res = await h.call('adm', '/admin/seasons', { method: 'POST', body: { ...input(), name: 'Outra' } });
      expect(res).toMatchObject({ status: 409, code: 'SEASON_OVERLAP' });
      const bad = await h.call('adm', '/admin/seasons', { method: 'POST', body: { ...input(), endsAt: new Date(Date.now() - 2 * DAY).toISOString() } });
      expect(bad.status).toBe(400);
      expect((await h.call('adm', '/admin/seasons', { method: 'POST', body: { ...input(), gameId: 'nao-existe' } })).status).toBe(400);
    });

    it('editar e apagar: só o Admin; a lista pública mostra as temporadas do jogo', async () => {
      const past = await h.call('adm', '/admin/seasons', { method: 'POST', body: { gameId: duel.id, name: 'Antiga', startsAt: new Date(Date.now() - 90 * DAY).toISOString(), endsAt: new Date(Date.now() - 60 * DAY).toISOString() } });
      expect(past.status).toBe(201);
      const pastId = Season.parse(past.data).id;
      expect((await h.call('org', `/admin/seasons/${pastId}`, { method: 'PATCH', body: { name: 'Nova' } })).status).toBe(403);
      const patched = await h.call('adm', `/admin/seasons/${pastId}`, { method: 'PATCH', body: { name: 'Temporada antiga' } });
      expect(Season.parse(patched.data)).toMatchObject({ name: 'Temporada antiga', status: 'ENDED' });
      expect((await h.call('adm', `/admin/seasons/${pastId}`, { method: 'PATCH', body: { endsAt: new Date(Date.now() + DAY).toISOString() } })).code).toBe('SEASON_OVERLAP');
      const list = z.array(Season).parse((await h.call(null, `/seasons?game=${gameSlug}`)).data);
      expect(list.map((s) => s.name)).toEqual(['Temporada de teste', 'Temporada antiga']);
      expect((await h.call('ana', `/admin/seasons/${pastId}`, { method: 'DELETE' })).status).toBe(403);
      expect((await h.call('adm', `/admin/seasons/${pastId}`, { method: 'DELETE' })).status).toBe(200);
      expect((await h.call('adm', `/admin/seasons/${pastId}`, { method: 'DELETE' })).status).toBe(404);
      expect((await h.call(null, '/seasons?game=nao-existe')).status).toBe(404);
    });
  });

  describe('rating', () => {
    beforeAll(async () => {
      // Campeonato 1: mata-mata com 4; a ordem de força é Ana > Bia > Caio > Davi.
      t1 = await h.tournament({ owner: 'org', game: duel, name: 'Copa Semana 1', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, tiebreakers: DUEL_TB, seeding: 'RANDOM' }] });
      regs1 = await h.register(t1.id, ['davi', 'caio', 'bia', 'ana'].map((user) => ({ user })));
      const s = t1.stageIds[0] as string;
      expect((await h.call('org', `/stages/${s}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'semana-1' } })).status).toBe(200);
      expect((await h.call('org', `/stages/${s}/confirm`, { method: 'POST' })).status).toBe(200);
      const strength = [regs1[3], regs1[2], regs1[1], regs1[0]] as string[];
      await playBy(s, strength);
      const table = Standings.parse((await h.call(null, `/stages/${s}/standings`)).data).overall;
      expect((await h.call('org', `/tournaments/${t1.id}/finish`, { method: 'POST', body: { first: table[0]?.registrationId, second: table[1]?.registrationId, third: table[2]?.registrationId } })).status).toBe(200);
    });

    it('tabela da temporada atual: pública, Ana no topo, soma conservada e provisório', async () => {
      const r = await ranking();
      expect(r.season?.id).toBe(seasonId);
      expect(r.kind).toBe('PLAYER');
      expect(r.settings).toMatchObject({ initial: 1000, k: 32 });
      expect(r.entries[0]).toMatchObject({ subjectId: h.id('ana'), position: 1, wins: 2, losses: 0, provisional: true, href: `/u/${nick.get('ana')}` });
      expect(r.entries).toHaveLength(4);
      const total = r.entries.reduce((s, e) => s + e.rating, 0);
      expect(Math.abs(total - 4000)).toBeLessThanOrEqual(2);
      expect(r.entries.find((e) => e.subjectId === h.id('davi'))?.rating).toBeLessThan(1000);
      expect(r.seasons.map((s) => s.id)).toEqual([seasonId]);
    });

    it('perfil: rating por jogo e evolução partida a partida', async () => {
      const res = SubjectRatings.parse((await h.call(null, `/users/${nick.get('ana')?.toUpperCase()}/rating`)).data);
      const entry = res.entries.find((e) => e.game.id === duel.id);
      expect(entry).toMatchObject({ position: 1, played: 2, wins: 2, season: { id: seasonId } });
      expect(entry?.history).toHaveLength(2);
      expect(entry?.history.at(-1)?.rating).toBe(entry?.rating);
      expect(entry?.history[0]?.delta).toBeGreaterThan(0);
      // Quem não jogou: lista vazia. Apelido que não existe: 404.
      expect(SubjectRatings.parse((await h.call(null, `/users/${nick.get('org2')}/rating`)).data).entries).toEqual([]);
      expect((await h.call(null, '/users/naoexiste999/rating')).status).toBe(404);
    });

    it('temporada pedida que não existe: 404; tipo inválido: 400; jogo sem temporada: sem tabela', async () => {
      expect((await h.call(null, `/games/${gameSlug}/season-ranking?season=00000000-0000-0000-0000-000000000000`)).status).toBe(404);
      expect((await h.call(null, `/games/${gameSlug}/season-ranking?kind=OUTRO`)).status).toBe(400);
      const otherSlug = (await h.db.game.findUniqueOrThrow({ where: { id: other.id } })).slug;
      const none = SeasonRanking.parse((await h.call(null, `/games/${otherSlug}/season-ranking`)).data);
      expect(none).toMatchObject({ season: null, entries: [], seasons: [] });
      expect((await h.call(null, '/games/nao-existe/season-ranking')).status).toBe(404);
    });

    it('resultado corrigido muda o rating na próxima leitura (o replay sai da versão nova do histórico)', async () => {
      const before = await ranking();
      const anaBefore = before.entries.find((e) => e.subjectId === h.id('ana'))?.rating as number;
      // A final: Ana venceu; a correção dá a vitória à adversária.
      const final = (await bracketOf(t1.stageIds[0] as string)).matches.find((m) => m.roundLabel === 'Final');
      const [a, b] = final?.participants.map((p) => p.registrationId as string) as [string, string];
      const anaReg = regs1[3] as string;
      const rival = a === anaReg ? b : a;
      const res = await put(final?.id as string, { entries: [{ registrationId: anaReg, score: 1 }, { registrationId: rival, score: 2 }], correctionReason: 'Placar trocado' });
      expect(res.status).toBe(200);
      const after = await ranking();
      expect(after.entries.find((e) => e.subjectId === h.id('ana'))?.rating).toBeLessThan(anaBefore);
      // Desfaz a correção para os próximos testes.
      expect((await put(final?.id as string, { entries: [{ registrationId: anaReg, score: 2 }, { registrationId: rival, score: 0 }], correctionReason: 'Volta ao placar certo' })).status).toBe(200);
    });

    it('seeding RANKED usa o rating: a Ana (inscrita por último) vira a seed 1', async () => {
      const t2 = await h.tournament({ owner: 'org', game: duel, name: 'Copa Semana 2', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas', config: { bestOf: 3 }, tiebreakers: DUEL_TB, seeding: 'RANKED' }] });
      const regs = await h.register(t2.id, [{ user: 'davi' }, { user: 'caio' }, { name: 'Convidado' }, { user: 'bia' }, { user: 'ana' }]);
      const b = Bracket.parse((await h.call('org', `/stages/${t2.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANKED' } })).data);
      const bySeed = [...b.entrants].sort((x, y) => x.seed - y.seed).map((e) => e.registrationId);
      expect(bySeed[0]).toBe(regs[4]);
      // As seeds seguem o rating da temporada (o convidado sem conta entra com 1000).
      const table = await ranking();
      const ratingOf = (key: string) => table.entries.find((e) => e.subjectId === h.id(key))?.rating as number;
      const expected = [
        { reg: regs[0], r: ratingOf('davi') },
        { reg: regs[1], r: ratingOf('caio') },
        { reg: regs[2], r: 1000 },
        { reg: regs[3], r: ratingOf('bia') },
        { reg: regs[4], r: ratingOf('ana') },
      ].sort((x, y) => y.r - x.r);
      expect(bySeed).toEqual(expected.map((x) => x.reg));
      // Quem ainda não jogou (o convidado) entra com o rating inicial: acima de quem perdeu pontos.
      expect(bySeed.indexOf(regs[2] as string)).toBeLessThan(bySeed.indexOf(regs[0] as string));
    });

    it('flag "ranking" desligada: 403 FEATURE_DISABLED nas leituras de rating', async () => {
      await h.db.siteSetting.upsert({ where: { key: 'flags' }, create: { key: 'flags', value: { ranking: false } }, update: { value: { ranking: false } } });
      await h.cache.del('site:flags:v1');
      try {
        expect((await h.call(null, `/games/${gameSlug}/season-ranking`)).code).toBe('FEATURE_DISABLED');
        expect((await h.call(null, `/users/${nick.get('ana')}/rating`)).code).toBe('FEATURE_DISABLED');
      } finally {
        await h.db.siteSetting.deleteMany({ where: { key: 'flags' } });
        await h.cache.del('site:flags:v1');
      }
      expect((await h.call(null, `/games/${gameSlug}/season-ranking`)).status).toBe(200);
    });

    it('squads: rating do squad e dos jogadores numa partida equipe x equipe', async () => {
      await h.call('adm', '/admin/seasons', { method: 'POST', body: { gameId: tvt.id, name: 'Temporada TvT', startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + DAY).toISOString() } });
      const squad = async (name: string, tag: string, captain: string, mate: string) =>
        h.db.team.create({ data: { name, tag, captainId: h.id(captain), gameId: tvt.id, members: { create: [{ userId: h.id(captain), role: 'CAPTAIN' }, { userId: h.id(mate) }] } } });
      const stamp = String(Date.now()).slice(-5);
      const alfa = await squad('Alfa', `A${stamp}`, 'ana', 'bia');
      const beta = await squad('Beta', `B${stamp}`, 'caio', 'davi');
      const t = await h.tournament({ owner: 'org', game: tvt, name: 'Copa Squads', stages: [{ name: 'Final', format: 'TEAM_VS_TEAM', model: 'vitoria', config: { bestOf: 1 }, tiebreakers: DUEL_TB }] });
      await h.db.tournament.update({ where: { id: t.id }, data: { participantType: 'TEAM' } });
      const regs: string[] = [];
      for (const [team, members] of [
        [alfa, ['ana', 'bia']],
        [beta, ['caio', 'davi']],
      ] as const) {
        const r = await h.db.registration.create({ data: { tournamentId: t.id, teamId: team.id, status: 'CONFIRMED', members: { create: members.map((m, i) => ({ tournamentId: t.id, userId: h.id(m), confirmedAt: new Date(), isCaptain: i === 0 })) } } });
        regs.push(r.id);
      }
      await h.call('org', `/stages/${t.stageIds[0]}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } });
      await h.call('org', `/stages/${t.stageIds[0]}/confirm`, { method: 'POST' });
      const m = (await bracketOf(t.stageIds[0] as string)).matches[0];
      expect((await put(m?.id as string, { entries: [{ registrationId: regs[0], score: 1 }, { registrationId: regs[1], score: 0 }] })).status).toBe(200);

      const teams = SeasonRanking.parse((await h.call(null, `/games/${tvtSlug}/season-ranking?kind=TEAM`)).data);
      expect(teams.entries.map((e) => [e.subjectId, e.rating, e.tag])).toEqual([
        [alfa.id, 1016, alfa.tag],
        [beta.id, 984, beta.tag],
      ]);
      const players = SeasonRanking.parse((await h.call(null, `/games/${tvtSlug}/season-ranking?kind=PLAYER`)).data);
      expect(players.entries.filter((e) => e.rating === 1016).map((e) => e.subjectId).sort()).toEqual([h.id('ana'), h.id('bia')].sort());
      const squadRating = SubjectRatings.parse((await h.call(null, `/teams/${alfa.id}/rating`)).data);
      expect(squadRating.entries[0]).toMatchObject({ rating: 1016, played: 1, wins: 1 });
      expect((await h.call(null, '/teams/nao-existe/rating')).status).toBe(404);
    });
  });

  describe('ligas semanais', () => {
    let leagueId = '';
    let leagueSlug = '';
    const rule = { placementPoints: [10, 7, 5, 3], participationPoints: 1 };
    const leagueInput = () => ({ name: 'Liga das Quintas', description: 'Toda quinta, 20h.', gameId: duel.id, startsAt: new Date(Date.now() - DAY).toISOString(), endsAt: new Date(Date.now() + 60 * DAY).toISOString(), rule });

    it('criar: visitante 401, participante 403, organizador 201 (auditado); regra inválida 400', async () => {
      expect((await h.call(null, '/organizer/leagues', { method: 'POST', body: leagueInput() })).status).toBe(401);
      expect((await h.call('ana', '/organizer/leagues', { method: 'POST', body: leagueInput() })).status).toBe(403);
      expect((await h.call('org', '/organizer/leagues', { method: 'POST', body: { ...leagueInput(), rule: { placementPoints: [5, 9], participationPoints: 0 } } })).status).toBe(400);
      const res = await h.call('org', '/organizer/leagues', { method: 'POST', body: leagueInput() });
      expect(res.status).toBe(201);
      const league = League.parse(res.data);
      expect(league).toMatchObject({ name: 'Liga das Quintas', status: 'ACTIVE', owner: { id: h.id('org') }, rule, tournaments: [] });
      leagueId = league.id;
      leagueSlug = league.slug;
      expect(await h.auditCount({ action: 'LEAGUE_CHANGED', entityId: leagueId })).toBe(1);
      const mine = z.array(League).parse((await h.call('org', '/organizer/leagues')).data);
      expect(mine.map((l) => l.id)).toContain(leagueId);
      expect(z.array(League).parse((await h.call('org2', '/organizer/leagues')).data).map((l) => l.id)).not.toContain(leagueId);
    });

    it('incluir campeonatos: só de quem organiza, do mesmo jogo, uma liga por campeonato', async () => {
      expect((await h.call('org2', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: t1.id } })).status).toBe(403);
      const res = await h.call('org', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: t1.id } });
      expect(res.status).toBe(200);
      expect(League.parse(res.data).tournaments).toMatchObject([{ id: t1.id, counted: true }]);
      expect((await h.call('org', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: t1.id } })).code).toBe('TOURNAMENT_IN_LEAGUE');
      const foreign = await h.tournament({ owner: 'org', game: other, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas' }] });
      expect((await h.call('org', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: foreign.id } })).code).toBe('GAME_MISMATCH');
      const theirs = await h.tournament({ owner: 'org2', game: duel, stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas' }] });
      expect((await h.call('org', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: theirs.id } })).status).toBe(403);
      const upcoming = await h.tournament({ owner: 'org', game: duel, name: 'Copa Semana 3', stages: [{ name: 'Mata-mata', format: 'SINGLE_ELIM', model: 'coroas' }] });
      const added = League.parse((await h.call('org', `/organizer/leagues/${leagueId}/tournaments`, { method: 'POST', body: { tournamentId: upcoming.id } })).data);
      expect(added.tournaments.find((t) => t.id === upcoming.id)?.counted).toBe(false);
      const removed = await h.call('org', `/organizer/leagues/${leagueId}/tournaments/${upcoming.id}`, { method: 'DELETE' });
      expect(League.parse(removed.data).tournaments.map((t) => t.id)).toEqual([t1.id]);
      expect((await h.call('org', `/organizer/leagues/${leagueId}/tournaments/${upcoming.id}`, { method: 'DELETE' })).status).toBe(404);
    });

    it('página pública: tabela pela colocação final do campeonato encerrado', async () => {
      const res = await h.call(null, `/leagues/${leagueSlug}`);
      expect(res.status).toBe(200);
      const detail = LeagueDetail.parse(res.data);
      const podium = (await h.db.tournamentPodium.findUniqueOrThrow({ where: { tournamentId: t1.id } })).places as { place: number; registrationId: string }[];
      const champion = podium.find((p) => p.place === 1)?.registrationId;
      const championUser = (await h.db.registration.findUniqueOrThrow({ where: { id: champion as string } })).userId;
      expect(detail.table[0]).toMatchObject({ key: `u:${championUser}`, points: 11, wins: 1, played: 1, position: 1 });
      expect(detail.table).toHaveLength(4);
      expect(detail.table.map((r) => r.points)).toEqual([11, 8, 6, 4]);
      expect(z.array(League).parse((await h.call(null, `/leagues?game=${gameSlug}`)).data).map((l) => l.slug)).toContain(leagueSlug);
      expect((await h.call(null, '/leagues/nao-existe')).status).toBe(404);
    });

    it('editar e apagar: a dona e o Admin podem; outro organizador não', async () => {
      expect((await h.call('org2', `/organizer/leagues/${leagueId}`, { method: 'PATCH', body: { name: 'Roubada' } })).status).toBe(403);
      const patched = League.parse((await h.call('org', `/organizer/leagues/${leagueId}`, { method: 'PATCH', body: { name: 'Liga das Quintas 2026', rule: { placementPoints: [20, 10], participationPoints: 0 } } })).data);
      expect(patched).toMatchObject({ name: 'Liga das Quintas 2026', rule: { placementPoints: [20, 10], participationPoints: 0 } });
      expect(LeagueDetail.parse((await h.call(null, `/leagues/${leagueSlug}`)).data).table.map((r) => r.points)).toEqual([20, 10, 0, 0]);
      expect((await h.call('org', `/organizer/leagues/${leagueId}`, { method: 'PATCH', body: { endsAt: new Date(Date.now() - 10 * DAY).toISOString() } })).status).toBe(400);
      expect((await h.call('adm', `/organizer/leagues/${leagueId}`, { method: 'PATCH', body: { description: 'Ajuste do Admin' } })).status).toBe(200);
      expect((await h.call('org2', `/organizer/leagues/${leagueId}`, { method: 'DELETE' })).status).toBe(403);
      expect((await h.call('org', `/organizer/leagues/${leagueId}`, { method: 'DELETE' })).status).toBe(200);
      expect((await h.call(null, `/leagues/${leagueSlug}`)).status).toBe(404);
      // O campeonato continua existindo e pode entrar em outra liga.
      expect(await h.db.tournament.count({ where: { id: t1.id } })).toBe(1);
    });
  });
});
