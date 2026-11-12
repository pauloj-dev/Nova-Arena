/** Módulo `games` da API simulada: leitura pública do catálogo e ranking por jogo. */
import { http } from 'msw';
import type { GameRanking, GameRankingEntry, TournamentStatus } from '@nova/schemas';
import { db } from '../db';
import { currentUser, handle, isAdmin, json, notFound, param, query, url } from '../http';

export const moduleName = 'games';

/** Campeonato "disputado": já começou (em andamento, pausado) ou terminou. */
const PLAYED_STATUSES: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED', 'FINISHED'];

export const handlers = [
  http.get(
    url('/games'),
    handle(({ request }) => {
      const user = currentUser();
      // Jogos desativados só aparecem para o Admin (e com `all=1`).
      const includeInactive = query(request).get('all') === '1' && user !== null && isAdmin(user);
      const games = db().games.filter((g) => includeInactive || g.active);
      return json(games);
    }),
  ),
  http.get(
    url('/games/:slug'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const game = db().games.find((g) => g.slug === slug || g.id === slug);
      if (!game) throw notFound('Jogo');
      return json(game);
    }),
  ),

  /**
   * Ranking por jogo com os dados que já existem (ADR-0001, sem ELO): campeonatos disputados e finalizados,
   * contados pelas inscrições confirmadas. Títulos, vitórias e kills ficam nulos até os resultados de partidas
   * existirem (F2) — a estrutura da resposta já está pronta para eles.
   */
  http.get(
    url('/games/:slug/ranking'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const d = db();
      const game = d.games.find((g) => g.slug === slug || g.id === slug);
      if (!game || !game.active) throw notFound('Jogo');

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

      const rows = [...played.entries()]
        .map(([userId, counts]) => ({ user: d.users.find((u) => u.id === userId), counts }))
        .filter((x) => x.user !== undefined && x.user.status === 'ACTIVE')
        .sort(
          (a, b) =>
            b.counts.tournamentsPlayed - a.counts.tournamentsPlayed ||
            b.counts.tournamentsFinished - a.counts.tournamentsFinished ||
            (a.user?.nickname ?? '').localeCompare(b.user?.nickname ?? '', 'pt-BR'),
        )
        .slice(0, 100);

      // Empate nos números = mesma posição (1, 1, 3…): sem resultados, não há como desempatar de verdade.
      const entries: GameRankingEntry[] = [];
      rows.forEach((row, index) => {
        const previous = rows[index - 1];
        const tied = previous !== undefined && previous.counts.tournamentsPlayed === row.counts.tournamentsPlayed && previous.counts.tournamentsFinished === row.counts.tournamentsFinished;
        entries.push({
          position: tied ? (entries[index - 1]?.position ?? index + 1) : index + 1,
          userId: row.user?.id ?? '',
          nickname: row.user?.nickname ?? 'Jogador',
          avatarUrl: row.user?.avatarUrl ?? null,
          tournamentsPlayed: row.counts.tournamentsPlayed,
          tournamentsFinished: row.counts.tournamentsFinished,
          titles: null,
          wins: null,
          kills: null,
        });
      });

      const ranking: GameRanking = { gameId: game.id, gameSlug: game.slug, gameName: game.name, resultsAvailable: false, entries };
      return json(ranking);
    }),
  ),
];
