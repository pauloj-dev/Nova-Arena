/**
 * Textos de uma partida da chave: estado (sempre ícone + texto), nome de cada lado e o
 * `aria-label` lido pelo leitor de tela ("Quartas de final: Squad Alfa contra Squad Bravo, 20h").
 */
import type { Match, MatchParticipant } from '@nova/schemas';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass, Radio, UserX, XCircle, type LucideIcon } from 'lucide-react';
import { formatTime } from '@/shared/lib/datetime';

export type MatchTone = 'neutral' | 'info' | 'primary' | 'warning' | 'danger';

export interface MatchStateInfo {
  label: string;
  icon: LucideIcon;
  tone: MatchTone;
  live: boolean;
}

/** Estado exibido. Partida esperando quem vem das anteriores aparece como "Aguardando". */
export function matchState(match: Pick<Match, 'status' | 'waitingPrevious'>): MatchStateInfo {
  switch (match.status) {
    case 'CHECK_IN':
      return { label: 'Check-in', icon: Clock, tone: 'warning', live: false };
    case 'LIVE':
      return { label: 'Ao vivo', icon: Radio, tone: 'primary', live: true };
    case 'AWAITING_VALIDATION':
      return { label: 'Validando', icon: Hourglass, tone: 'warning', live: false };
    case 'VALIDATED':
      return { label: 'Concluída', icon: CheckCircle2, tone: 'neutral', live: false };
    case 'DISPUTED':
      return { label: 'Em disputa', icon: AlertTriangle, tone: 'warning', live: false };
    case 'WALKOVER':
      return { label: 'W.O.', icon: UserX, tone: 'danger', live: false };
    case 'CANCELLED':
      return { label: 'Cancelada', icon: XCircle, tone: 'neutral', live: false };
    case 'SCHEDULED':
    default:
      return match.waitingPrevious ? { label: 'Aguardando', icon: Hourglass, tone: 'neutral', live: false } : { label: 'Agendada', icon: CalendarClock, tone: 'info', live: false };
  }
}

/** Nome de um lado: o inscrito, "Folga" ou de onde ele vem ("Vencedor: Quartas de final 2"). */
export function participantName(p: MatchParticipant | undefined): string {
  if (!p) return 'A definir';
  if (p.registrationId) return p.name;
  if (p.isBye) return 'Folga';
  return p.sourceLabel ?? 'A definir';
}

export function isPlaceholder(p: MatchParticipant | undefined): boolean {
  return !p?.registrationId;
}

/** "(desistiu)" / "(desclassificado)" depois do nome. */
export function participantNote(p: MatchParticipant | undefined): string | null {
  if (!p?.registrationId) return null;
  if (p.status === 'WITHDRAWN') return 'desistiu';
  if (p.status === 'DISQUALIFIED') return 'desclassificado';
  return null;
}

/** Horário curto ("20h") ou nada. */
export function matchTime(match: Pick<Match, 'scheduledAt'>, timeZone?: string): string | null {
  return match.scheduledAt ? formatTime(match.scheduledAt, { timeZone }) : null;
}

/** Placar "2 x 1" quando os dois lados têm placar. */
export function scoreLine(match: Match): string | null {
  const [a, b] = match.participants;
  if (a?.score == null || b?.score == null) return null;
  return `${a.score} x ${b.score}`;
}

export function winnerOf(match: Match): MatchParticipant | undefined {
  return match.participants.find((p) => p.isWinner && p.registrationId);
}

/** Abreviação usada no `aria-label` ("Quartas de final" vira "Quartas"). */
function spokenRound(label: string): string {
  return label.replace(/ de final$/, '');
}

/**
 * Rótulo acessível completo. Ex.: "Quartas: Squad Alfa contra Squad Bravo, 20h. Concluída: Squad Alfa venceu por 2 x 1."
 * `index` diferencia partidas da mesma rodada ("Quartas 2").
 */
export function matchAriaLabel(match: Match, opts: { index?: number; roundLabel?: string; timeZone?: string } = {}): string {
  const [a, b] = match.participants;
  const round = spokenRound(opts.roundLabel ?? match.roundLabel) + (opts.index ? ` ${opts.index}` : '');
  const names = `${participantName(a)}${participantNote(a) ? ` (${participantNote(a)})` : ''} contra ${participantName(b)}${participantNote(b) ? ` (${participantNote(b)})` : ''}`;
  const time = matchTime(match, opts.timeZone);
  const parts = [`${round}: ${names}${time ? `, ${time}` : ''}`];
  if (match.ifNecessary) parts.push('Só acontece se for necessária');
  const state = matchState(match);
  const winner = winnerOf(match);
  const loser = match.participants.find((p) => p !== winner && p.registrationId);
  // Placar do ponto de vista de quem venceu: "venceu por 2 x 1".
  const score = winner?.score != null && loser?.score != null ? `${winner.score} x ${loser.score}` : null;
  if (winner) parts.push(`${state.label}: ${winner.name} venceu${score ? ` por ${score}` : ''}`);
  else parts.push(state.label);
  return `${parts.join('. ')}.`;
}

export function hasParticipant(match: Match, registrationId: string | null | undefined): boolean {
  return Boolean(registrationId) && match.participants.some((p) => p.registrationId === registrationId);
}
