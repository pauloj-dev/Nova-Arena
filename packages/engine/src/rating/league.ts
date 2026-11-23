/**
 * Ligas semanais (issue #120, plano §11 melhoria 9): cada campeonato encerrado da liga dá pontos pela colocação
 * final, e a tabela da liga soma esses pontos. Funções puras.
 */
import { EngineError } from '../errors';

export interface LeagueRule {
  /** Pontos por colocação: índice 0 = 1º lugar. Colocação além da lista vale 0 (mais a participação). */
  placementPoints: readonly number[];
  /** Pontos por ter jogado o campeonato, somados a todos. */
  participationPoints: number;
}

export interface LeaguePlacement {
  /** Quem pontua: o mesmo jogador ou squad em todos os campeonatos (ex.: `u:<id>`, `t:<id>`). */
  key: string;
  name: string;
  placement: number;
}

export interface LeagueTournamentResult {
  tournamentId: string;
  placements: readonly LeaguePlacement[];
}

export interface LeagueRowResult {
  tournamentId: string;
  placement: number;
  points: number;
}

export interface LeagueRow {
  key: string;
  name: string;
  position: number;
  points: number;
  /** Campeonatos da liga que jogou. */
  played: number;
  /** Títulos (1º lugar). */
  wins: number;
  bestPlacement: number;
  results: LeagueRowResult[];
}

export function validateLeagueRule(rule: LeagueRule): string[] {
  const errors: string[] = [];
  if (rule.placementPoints.length === 0) errors.push('Informe os pontos de pelo menos o 1º lugar.');
  if (rule.placementPoints.some((p) => !Number.isInteger(p) || p < 0)) errors.push('Os pontos por colocação precisam ser números inteiros a partir de 0.');
  if (rule.placementPoints.some((p, i) => i > 0 && p > (rule.placementPoints[i - 1] as number))) errors.push('Uma colocação não pode valer mais do que a anterior.');
  if (!Number.isInteger(rule.participationPoints) || rule.participationPoints < 0) errors.push('Os pontos de participação precisam ser um número inteiro a partir de 0.');
  return errors;
}

/** Pontos de uma colocação final (1 = campeão). */
export function leaguePointsFor(placement: number, rule: LeagueRule): number {
  if (!Number.isInteger(placement) || placement < 1) throw new EngineError('INVALID_RESULT', 'A colocação precisa ser um número inteiro a partir de 1.');
  return (rule.placementPoints[placement - 1] ?? 0) + rule.participationPoints;
}

/**
 * Colocação final de cada inscrição de um campeonato encerrado.
 *
 * `stageOrders`: a ordem da tabela de cada fase, da primeira para a última. Quem chegou mais longe fica na frente:
 * primeiro a ordem da última fase, depois quem parou na fase anterior (na ordem dela), e assim por diante.
 * `podium` (1º, 2º, 3º), quando informado, vem antes de todos — o pódio é decisão da organização.
 */
export function finalPlacements(stageOrders: readonly (readonly string[])[], podium: readonly string[] = []): Record<string, number> {
  const order: string[] = [];
  const placed = new Set<string>();
  const push = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    order.push(id);
  };
  podium.forEach(push);
  for (let i = stageOrders.length - 1; i >= 0; i -= 1) (stageOrders[i] as readonly string[]).forEach(push);
  return Object.fromEntries(order.map((id, index) => [id, index + 1]));
}

/**
 * Tabela da liga: mais pontos; no empate, mais títulos, melhor colocação, mais campeonatos jogados. Empate em tudo =
 * mesma posição (o nome só decide a ordem de exibição).
 */
export function computeLeagueTable(results: readonly LeagueTournamentResult[], rule: LeagueRule): LeagueRow[] {
  const rows = new Map<string, LeagueRow>();
  for (const tournament of results) {
    // A mesma pessoa duas vezes no mesmo campeonato (não deveria acontecer): vale a melhor colocação.
    const best = new Map<string, LeaguePlacement>();
    for (const p of tournament.placements) {
      const current = best.get(p.key);
      if (!current || p.placement < current.placement) best.set(p.key, p);
    }
    for (const p of best.values()) {
      const points = leaguePointsFor(p.placement, rule);
      const row = rows.get(p.key) ?? { key: p.key, name: p.name, position: 0, points: 0, played: 0, wins: 0, bestPlacement: Number.POSITIVE_INFINITY, results: [] };
      row.name = p.name;
      row.points += points;
      row.played += 1;
      if (p.placement === 1) row.wins += 1;
      row.bestPlacement = Math.min(row.bestPlacement, p.placement);
      row.results.push({ tournamentId: tournament.tournamentId, placement: p.placement, points });
      rows.set(p.key, row);
    }
  }
  const compare = (a: LeagueRow, b: LeagueRow) => b.points - a.points || b.wins - a.wins || a.bestPlacement - b.bestPlacement || b.played - a.played;
  const sorted = [...rows.values()].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name, 'pt-BR') || (a.key < b.key ? -1 : 1));
  sorted.forEach((row, index) => {
    const previous = sorted[index - 1];
    row.position = previous && compare(previous, row) === 0 ? previous.position : index + 1;
  });
  return sorted;
}
