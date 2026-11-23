/**
 * Replay da temporada (ADR-0003): o rating é uma projeção do histórico de partidas validadas, recalculada do zero
 * na ordem em que as partidas foram validadas. Corrigir ou anular um resultado não exige "desfazer" nada: o próximo
 * replay já sai certo.
 *
 * Dois conjuntos de rating, independentes:
 * - **jogadores** (`players`): cada lado vale a média dos seus jogadores; a variação do lado vai para cada um deles;
 * - **squads** (`teams`): só os lados que são um squad cadastrado.
 * Lado sem ninguém no conjunto (inscrição importada, sem conta) entra com o rating inicial e não é gravado.
 */
import { DEFAULT_RATING_CONFIG, ratingDeltas, type RatedParticipant, type RatingConfig } from './elo';

export interface RatingSide {
  /** Inscrição no campeonato. */
  entrantId: string;
  /** 1 = melhor. Duelo: vencedor 1, perdedor 2; empate: os dois 1. */
  placement: number;
  /** Jogadores com conta (o jogador solo ou os membros confirmados do squad). */
  members: readonly string[];
  /** Squad cadastrado, quando a inscrição é de um squad. */
  teamId: string | null;
}

export interface RatingMatch {
  id: string;
  /** Quando a partida foi validada (ISO 8601, UTC). Define a ordem do replay. */
  at: string;
  sides: readonly RatingSide[];
}

export interface RatingRecord {
  subjectId: string;
  rating: number;
  peak: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  lastDelta: number;
  lastMatchAt: string;
}

export interface RatingChange {
  matchId: string;
  at: string;
  subjectId: string;
  before: number;
  after: number;
  delta: number;
}

export interface RatingPool {
  records: Record<string, RatingRecord>;
  /** Em ordem cronológica. */
  history: RatingChange[];
}

export interface RatingReplay {
  players: RatingPool;
  teams: RatingPool;
}

/** Ordem do replay: pelo horário da validação e, no empate, pelo id (determinístico). */
export function sortRatingMatches<T extends Pick<RatingMatch, 'id' | 'at'>>(matches: readonly T[]): T[] {
  return [...matches].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

type Outcome = 'win' | 'draw' | 'loss';

function outcomeOf(side: RatingSide, sides: readonly RatingSide[]): Outcome {
  const best = Math.min(...sides.map((s) => s.placement));
  const tiedAtBest = sides.filter((s) => s.placement === best).length;
  if (side.placement !== best) return 'loss';
  if (tiedAtBest === 1) return 'win';
  // Empate só existe no duelo; numa queda, dividir a 1ª colocação não é vitória.
  return sides.length === 2 ? 'draw' : 'loss';
}

function emptyPool(): RatingPool {
  return { records: {}, history: [] };
}

function applyToPool(pool: RatingPool, match: RatingMatch, subjectsOf: (side: RatingSide) => readonly string[], cfg: RatingConfig): void {
  const sides = match.sides.map((side) => ({ side, subjects: [...new Set(subjectsOf(side))] }));
  if (!sides.some((s) => s.subjects.length > 0)) return;
  // Um jogador em dois lados (não deveria acontecer) conta só no primeiro.
  const seen = new Set<string>();
  for (const s of sides) {
    s.subjects = s.subjects.filter((id) => !seen.has(id));
    for (const id of s.subjects) seen.add(id);
  }
  const ratingOf = (id: string) => pool.records[id]?.rating ?? cfg.initial;
  const participants: RatedParticipant[] = sides.map((s) => ({
    id: s.side.entrantId,
    placement: s.side.placement,
    rating: s.subjects.length ? s.subjects.reduce((sum, id) => sum + ratingOf(id), 0) / s.subjects.length : cfg.initial,
  }));
  const deltas = ratingDeltas(participants, cfg);
  for (const s of sides) {
    const delta = deltas[s.side.entrantId] as number;
    const outcome = outcomeOf(s.side, match.sides);
    for (const id of s.subjects) {
      const current = pool.records[id] ?? { subjectId: id, rating: cfg.initial, peak: cfg.initial, played: 0, wins: 0, draws: 0, losses: 0, lastDelta: 0, lastMatchAt: match.at };
      const after = current.rating + delta;
      pool.records[id] = {
        subjectId: id,
        rating: after,
        peak: Math.max(current.peak, after),
        played: current.played + 1,
        wins: current.wins + (outcome === 'win' ? 1 : 0),
        draws: current.draws + (outcome === 'draw' ? 1 : 0),
        losses: current.losses + (outcome === 'loss' ? 1 : 0),
        lastDelta: delta,
        lastMatchAt: match.at,
      };
      pool.history.push({ matchId: match.id, at: match.at, subjectId: id, before: current.rating, after, delta });
    }
  }
}

/** Recalcula os ratings de jogadores e squads a partir das partidas (em qualquer ordem: o replay ordena). */
export function replayRatings(matches: readonly RatingMatch[], config: Partial<RatingConfig> = {}): RatingReplay {
  const cfg = { ...DEFAULT_RATING_CONFIG, ...config };
  const players = emptyPool();
  const teams = emptyPool();
  for (const match of sortRatingMatches(matches)) {
    if (match.sides.length < 2) continue;
    applyToPool(players, match, (side) => side.members, cfg);
    applyToPool(teams, match, (side) => (side.teamId ? [side.teamId] : []), cfg);
  }
  return { players, teams };
}

export interface RatingRankingRow extends RatingRecord {
  position: number;
  provisional: boolean;
}

/**
 * Tabela de um conjunto: maior rating primeiro; no empate, quem jogou mais e depois o id. Rating igual (arredondado
 * para inteiro, como a tela mostra) = mesma posição.
 */
export function rankRatings(pool: RatingPool, config: Partial<RatingConfig> = {}): RatingRankingRow[] {
  const cfg = { ...DEFAULT_RATING_CONFIG, ...config };
  const rows = Object.values(pool.records).sort((a, b) => b.rating - a.rating || b.played - a.played || (a.subjectId < b.subjectId ? -1 : 1));
  const out: RatingRankingRow[] = [];
  rows.forEach((row, index) => {
    const previous = out[index - 1];
    const tied = previous !== undefined && Math.round(previous.rating) === Math.round(row.rating);
    out.push({ ...row, position: tied ? previous.position : index + 1, provisional: row.played < cfg.provisionalMatches });
  });
  return out;
}
