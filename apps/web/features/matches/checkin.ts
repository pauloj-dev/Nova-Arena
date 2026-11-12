/**
 * Regras de exibição do check-in (PAR-07, US-PAR-07). Funções puras: a decisão que vale é a da API,
 * aqui só se decide o que mostrar para quem está olhando.
 */
import type { Match, Registration } from '@nova/schemas';

/** NONE: a partida não tem janela (sem horário ou check-in desligado). */
export type CheckInPhase = 'NONE' | 'BEFORE' | 'OPEN' | 'CLOSED';

export function checkInPhase(match: Pick<Match, 'checkInOpensAt' | 'checkInClosesAt'>, now: number): CheckInPhase {
  if (!match.checkInOpensAt || !match.checkInClosesAt) return 'NONE';
  if (now < new Date(match.checkInOpensAt).getTime()) return 'BEFORE';
  if (now < new Date(match.checkInClosesAt).getTime()) return 'OPEN';
  return 'CLOSED';
}

/** Milissegundos até a janela fechar (0 depois que fechou). */
export function msUntilClose(match: Pick<Match, 'checkInClosesAt'>, now: number): number {
  if (!match.checkInClosesAt) return 0;
  return Math.max(0, new Date(match.checkInClosesAt).getTime() - now);
}

/** "09:59" ou, acima de uma hora, "1:02:03". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Texto para leitores de tela. Muda só de minuto em minuto (e nos últimos segundos),
 * para a região `aria-live` não falar a cada segundo.
 */
export function countdownSpoken(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds === 0) return 'A janela de check-in fechou.';
  if (seconds <= 10) return 'Faltam menos de 10 segundos para o check-in fechar.';
  if (seconds <= 30) return 'Faltam menos de 30 segundos para o check-in fechar.';
  if (seconds <= 60) return 'Falta menos de 1 minuto para o check-in fechar.';
  const minutes = Math.ceil(seconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `Falta mais de ${hours} ${hours === 1 ? 'hora' : 'horas'} para o check-in fechar.`;
  }
  return `Faltam ${minutes} minutos para o check-in fechar.`;
}

export interface CheckInDuty {
  /** Quem está vendo precisa (e pode) fazer o check-in. */
  mustCheckIn: boolean;
  /** Em squad: quem faz o check-in. Nulo em inscrição solo. */
  explanation: string | null;
}

/**
 * Quem faz o check-in por uma inscrição: o próprio jogador (solo), o capitão,
 * ou todos os titulares confirmados quando a organização exige (`requireAllMembers`).
 * `requireAllMembers` nulo = a tela não conhece a regra do campeonato (deixa a API decidir).
 */
export function checkInDuty(registration: Pick<Registration, 'userId' | 'teamId' | 'members'> | null, viewerId: string | null, requireAllMembers: boolean | null): CheckInDuty {
  if (!registration || !viewerId) return { mustCheckIn: false, explanation: null };
  if (registration.teamId === null) return { mustCheckIn: registration.userId === viewerId, explanation: null };

  const me = registration.members.find((m) => m.userId === viewerId);
  const starter = Boolean(me && !me.isSub && me.confirmedAt);
  if (requireAllMembers === true) {
    return {
      mustCheckIn: starter,
      explanation: starter ? 'Neste campeonato, todos os titulares do squad precisam fazer check-in.' : 'Neste campeonato, o check-in é feito por todos os titulares do squad. Reservas não precisam.',
    };
  }
  if (requireAllMembers === false) {
    const captain = Boolean(me?.isCaptain);
    return {
      mustCheckIn: captain,
      explanation: captain ? 'Você é o capitão: o seu check-in vale para o squad inteiro.' : 'Quem faz o check-in do squad é o capitão.',
    };
  }
  return { mustCheckIn: starter, explanation: 'Em squad, o check-in é feito pelo capitão — ou por todos os titulares, se a organização exigir.' };
}
