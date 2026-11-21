/**
 * Pontos de cada participação, sempre calculados pelo motor (RN-01): o cliente manda só estatísticas brutas.
 * Mesma conta da API simulada (`apps/web/mocks/competition.ts`).
 */
import { computePoints, type MatchNode, type MatchResult, type ResultEntry, type Rule, type StageStructure } from '@nova/engine';

export interface EntryPoints {
  total: number;
  breakdown: { label: string; points: number }[];
}

/** Quantas quedas tem o grupo/sala da partida (o `MULTIPLIER` da última queda depende disso). */
export function dropCountOf(structure: StageStructure, node: MatchNode): number {
  return node.kind === 'LOBBY' ? structure.matches.filter((m) => m.kind === 'LOBBY' && m.groupId === node.groupId).length : 1;
}

export function entryPoints(entry: ResultEntry, node: MatchNode, result: Pick<MatchResult, 'winnerId' | 'draw'>, rules: Rule[], dropCount: number): EntryPoints {
  if (node.kind === 'LOBBY') {
    if (entry.absent) return { total: 0, breakdown: [] };
    const r = computePoints({ kills: entry.kills ?? 0, placement: entry.placement, ...entry.stats }, rules, { matchIndex: node.dropIndex ?? 1, matchCount: dropCount, multiplier: node.multiplier ?? 1 });
    return { total: r.total, breakdown: r.breakdown.map((b) => ({ label: b.label, points: b.points })) };
  }
  const outcome = result.draw ? 'draw' : result.winnerId === entry.entrantId ? 'win' : 'loss';
  const r = computePoints({ score: entry.score ?? 0, outcome, ...entry.stats }, rules);
  return { total: r.total, breakdown: r.breakdown.map((b) => ({ label: b.label, points: b.points })) };
}

/** Pontos de um participante numa partida com resultado (anulado = sem pontos). */
export function pointsOf(structure: StageStructure, node: MatchNode, result: MatchResult | undefined, registrationId: string, rules: Rule[]): number | null {
  const entry = result?.entries.find((e) => e.entrantId === registrationId);
  if (!entry || !result || result.voided) return null;
  return entryPoints(entry, node, result, rules, dropCountOf(structure, node)).total;
}
