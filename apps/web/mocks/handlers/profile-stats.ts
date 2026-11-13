/**
 * Módulo `profile-stats` da API simulada: perfil competitivo (PAR-11, RF-22).
 * Tudo é derivado do que já está gravado: inscrições, resultados das fases e pódios.
 */
import { http, type HttpHandler } from 'msw';
import type { CompetitiveStats } from '@nova/schemas';
import { buildStandings, matchId, matchMetas, podiums, stageRuns, type DbStageRun } from '../competition';
import { db, type DbRegistration, type DbTournament, type DbUser } from '../db';
import { handle, json, notFound, param, url } from '../http';
import { toRegistration } from '../views';

export const moduleName = 'profile-stats';

type PerGame = CompetitiveStats['perGame'][number];
type Achievement = CompetitiveStats['achievements'][number];
type HistoryEntry = CompetitiveStats['history'][number];

const PODIUM_ACHIEVEMENT: Record<number, { type: Achievement['type']; label: string }> = {
  1: { type: 'CHAMPION', label: 'Campeão' },
  2: { type: 'RUNNER_UP', label: 'Vice-campeão' },
  3: { type: 'THIRD_PLACE', label: '3º lugar' },
};

/** As inscrições pelas quais o usuário jogou (solo ou como membro confirmado do squad). */
function registrationsOf(userId: string): DbRegistration[] {
  return db().registrations.filter(
    (r) => ['CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'].includes(r.status) && (r.userId === userId || r.members.some((m) => m.userId === userId && m.confirmedAt)),
  );
}

interface Totals {
  matches: number;
  wins: number;
  kills: number;
  score: number;
}

/** Soma as partidas de uma inscrição em uma fase, a partir dos resultados gravados (anulados não contam). */
function totalsInRun(run: DbStageRun, registrationId: string, userId: string): Totals {
  const totals: Totals = { matches: 0, wins: 0, kills: 0, score: 0 };
  const metas = matchMetas();
  for (const node of run.structure.matches) {
    const result = run.state.results[node.id];
    if (!result || result.voided) continue;
    const entry = result.entries.find((e) => e.entrantId === registrationId);
    if (!entry) continue;
    if (node.kind === 'LOBBY') {
      if (entry.absent) continue;
      totals.matches += 1;
      if (entry.placement === 1) totals.wins += 1;
      // Com kills por jogador (RN-03), valem as do próprio jogador; sem isso, as da equipe.
      const own = metas.find((m) => m.id === matchId(run.stageId, node.id))?.playerKills[registrationId]?.[userId];
      totals.kills += own ?? entry.kills ?? 0;
    } else {
      // Vaga de bye não é partida jogada.
      if (node.slots.length !== 2) continue;
      totals.matches += 1;
      if (result.winnerId === registrationId) totals.wins += 1;
      totals.score += entry.score ?? 0;
    }
  }
  return totals;
}

/** Colocação final: o pódio quando existe; senão, a posição na tabela da última fase. */
function finalPlacement(tournament: DbTournament, registrationId: string): number | null {
  const place = podiums()
    .find((p) => p.tournamentId === tournament.id)
    ?.places.find((p) => p.registrationId === registrationId)?.place;
  if (place !== undefined) return place;
  const last = [...tournament.stages].sort((a, b) => b.order - a.order)[0];
  if (!last) return null;
  return buildStandings(last.id).overall.find((row) => row.registrationId === registrationId)?.position ?? null;
}

function statsOf(user: DbUser): CompetitiveStats {
  const d = db();
  const runs = stageRuns().filter((r) => r.confirmed);
  const perGame = new Map<string, PerGame>();
  const achievements: Achievement[] = [];
  const history: HistoryEntry[] = [];
  const played: { tournament: DbTournament; startedAt: string }[] = [];

  for (const registration of registrationsOf(user.id)) {
    const tournament = d.tournaments.find((t) => t.id === registration.tournamentId);
    if (!tournament || tournament.status === 'CANCELLED') continue;
    // "Disputado" = entrou em pelo menos uma chave confirmada.
    const mine = runs.filter((r) => r.tournamentId === tournament.id && r.structure.entrants.some((e) => e.id === registration.id));
    if (mine.length === 0) continue;
    const game = d.games.find((g) => g.id === tournament.gameId);
    const row = perGame.get(tournament.gameId) ?? { gameId: tournament.gameId, gameName: game?.name ?? 'Jogo', gameIcon: game?.icon ?? '🎮', tournaments: 0, titles: 0, wins: 0, matches: 0, kills: 0, score: 0 };
    row.tournaments += 1;
    for (const run of mine) {
      const t = totalsInRun(run, registration.id, user.id);
      row.matches += t.matches;
      row.wins += t.wins;
      row.kills += t.kills;
      row.score += t.score;
    }
    perGame.set(tournament.gameId, row);
    played.push({ tournament, startedAt: tournament.startsAt ?? registration.createdAt });

    const podium = podiums().find((p) => p.tournamentId === tournament.id);
    const finished = tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED';
    const place = podium?.places.find((p) => p.registrationId === registration.id)?.place;
    if (place === 1) row.titles += 1;
    const medal = place !== undefined ? PODIUM_ACHIEVEMENT[place] : undefined;
    if (podium && medal) achievements.push({ id: `ach_${tournament.id}_${place}`, type: medal.type, label: medal.label, tournamentName: tournament.name, awardedAt: podium.finishedAt });

    // MVP: mais kills individuais em alguma fase de um campeonato encerrado.
    if (finished && tournament.stages.some((s) => buildStandings(s.id).mvp[0]?.userId === user.id)) {
      achievements.push({ id: `ach_${tournament.id}_mvp`, type: 'MVP', label: 'MVP', tournamentName: tournament.name, awardedAt: podium?.finishedAt ?? tournament.updatedAt });
    }

    history.push({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      tournamentSlug: tournament.slug,
      gameIcon: game?.icon ?? '🎮',
      placement: finished ? finalPlacement(tournament, registration.id) : null,
      finishedAt: finished ? (podium?.finishedAt ?? tournament.updatedAt) : null,
      teamName: registration.teamId ? toRegistration(registration).displayName : null,
    });
  }

  played.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const first = played[0];
  if (first) achievements.push({ id: 'ach_first_tournament', type: 'FIRST_TOURNAMENT', label: 'Primeiro campeonato', tournamentName: first.tournament.name, awardedAt: first.startedAt });
  const tenth = played[9];
  if (tenth) achievements.push({ id: 'ach_ten_tournaments', type: 'TEN_TOURNAMENTS', label: '10 campeonatos disputados', tournamentName: null, awardedAt: tenth.startedAt });

  // Em andamento primeiro; depois os encerrados, do mais recente para o mais antigo.
  history.sort((a, b) => (a.finishedAt === null ? 0 : 1) - (b.finishedAt === null ? 0 : 1) || (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  achievements.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));

  return {
    userId: user.id,
    perGame: [...perGame.values()].sort((a, b) => b.tournaments - a.tournaments || a.gameName.localeCompare(b.gameName)),
    achievements,
    history,
  };
}

export const handlers: HttpHandler[] = [
  // Registrado antes do módulo `users`: `/users/:nickname/stats` não cai em `/users/:nickname`.
  http.get(
    url('/users/:nickname/stats'),
    handle(({ params }) => {
      const nickname = decodeURIComponent(param(params, 'nickname')).toLowerCase();
      const user = db().users.find((u) => u.nickname.toLowerCase() === nickname);
      if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');
      return json(statsOf(user));
    }),
  ),
];
