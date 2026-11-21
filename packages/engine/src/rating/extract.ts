/**
 * Do retrato da fase (`structure` + `state`) para as partidas que contam no rating (ADR-0003).
 *
 * Contam: duelos com os dois lados definidos e quedas de Battle Royale com resultado validado.
 * Não contam: resultado anulado, W.O. (ninguém jogou), vaga de bye e equipe ausente na queda.
 */
import type { MatchResult, StageState, StageStructure } from '../types';
import type { RatingMatch, RatingSide } from './replay';

export interface RatingEntrantInfo {
  members: readonly string[];
  teamId: string | null;
}

export interface ExtractOptions {
  /** Quem joga por cada inscrição. `null` = inscrição sem conta (importada). */
  resolve: (entrantId: string) => RatingEntrantInfo | null;
  /** Quando a partida foi validada. `null` = sem data conhecida: a partida fica de fora. */
  timeOf: (nodeId: string) => string | null;
  /** Prefixo do id da partida no replay (ex.: o id da fase), para não colidir entre fases. */
  idPrefix?: string;
}

const ANONYMOUS: RatingEntrantInfo = { members: [], teamId: null };

function side(entrantId: string, placement: number, opts: ExtractOptions): RatingSide {
  const info = opts.resolve(entrantId) ?? ANONYMOUS;
  return { entrantId, placement, members: info.members, teamId: info.teamId };
}

function duelSides(slots: readonly (string | null)[], result: MatchResult, opts: ExtractOptions): RatingSide[] | null {
  const [a, b] = slots;
  if (slots.length !== 2 || !a || !b) return null;
  if (result.draw) return [side(a, 1, opts), side(b, 1, opts)];
  if (result.winnerId !== a && result.winnerId !== b) return null;
  return [side(a, result.winnerId === a ? 1 : 2, opts), side(b, result.winnerId === b ? 1 : 2, opts)];
}

function lobbySides(result: MatchResult, opts: ExtractOptions): RatingSide[] {
  return result.entries
    .filter((e) => !e.absent && typeof e.placement === 'number' && Number.isInteger(e.placement) && e.placement >= 1)
    .map((e) => side(e.entrantId, e.placement as number, opts));
}

export function ratingMatchesFromStage(structure: StageStructure, state: StageState, opts: ExtractOptions): RatingMatch[] {
  const out: RatingMatch[] = [];
  for (const node of structure.matches) {
    const result = state.results[node.id];
    if (!result || result.voided || result.walkover) continue;
    const at = opts.timeOf(node.id);
    if (!at) continue;
    const sides = node.kind === 'LOBBY' ? lobbySides(result, opts) : duelSides(node.slots.map((s) => s.entrantId), result, opts);
    if (!sides || sides.length < 2) continue;
    out.push({ id: `${opts.idPrefix ?? ''}${node.id}`, at, sides });
  }
  return out;
}
