/**
 * Textos de partida (catálogo `./messages`), usados pelo `MatchCard`, pela chave e pelas listas.
 * Funções puras: recebem a partida do contrato e devolvem frases prontas.
 */
import type { Match, MatchParticipant, MatchStatus } from '@nova/schemas';
import { getT } from '@/shared/i18n/core';
import { formatDate, formatDateTime, formatTime, timeZoneLabel, userTimeZone } from '@/shared/lib/datetime';
import { messages } from './messages';

const text = () => getT(messages, 'matchText');

/** Texto do status para frases (o `StatusPill` tem o seu próprio rótulo). */
export function matchStatusText(status: MatchStatus): string {
  return text()('status', { status });
}

/**
 * Rótulo do `StatusPill` quando o padrão do design system não serve para partida.
 * O texto é lido do catálogo a cada acesso (getter), não no carregamento do módulo.
 */
export const MATCH_STATUS_PILL_LABEL: Partial<Record<MatchStatus, string>> = {
  get CANCELLED() {
    return text()('pillCancelada');
  },
};

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
  return p.sourceLabel ?? text()('aDefinir');
}

/** Mesma coisa, para frases: "a definir (Vencedor: Quartas de final 3)". */
function slotSpoken(p: MatchParticipant): string {
  if (p.registrationId) return p.name;
  return p.sourceLabel ? text()('aDefinirDe', { origem: p.sourceLabel }) : text()('aDefinirFrase');
}

export function bestOfLabel(bestOf: number): string {
  return text()('melhorDeSigla', { n: bestOf });
}

/** "Mata-mata · Quartas de final" ou "Fase de grupos · Grupo A · Queda 2". */
export function matchHeading(match: Pick<Match, 'stageName' | 'groupName' | 'roundLabel'>): string {
  return [match.stageName, match.groupName, match.roundLabel].filter(Boolean).join(' · ');
}

/** "12/11 · 20h", para espaços pequenos. O fuso vai em outro lugar da mesma tela. */
export function shortSchedule(iso: string, timeZone?: string): string {
  const zone = timeZone ?? userTimeZone();
  return `${formatDate(iso, { timeZone: zone }).slice(0, 5)} · ${formatTime(iso, { timeZone: zone })}`;
}

/** "sáb., 14/11 · 20h · horário de Brasília" ou "Horário a definir". */
export function scheduleText(match: Pick<Match, 'scheduledAt'>, timeZone?: string): string {
  return match.scheduledAt ? formatDateTime(match.scheduledAt, timeZone ? { timeZone } : undefined) : text()('horarioADefinir');
}

/** Quem venceu, em uma frase. Nulo enquanto não há resultado. */
export function resultText(match: Match): string | null {
  if (!isConcluded(match)) return null;
  const t = text();
  if (match.kind === 'LOBBY') {
    const first = match.participants.find((p) => p.placement === 1);
    return first ? t('levouBooyah', { nome: first.name }) : null;
  }
  const winner = match.participants.find((p) => p.isWinner === true);
  const loser = match.participants.find((p) => p.isWinner === false);
  if (!winner) {
    const [a, b] = match.participants;
    return a && b && a.score !== null && b.score !== null ? t('empate', { a: a.score, b: b.score }) : null;
  }
  if (match.walkover || match.status === 'WALKOVER') return t('venceuWo', { nome: winner.name });
  if (winner.score !== null && loser && loser.score !== null) return t('venceuPor', { nome: winner.name, a: winner.score, b: loser.score });
  return t('venceu', { nome: winner.name });
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
  const t = text();
  const zone = opts.timeZone ?? userTimeZone();
  const head = [match.groupName, match.roundLabel].filter(Boolean).join(', ');
  const count = match.participants.length;
  const who = match.kind === 'LOBBY' ? t('equipes', { count }) : match.participants.map(slotSpoken).join(t('separadorContra'));
  const when = match.scheduledAt
    ? t('quando', { data: formatDate(match.scheduledAt, { timeZone: zone }).slice(0, 5), hora: formatTime(match.scheduledAt, { timeZone: zone }), fuso: timeZoneLabel(zone, new Date(match.scheduledAt)) })
    : t('horarioADefinirFrase');
  const parts = [t('quem', { cabecalho: head, quem: who }), when, matchStatusText(match.status)];
  const result = resultText(match);
  if (result && match.status !== 'WALKOVER') parts.push(result);
  if (result && match.status === 'WALKOVER') parts[parts.length - 1] = result;
  if (match.ifNecessary && !isOver(match)) parts.push(t('seNecessario'));
  if (opts.highlightRegistrationId && match.participants.some((p) => p.registrationId === opts.highlightRegistrationId)) parts.push(t('seuConfronto'));
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
