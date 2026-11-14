/** Módulo `games` da API simulada: leitura pública do catálogo e ranking por jogo. */
import { http } from 'msw';
import type { GameRanking, GameRankingEntry, TournamentStatus } from '@nova/schemas';
import type { Game } from '@nova/schemas';
import { db, type DbUser } from '../db';
import { currentUser, handle, isAdmin, json, notFound, param, query, url } from '../http';
import { perGameStats } from './profile-stats';

export const moduleName = 'games';

/** Modelos de pontuação personalizados só aparecem para quem os criou (e para o Admin). */
function visibleGame(game: Game, user: DbUser | null): Game {
  const admin = user !== null && isAdmin(user);
  return { ...game, scoringModels: game.scoringModels.filter((m) => m.ownerId === null || admin || m.ownerId === user?.id) };
}

/** Campeonato "disputado": já começou (em andamento, pausado) ou terminou. */
const PLAYED_STATUSES: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED', 'FINISHED'];

export const handlers = [
  http.get(
    url('/games'),
    handle(({ request }) => {
      const user = currentUser();
      // Jogos desativados só aparecem para o Admin (e com `all=1`).
      const includeInactive = query(request).get('all') === '1' && user !== null && isAdmin(user);
      const games = db()
        .games.filter((g) => includeInactive || g.active)
        .map((g) => visibleGame(g, user));
      return json(games);
    }),
  ),
  http.get(
    url('/games/:slug'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const game = db().games.find((g) => g.slug === slug || g.id === slug);
      if (!game) throw notFound('Jogo');
      return json(visibleGame(game, currentUser()));
    }),
  ),

  /**
   * Ranking por jogo com os dados que já existem (ADR-0001, sem ELO). Os números vêm dos resultados das
   * partidas, com a mesma conta do perfil competitivo (`perGameStats`): títulos, vitórias e kills (Battle
   * Royale) ou placar (duelos). Ordem: títulos → vitórias → kills ou placar → campeonatos disputados →
   * finalizados → apelido. Empate em todos os números = mesma posição (1, 1, 3…).
   */
  http.get(
    url('/games/:slug/ranking'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const d = db();
      const game = d.games.find((g) => g.slug === slug || g.id === slug);
      if (!game || !game.active) throw notFound('Jogo');
      const highlight: GameRanking['highlight'] = game.modes.some((m) => m.matchType === 'BATTLE_ROYALE') ? 'KILLS' : 'SCORE';

      const played = new Map<string, { tournamentsPlayed: number; tournamentsFinished: number }>();
      for (const t of d.tournaments) {
        if (t.gameId !== game.id || !PLAYED_STATUSES.includes(t.status)) continue;
        const finished = t.status === 'FINISHED';
        const userIds = new Set<string>();
        for (const r of d.registrations) {
          if (r.tournamentId !== t.id || r.status !== 'CONFIRMED') continue;
          if (r.userId) userIds.add(r.userId);
          for (const m of r.members) if (m.confirmedAt) userIds.add(m.userId);
        }
        for (const userId of userIds) {
          const row = played.get(userId) ?? { tournamentsPlayed: 0, tournamentsFinished: 0 };
          row.tournamentsPlayed += 1;
          if (finished) row.tournamentsFinished += 1;
          played.set(userId, row);
        }
      }

      type Row = Omit<GameRankingEntry, 'position'>;
      const rows: Row[] = [];
      for (const [userId, counts] of played) {
        const user = d.users.find((u) => u.id === userId);
        if (!user || user.status !== 'ACTIVE') continue;
        const stats = perGameStats(userId).get(game.id);
        rows.push({
          userId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl ?? null,
          tournamentsPlayed: counts.tournamentsPlayed,
          tournamentsFinished: counts.tournamentsFinished,
          titles: stats?.titles ?? 0,
          wins: stats?.wins ?? 0,
          kills: stats?.kills ?? 0,
          score: stats?.score ?? 0,
          matches: stats?.matches ?? 0,
        });
      }
      const key = (r: Row): number[] => [r.titles ?? 0, r.wins ?? 0, highlight === 'KILLS' ? (r.kills ?? 0) : (r.score ?? 0), r.tournamentsPlayed, r.tournamentsFinished];
      const compare = (a: Row, b: Row): number => {
        const ka = key(a);
        const kb = key(b);
        for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return (kb[i] ?? 0) - (ka[i] ?? 0);
        return 0;
      };
      const sorted = rows.sort((a, b) => compare(a, b) || a.nickname.localeCompare(b.nickname, 'pt-BR')).slice(0, 100);

      const entries: GameRankingEntry[] = [];
      sorted.forEach((row, index) => {
        const previous = sorted[index - 1];
        const tied = previous !== undefined && compare(previous, row) === 0;
        entries.push({ ...row, position: tied ? (entries[index - 1]?.position ?? index + 1) : index + 1 });
      });

      const ranking: GameRanking = { gameId: game.id, gameSlug: game.slug, gameName: game.name, resultsAvailable: true, highlight, entries };
      return json(ranking);
    }),
  ),
];
