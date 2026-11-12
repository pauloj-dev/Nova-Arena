/**
 * Agrupamento das partidas para as visões em lista: a chave no celular (uma aba por rodada)
 * e os formatos sem chave em árvore (grupos, pontos corridos, suíço e Battle Royale).
 */
import type { Match, StageFormat } from '@nova/schemas';
import { SECTION_LABELS, type BracketSection } from './layout';

export const ELIMINATION_FORMATS: readonly StageFormat[] = ['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM'];

export function isEliminationFormat(format: StageFormat): boolean {
  return ELIMINATION_FORMATS.includes(format);
}

export interface RoundGroup {
  /** Único dentro do lado da chave (vira o valor da aba). */
  key: string;
  label: string;
  matches: Match[];
}

export interface BracketSideGroup {
  side: BracketSection;
  label: string;
  rounds: RoundGroup[];
}

const byPosition = (a: Match, b: Match) => a.position - b.position;

function roundsOf(matches: Match[], prefix: string): RoundGroup[] {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const inRound = matches.filter((m) => m.round === round).sort(byPosition);
    return { key: `${prefix}${round}`, label: inRound[0]?.roundLabel ?? `Rodada ${round}`, matches: inRound };
  });
}

/**
 * Chave eliminatória em lista: um grupo por rodada. Na eliminação dupla, separa
 * "Vencedores", "Perdedores" e "Final". A disputa de 3º lugar entra junto com a final.
 */
export function bracketSides(matches: readonly Match[]): BracketSideGroup[] {
  const duels = matches.filter((m) => m.kind === 'DUEL' && m.bracket !== null);
  const winners = duels.filter((m) => m.bracket === 'WINNERS');
  const third = duels.filter((m) => m.bracket === 'THIRD_PLACE');
  const losers = duels.filter((m) => m.bracket === 'LOSERS');
  const finals = duels.filter((m) => m.bracket === 'FINAL').sort((a, b) => a.round - b.round);

  const winnerRounds = roundsOf(winners, 'w');
  const last = winnerRounds[winnerRounds.length - 1];
  if (last && third.length > 0) last.matches = [...last.matches, ...third];
  else if (third.length > 0) winnerRounds.push({ key: 'third', label: third[0]?.roundLabel ?? 'Disputa de 3º lugar', matches: third });

  const sides: BracketSideGroup[] = [];
  if (winnerRounds.length > 0) sides.push({ side: 'WINNERS', label: losers.length > 0 || finals.length > 0 ? 'Vencedores' : SECTION_LABELS.WINNERS, rounds: winnerRounds });
  if (losers.length > 0) sides.push({ side: 'LOSERS', label: 'Perdedores', rounds: roundsOf(losers, 'l') });
  if (finals.length > 0) sides.push({ side: 'FINAL', label: 'Final', rounds: [{ key: 'gf', label: 'Grande Final', matches: finals }] });
  return sides;
}

export interface StageRoundGroup extends RoundGroup {
  /** Partidas da rodada separadas por grupo ou sala (uma seção só quando a fase não tem grupos). */
  sections: { key: string; name: string | null; matches: Match[] }[];
}

/** Formatos sem árvore: um grupo por rodada (ou queda), com as partidas separadas por grupo/sala. */
export function stageRounds(matches: readonly Match[]): StageRoundGroup[] {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round) => {
    const inRound = matches.filter((m) => m.round === round).sort((a, b) => (a.groupId ?? '').localeCompare(b.groupId ?? '', 'pt-BR', { numeric: true }) || byPosition(a, b));
    const sections: StageRoundGroup['sections'] = [];
    for (const match of inRound) {
      const key = match.groupId ?? '';
      const section = sections.find((s) => s.key === key);
      if (section) section.matches.push(match);
      else sections.push({ key, name: match.groupName, matches: [match] });
    }
    return { key: `r${round}`, label: inRound[0]?.roundLabel ?? `Rodada ${round}`, matches: inRound, sections };
  });
}

const isOpen = (m: Match) => m.status !== 'VALIDATED' && m.status !== 'WALKOVER' && m.status !== 'CANCELLED';

/**
 * A rodada que abre primeiro: a do confronto pendente de quem está vendo; senão, a primeira
 * rodada com partida por jogar; senão, a última (fase concluída).
 */
export function defaultRound(rounds: readonly RoundGroup[], highlightRegistrationId?: string | null): string | undefined {
  if (highlightRegistrationId) {
    const mine = rounds.find((r) => r.matches.some((m) => isOpen(m) && m.participants.some((p) => p.registrationId === highlightRegistrationId)));
    if (mine) return mine.key;
  }
  const pending = rounds.find((r) => r.matches.some((m) => isOpen(m) && !m.waitingPrevious)) ?? rounds.find((r) => r.matches.some(isOpen));
  return (pending ?? rounds[rounds.length - 1])?.key;
}

/** O lado da chave dupla que abre primeiro, pela mesma regra de `defaultRound`. */
export function defaultSide(sides: readonly BracketSideGroup[], highlightRegistrationId?: string | null): BracketSection | undefined {
  if (highlightRegistrationId) {
    const mine = sides.find((s) => s.rounds.some((r) => r.matches.some((m) => isOpen(m) && m.participants.some((p) => p.registrationId === highlightRegistrationId))));
    if (mine) return mine.side;
  }
  const pending = sides.find((s) => s.rounds.some((r) => r.matches.some((m) => isOpen(m) && !m.waitingPrevious)));
  return (pending ?? sides[sides.length - 1])?.side;
}
