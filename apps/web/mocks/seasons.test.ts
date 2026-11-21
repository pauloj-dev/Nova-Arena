/**
 * Regras do ranking de temporada e das ligas na API simulada (issue #120) — os mesmos cenários do teste de
 * integração da API real (`packages/api/test/seasons.integration.test.ts`).
 */
import { Bracket, League, LeagueDetail, Season, SeasonRanking, SubjectRatings } from '@nova/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { auditLogs } from './audit';
import { db } from './db';
import { seasonsStore, type DbSeason } from './seasons';
import { as, call, mutate, setupMockApi } from './testing';

setupMockApi();

const CAMILA = 'u_camila'; // organizadora da Liga CR
const DIEGO = 'u_diego'; // organizador do Open 8 Ball Pool
const BIANCA = 'u_bianca';
const ANA = 'u_ana'; // admin com 2FA
const RAFAEL = 'u_rafael'; // super admin

/** A temporada do seed é a do ano corrente; o teste abre a janela para não depender da data em que roda. */
function wideSeasons(): void {
  mutate((d) => {
    d.extra.seasons = d.games.map((g): DbSeason => ({ id: `season_${g.id}`, gameId: g.id, name: 'Temporada aberta', startsAt: '2000-01-01T00:00:00.000Z', endsAt: '2100-01-01T00:00:00.000Z', createdById: RAFAEL, createdAt: '2000-01-01T00:00:00.000Z' }));
  });
}

describe('temporadas', () => {
  it('o seed cria a temporada do ano corrente para cada jogo', async () => {
    const list = z.array(Season).parse((await call('GET', '/seasons?game=8-ball-pool')).data);
    const year = new Date().getUTCFullYear();
    expect(list).toEqual([expect.objectContaining({ name: `Temporada ${year}`, status: 'ACTIVE', gameSlug: '8-ball-pool' })]);
    expect(seasonsStore()).toHaveLength(db().games.length);
    expect((await call('GET', '/seasons?game=nao-existe')).status).toBe(404);
  });

  it('Admin: visitante 401, participante 403, Admin 201; sobreposição 409; editar e apagar auditados', async () => {
    const body = { gameId: 'g_8ball', name: 'Temporada futura', startsAt: '2200-01-01T00:00:00.000Z', endsAt: '2200-06-01T00:00:00.000Z' };
    as(null);
    expect((await call('POST', '/admin/seasons', body)).status).toBe(401);
    as(BIANCA);
    expect((await call('POST', '/admin/seasons', body)).status).toBe(403);
    as(CAMILA);
    expect((await call('POST', '/admin/seasons', body)).status).toBe(403);
    as(ANA);
    const created = await call('POST', '/admin/seasons', body);
    expect(created.status).toBe(201);
    const season = Season.parse(created.data);
    expect(season.status).toBe('UPCOMING');
    expect((await call('POST', '/admin/seasons', { ...body, name: 'Outra' })).code).toBe('SEASON_OVERLAP');
    expect((await call('POST', '/admin/seasons', { ...body, endsAt: '2199-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await call('POST', '/admin/seasons', { ...body, gameId: 'nada', startsAt: '2300-01-01T00:00:00.000Z', endsAt: '2300-02-01T00:00:00.000Z' })).status).toBe(400);
    const patched = await call('PATCH', `/admin/seasons/${season.id}`, { name: 'Temporada 2200' });
    expect(Season.parse(patched.data).name).toBe('Temporada 2200');
    expect((await call('PATCH', `/admin/seasons/${season.id}`, { endsAt: '2100-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await call('DELETE', `/admin/seasons/${season.id}`)).status).toBe(200);
    expect((await call('DELETE', `/admin/seasons/${season.id}`)).status).toBe(404);
    expect(auditLogs().filter((l) => l.action === 'SEASON_CHANGED' && l.entityId === season.id)).toHaveLength(3);
  });
});

describe('rating da temporada', () => {
  it('tabela do 8 Ball Pool sai do suíço encerrado: pública, soma conservada, posições', async () => {
    wideSeasons();
    as(null);
    const res = await call('GET', '/games/8-ball-pool/season-ranking');
    expect(res.status).toBe(200);
    const r = SeasonRanking.parse(res.data);
    expect(r.season?.id).toBe('season_g_8ball');
    expect(r.entries.length).toBeGreaterThanOrEqual(4);
    expect(r.entries[0]?.position).toBe(1);
    expect(r.entries[0]?.wins).toBeGreaterThan(0);
    const total = r.entries.reduce((s, e) => s + e.rating, 0);
    expect(Math.abs(total - 1000 * r.entries.length)).toBeLessThanOrEqual(r.entries.length);
    // Suíço de 3 rodadas: todos com 3 partidas, ainda provisórios (menos de 5).
    expect(r.entries.every((e) => e.played === 3 && e.provisional)).toBe(true);
  });

  it('perfil: rating por jogo com a evolução; flag desligada responde 403 FEATURE_DISABLED', async () => {
    wideSeasons();
    const table = SeasonRanking.parse((await call('GET', '/games/8-ball-pool/season-ranking')).data);
    const top = table.entries[0];
    const res = SubjectRatings.parse((await call('GET', `/users/${top?.name.toUpperCase()}/rating`)).data);
    const entry = res.entries.find((e) => e.game.slug === '8-ball-pool');
    expect(entry).toMatchObject({ rating: top?.rating, position: 1, played: 3 });
    expect(entry?.history).toHaveLength(3);
    expect(entry?.history.at(-1)?.rating).toBe(top?.rating);
    expect((await call('GET', '/users/naoexiste/rating')).status).toBe(404);

    as(RAFAEL);
    expect((await call('PUT', '/admin/flags/ranking', { enabled: false })).status).toBe(200);
    as(null);
    expect((await call('GET', '/games/8-ball-pool/season-ranking')).code).toBe('FEATURE_DISABLED');
    expect((await call('GET', `/users/${top?.name}/rating`)).code).toBe('FEATURE_DISABLED');
  });

  it('temporada inexistente 404, tipo inválido 400, squads sem dados = lista vazia', async () => {
    expect((await call('GET', '/games/8-ball-pool/season-ranking?season=nada')).status).toBe(404);
    expect((await call('GET', '/games/8-ball-pool/season-ranking?kind=OUTRO')).status).toBe(400);
    expect(SeasonRanking.parse((await call('GET', '/games/8-ball-pool/season-ranking?kind=TEAM')).data).entries).toEqual([]);
    expect((await call('GET', '/teams/nada/rating')).status).toBe(404);
  });

  it('seeding RANKED usa o rating da temporada na primeira fase', async () => {
    wideSeasons();
    const table = SeasonRanking.parse((await call('GET', '/games/8-ball-pool/season-ranking')).data);
    const best = table.entries[0]?.subjectId as string;
    const worst = table.entries.at(-1)?.subjectId as string;
    // Novo campeonato de 8 Ball do Diego com o pior inscrito antes do melhor.
    mutate((d) => {
      const base = d.tournaments.find((t) => t.id === 'tn_open_8ball');
      if (!base) throw new Error('sem campeonato base');
      d.tournaments.push({ ...base, id: 'tn_8b_novo', slug: '8b-novo', name: '8 Ball semana 2', status: 'REGISTRATION_CLOSED', stages: base.stages.map((s) => ({ ...s, id: 'tn_8b_novo_s1', tournamentId: 'tn_8b_novo', status: 'PENDING' })) });
      for (const [i, userId] of [worst, best, BIANCA].entries()) {
        d.registrations.push({ id: `rg_8b_${i}`, tournamentId: 'tn_8b_novo', userId, teamId: null, importedName: null, importedTag: null, status: 'CONFIRMED', seed: null, statusReason: null, members: [], reservedUntil: null, createdAt: `2026-01-0${i + 1}T00:00:00.000Z` });
      }
    });
    as(DIEGO);
    const res = await call('POST', '/stages/tn_8b_novo_s1/generate', { seeding: 'RANKED' });
    expect(res.status, res.detail).toBe(200);
    const b = Bracket.parse(res.data);
    const seed1 = b.entrants.find((e) => e.seed === 1)?.registrationId;
    expect(seed1).toBe('rg_8b_1');
  });
});

describe('ligas semanais', () => {
  const rule = { placementPoints: [10, 7, 5, 3], participationPoints: 1 };
  const input = { name: 'Liga das Quintas', description: '', gameId: 'g_clashroyale', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z', rule };

  it('liga de demonstração: o Open 8 Ball Pool (encerrado) soma pontos pelo pódio e pela tabela', async () => {
    as(null);
    const detail = LeagueDetail.parse((await call('GET', '/leagues/circuito-8-ball-pool')).data);
    expect(detail.league.tournaments).toEqual([expect.objectContaining({ slug: 'open-8-ball-pool', counted: true })]);
    expect(detail.table[0]).toMatchObject({ position: 1, points: 26, wins: 1, played: 1 });
    expect(detail.table.map((r) => r.points)).toEqual([26, 19, 16, 13, 11, 9, 7, 5].slice(0, detail.table.length));
    expect(z.array(League).parse((await call('GET', '/leagues?game=8-ball-pool')).data)).toHaveLength(1);
    expect((await call('GET', '/leagues/nada')).status).toBe(404);
  });

  it('criar: visitante 401, participante 403, organizador 201; regra inválida 400', async () => {
    as(null);
    expect((await call('POST', '/organizer/leagues', input)).status).toBe(401);
    as(BIANCA);
    expect((await call('POST', '/organizer/leagues', input)).status).toBe(403);
    as(CAMILA);
    expect((await call('POST', '/organizer/leagues', { ...input, rule: { placementPoints: [1, 5], participationPoints: 0 } })).status).toBe(400);
    const res = await call('POST', '/organizer/leagues', input);
    expect(res.status).toBe(201);
    const league = League.parse(res.data);
    expect(league).toMatchObject({ slug: 'liga-das-quintas', owner: { id: CAMILA }, tournaments: [] });
    expect(z.array(League).parse((await call('GET', '/organizer/leagues')).data).map((l) => l.id)).toEqual([league.id]);
    as(DIEGO);
    expect(z.array(League).parse((await call('GET', '/organizer/leagues')).data).map((l) => l.id)).toEqual(['lg_circuito_8ball']);
  });

  it('campeonatos: só os que a pessoa organiza, do mesmo jogo, uma liga por campeonato; editar e apagar', async () => {
    as(CAMILA);
    const league = League.parse((await call('POST', '/organizer/leagues', input)).data);
    const add = (tournamentId: string) => call('POST', `/organizer/leagues/${league.id}/tournaments`, { tournamentId });
    const added = await add('tn_liga_cr');
    expect(League.parse(added.data).tournaments).toEqual([expect.objectContaining({ id: 'tn_liga_cr', counted: false })]);
    expect((await add('tn_liga_cr')).code).toBe('TOURNAMENT_IN_LEAGUE');
    expect((await add('tn_copa_ff')).code).toBe('GAME_MISMATCH');
    expect((await add('tn_open_8ball')).status).toBe(403);
    as(DIEGO);
    expect((await call('PATCH', `/organizer/leagues/${league.id}`, { name: 'Roubada' })).status).toBe(403);
    expect((await call('DELETE', `/organizer/leagues/${league.id}`)).status).toBe(403);
    as(ANA);
    expect((await call('PATCH', `/organizer/leagues/${league.id}`, { description: 'Ajuste do Admin' })).status).toBe(200);
    as(CAMILA);
    expect((await call('PATCH', `/organizer/leagues/${league.id}`, { endsAt: '2025-01-01T00:00:00.000Z' })).status).toBe(400);
    expect((await call('DELETE', `/organizer/leagues/${league.id}/tournaments/tn_liga_cr`)).status).toBe(200);
    expect((await call('DELETE', `/organizer/leagues/${league.id}/tournaments/tn_liga_cr`)).status).toBe(404);
    expect((await call('DELETE', `/organizer/leagues/${league.id}`)).status).toBe(200);
    expect((await call('GET', `/leagues/${league.slug}`)).status).toBe(404);
    expect(auditLogs().filter((l) => l.action === 'LEAGUE_CHANGED' && l.entityId === league.id).length).toBeGreaterThanOrEqual(5);
  });

  it('a regra nova recalcula a tabela', async () => {
    as(DIEGO);
    await call('PATCH', '/organizer/leagues/lg_circuito_8ball', { rule: { placementPoints: [3, 2, 1], participationPoints: 0 } });
    const detail = LeagueDetail.parse((await call('GET', '/leagues/circuito-8-ball-pool')).data);
    expect(detail.table.slice(0, 4).map((r) => r.points)).toEqual([3, 2, 1, 0]);
  });
});
