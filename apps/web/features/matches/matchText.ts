/**
 * Textos de partida em pt-BR, usados pelo `MatchCard`, pela chave e pelas listas.
 * Funções puras: recebem a partida do contrato e devolvem frases prontas.
 */
import type { Match, MatchParticipant, MatchStatus } from '@nova/schemas';
import { browserTimeZone, formatDate, formatDateTime, formatTime, timeZoneLabel } from '@/shared/lib/datetime';

/** Texto do status para frases (o `StatusPill` tem o seu próprio rótulo). */
export const MATCH_STATUS_TEXT: Record<MatchStatus, string> = {
  SCHEDULED: 'agendada',
  CHECK_IN: 'check-in aberto',
  LIVE: 'ao vivo',
  AWAITING_VALIDATION: 'aguardando validação',
  VALIDATED: 'concluída',
  DISPUTED: 'em disputa',
  WALKOVER: 'W.O.',
  CANCELLED: 'cancelada',
};

/** Rótulo do `StatusPill` quando o padrão do design system não serve para partida. */
export const MATCH_STATUS_PILL_LABEL: Partial<Record<MatchStatus, string>> = { CANCELLED: 'Cancelada' };

/** Tem resultado valendo (jogada ou W.O.). */
export function isConcluded(match: Pick<Match, 'status'>): boolean {
  return match.status === 'VALIDATED' || match.status === 'WALKOVER';
}

/** Não vai mais mudar de mãos: concluída, W.O. ou cancelada. */
export function isOver(match: Pick<Match, 'status'>): boolean {
  return isConcluded(match) || match.status === 'CANCELLED';
}

/** O que mostrar em uma vaga: o nome, ou de onde vem o ocupante enquanto ele não é conhecido. */
export function slotText(p: Pick<MatchParticipant, 'registrationId' | 'name' | 'sourceLabel'>): string {
  if (p.registrationId) return p.name;
  return p.sourceLabel ?? 'A definir';
}

/** Mesma coisa, para frases: "a definir (Vencedor: Quartas de final 3)". */
function slotSpoken(p: MatchParticipant): string {
  if (p.registrationId) return p.name;
  return p.sourceLabel ? `a definir (${p.sourceLabel})` : 'a definir';
}

export function bestOfLabel(bestOf: number): string {
  return `MD${bestOf}`;
}

/** "Mata-mata · Quartas de final" ou "Fase de grupos · Grupo A · Queda 2". */
export function matchHeading(match: Pick<Match, 'stageName' | 'groupName' | 'roundLabel'>): string {
  return [match.stageName, match.groupName, match.roundLabel].filter(Boolean).join(' · ');
}

/** "12/11 · 20h", para espaços pequenos. O fuso vai em outro lugar da mesma tela. */
export function shortSchedule(iso: string, timeZone?: string): string {
  const zone = timeZone ?? browserTimeZone();
  return `${formatDate(iso, { timeZone: zone }).slice(0, 5)} · ${formatTime(iso, { timeZone: zone })}`;
}

/** "sáb., 14/11 · 20h · horário de Brasília" ou "Horário a definir". */
export function scheduleText(match: Pick<Match, 'scheduledAt'>, timeZone?: string): string {
  return match.scheduledAt ? formatDateTime(match.scheduledAt, timeZone ? { timeZone } : undefined) : 'Horário a definir';
}

/** Quem venceu, em uma frase. Nulo enquanto não há resultado. */
export function resultText(match: Match): string | null {
  if (!isConcluded(match)) return null;
  if (match.kind === 'LOBBY') {
    const first = match.participants.find((p) => p.placement === 1);
    return first ? `${first.name} levou o Booyah` : null;
  }
  const winner = match.participants.find((p) => p.isWinner === true);
  const loser = match.participants.find((p) => p.isWinner === false);
  if (!winner) {
    const [a, b] = match.participants;
    return a && b && a.score !== null && b.score !== null ? `empate em ${a.score} a ${b.score}` : null;
  }
  if (match.walkover || match.status === 'WALKOVER') return `${winner.name} venceu por W.O.`;
  if (winner.score !== null && loser && loser.score !== null) return `${winner.name} venceu por ${winner.score} a ${loser.score}`;
  return `${winner.name} venceu`;
}

export interface AriaLabelOptions {
  timeZone?: string;
  /** Inscrição de quem está vendo: acrescenta "seu confronto" quando ela está na partida. */
  highlightRegistrationId?: string | null;
}

/**
 * Nome acessível completo de um confronto (RNF-11):
 * "Quartas de final: Squad Alfa contra Squad Bravo, 12/11 às 20h, horário de Brasília, agendada".
 */
export function matchAriaLabel(match: Match, opts: AriaLabelOptions = {}): string {
  const zone = opts.timeZone ?? browserTimeZone();
  const head = [match.groupName, match.roundLabel].filter(Boolean).join(', ');
  const count = match.participants.length;
  const who = match.kind === 'LOBBY' ? `${count} ${count === 1 ? 'equipe' : 'equipes'}` : match.participants.map(slotSpoken).join(' contra ');
  const when = match.scheduledAt
    ? `${formatDate(match.scheduledAt, { timeZone: zone }).slice(0, 5)} às ${formatTime(match.scheduledAt, { timeZone: zone })}, ${timeZoneLabel(zone, new Date(match.scheduledAt))}`
    : 'horário a definir';
  const parts = [`${head}: ${who}`, when, MATCH_STATUS_TEXT[match.status]];
  const result = resultText(match);
  if (result && match.status !== 'WALKOVER') parts.push(result);
  if (result && match.status === 'WALKOVER') parts[parts.length - 1] = result;
  if (match.ifNecessary && !isOver(match)) parts.push('só acontece se for necessário');
  if (opts.highlightRegistrationId && match.participants.some((p) => p.registrationId === opts.highlightRegistrationId)) parts.push('seu confronto');
  return parts.join(', ');
}

/** A vaga da inscrição nesta partida, se ela estiver nela. */
export function participantOf(match: Match, registrationId: string | null | undefined): MatchParticipant | undefined {
  return registrationId ? match.participants.find((p) => p.registrationId === registrationId) : undefined;
}

/** O adversário em um duelo (nulo em queda BR ou enquanto a vaga está vazia). */
export function opponentOf(match: Match, registrationId: string): MatchParticipant | null {
  if (match.kind !== 'DUEL') return null;
  return match.participants.find((p) => p.registrationId !== registrationId) ?? null;
}
