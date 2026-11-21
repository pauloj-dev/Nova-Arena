/**
 * Perfil competitivo (issue #89, PRD PAR-11, RF-22). Porta de `apps/web/mocks/handlers/profile-stats.ts`.
 *
 * `GET /users/:nickname/stats` (público): números por jogo (campeonatos, títulos, vitórias, partidas, kills e placar),
 * conquistas e histórico — tudo derivado do que está gravado: inscrições, retrato do motor de cada fase, kills por
 * jogador (`player_stats`), pódio (`tournament_podiums`), tabela final (`standings`) e as conquistas gravadas no
 * encerramento (`achievements`: medalhas do pódio e MVP). "Primeiro campeonato" e "10 campeonatos" saem da contagem.
 * Campeonato cancelado não conta; inscrição que não entrou em chave confirmada também não.
 */
import type { MatchResult } from '@nova/engine';
import { CompetitiveStats } from '@nova/schemas';
import { Hono } from 'hono';
import { respond, type AppEnv } from '../../context';
import { notFound } from '../../errors';
import { EDGE_CACHE, publicCache } from '../../http-cache';
import { registrationIdsOfUser } from '../registrations/core';
import { readRun, type StageRun } from '../../competition/run';

type PerGame = CompetitiveStats['perGame'][number];
type Achievement = CompetitiveStats['achievements'][number];
type HistoryEntry = CompetitiveStats['history'][number];

const MEDALS: Record<string, { type: Achievement['type']; label: string }> = {
  CHAMPION: { type: 'CHAMPION', label: 'Campeão' },
  RUNNER_UP: { type: 'RUNNER_UP', label: 'Vice-campeão' },
  THIRD_PLACE: { type: 'THIRD_PLACE', label: '3º lugar' },
  MVP: { type: 'MVP', label: 'MVP' },
};

interface Totals {
  matches: number;
  wins: number;
  kills: number;
  score: number;
}

/** Soma as partidas de uma inscrição em uma fase (resultados anulados não contam). */
function totalsInRun(run: StageRun, registrationId: string, ownKills: Map<string, number>): Totals {
  const totals: Totals = { matches: 0, wins: 0, kills: 0, score: 0 };
  for (const node of run.structure.matches) {
    const result = run.state.results[node.id] as MatchResult | undefined;
    if (!result || result.voided) continue;
    const entry = result.entries.find((e) => e.entrantId === registrationId);
    if (!entry) continue;
    if (node.kind === 'LOBBY') {
      if (entry.absent) continue;
      totals.matches += 1;
      if (entry.placement === 1) totals.wins += 1;
      // Com kills por jogador (RN-03), valem as do próprio jogador; sem isso, as da equipe.
      totals.kills += ownKills.get(node.id) ?? entry.kills ?? 0;
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

export const stats = new Hono<AppEnv>();

stats.get('/users/:nickname/stats', async (c) => {
  const db = c.get('deps').db();
  const key = decodeURIComponent(c.req.param('nickname')).toLowerCase();
  const user = await db.user.findUnique({ where: { nicknameKey: key }, select: { id: true, status: true } });
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Perfil');

  // As inscrições pelas quais a pessoa jogou (solo ou como membro confirmado do squad), fora de campeonato cancelado.
  const registrations = await db.registration.findMany({
    where: {
      status: { in: ['CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'] },
      id: { in: await registrationIdsOfUser(db, user.id, { confirmedMember: true }) },
      tournament: { status: { not: 'CANCELLED' } },
    },
    select: {
      id: true,
      teamId: true,
      displayName: true,
      createdAt: true,
      team: { select: { name: true } },
      tournament: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          startsAt: true,
          updatedAt: true,
          game: { select: { id: true, name: true, icon: true } },
          podium: true,
          stages: { where: { confirmedAt: { not: null } }, orderBy: { order: 'asc' }, select: { id: true, order: true, engineSnapshot: true, confirmedAt: true, unlocked: true } },
        },
      },
    },
  });
  const regIds = registrations.map((r) => r.id);
  // Kills do próprio jogador por partida (`nodeId` da fase), quando a fase usa kills por jogador.
  const own = await db.playerStat.findMany({ where: { userId: user.id, matchParticipant: { registrationId: { in: regIds } } }, select: { stats: true, matchParticipant: { select: { match: { select: { stageId: true, nodeId: true } } } } } });
  const ownByStage = new Map<string, Map<string, number>>();
  for (const ps of own) {
    const k = (ps.stats as { kills?: unknown } | null)?.kills;
    if (typeof k !== 'number') continue;
    const { stageId, nodeId } = ps.matchParticipant.match;
    const map = ownByStage.get(stageId) ?? new Map<string, number>();
    map.set(nodeId, (map.get(nodeId) ?? 0) + k);
    ownByStage.set(stageId, map);
  }
  // Colocação na tabela da última fase (quem não subiu ao pódio).
  const lastStageIds = registrations.map((r) => r.tournament.stages.at(-1)?.id).filter((x): x is string => Boolean(x));
  const finalRows = await db.standing.findMany({ where: { stageId: { in: lastStageIds }, registrationId: { in: regIds } }, select: { stageId: true, registrationId: true, position: true } });
  const medals = await db.achievement.findMany({ where: { userId: user.id }, orderBy: { awardedAt: 'desc' } });

  const perGame = new Map<string, PerGame>();
  const achievements: Achievement[] = [];
  const history: HistoryEntry[] = [];
  const played: { name: string; startedAt: Date }[] = [];
  const counted = new Set<string>();

  for (const r of registrations) {
    const t = r.tournament;
    const runs = t.stages
      .map((s) => ({ stageId: s.id, run: readRun(s) }))
      .filter((x): x is { stageId: string; run: StageRun } => Boolean(x.run?.confirmed && x.run.structure.entrants.some((e) => e.id === r.id)));
    // Disputou de fato: entrou em pelo menos uma chave confirmada.
    if (runs.length === 0) continue;
    counted.add(t.id);
    const row = perGame.get(t.game.id) ?? { gameId: t.game.id, gameName: t.game.name, gameIcon: t.game.icon, tournaments: 0, titles: 0, wins: 0, matches: 0, kills: 0, score: 0 };
    row.tournaments += 1;
    for (const { stageId, run } of runs) {
      const totals = totalsInRun(run, r.id, ownByStage.get(stageId) ?? new Map());
      row.matches += totals.matches;
      row.wins += totals.wins;
      row.kills += totals.kills;
      row.score += totals.score;
    }
    const places = (t.podium?.places ?? []) as { place: number; registrationId: string }[];
    const place = places.find((p) => p.registrationId === r.id)?.place;
    if (place === 1) row.titles += 1;
    perGame.set(t.game.id, row);

    played.push({ name: t.name, startedAt: t.startsAt ?? r.createdAt });
    const finished = t.status === 'FINISHED' || t.status === 'ARCHIVED';
    const lastStage = t.stages.at(-1)?.id;
    const tablePosition = finalRows.find((s) => s.stageId === lastStage && s.registrationId === r.id)?.position ?? null;
    history.push({
      tournamentId: t.id,
      tournamentName: t.name,
      tournamentSlug: t.slug,
      gameIcon: t.game.icon,
      placement: finished ? (place ?? tablePosition) : null,
      finishedAt: finished ? (t.podium?.finishedAt ?? t.updatedAt).toISOString() : null,
      teamName: r.teamId ? (r.displayName ?? r.team?.name ?? null) : null,
    });
  }

  // Medalhas do pódio e MVP: gravadas no encerramento (só de campeonatos que contam).
  const names = new Map(registrations.map((r) => [r.tournament.id, r.tournament.name]));
  for (const a of medals) {
    const medal = MEDALS[a.type];
    if (!medal || !a.tournamentId || !counted.has(a.tournamentId)) continue;
    achievements.push({ id: a.id, type: medal.type, label: medal.label, tournamentName: names.get(a.tournamentId) ?? null, awardedAt: a.awardedAt.toISOString() });
  }
  played.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const first = played[0];
  if (first) achievements.push({ id: `first-tournament-${user.id}`, type: 'FIRST_TOURNAMENT', label: 'Primeiro campeonato', tournamentName: first.name, awardedAt: first.startedAt.toISOString() });
  const tenth = played[9];
  if (tenth) achievements.push({ id: `ten-tournaments-${user.id}`, type: 'TEN_TOURNAMENTS', label: '10 campeonatos disputados', tournamentName: null, awardedAt: tenth.startedAt.toISOString() });

  // Em andamento primeiro; depois os encerrados, do mais recente para o mais antigo.
  history.sort((a, b) => (a.finishedAt === null ? 0 : 1) - (b.finishedAt === null ? 0 : 1) || (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
  achievements.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));
  publicCache(c, EDGE_CACHE.profile);
  return respond(c, CompetitiveStats, {
    userId: user.id,
    perGame: [...perGame.values()].sort((a, b) => b.tournaments - a.tournaments || a.gameName.localeCompare(b.gameName)),
    achievements,
    history,
  });
});
