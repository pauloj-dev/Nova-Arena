/**
 * RN-12 — promoção da lista de espera. Função pura: recebe as inscrições do campeonato e devolve
 * o que mudar. É usada na gestão de inscrições do organizador (recusar, remover) e serve também
 * para o cancelamento feito pelo próprio participante.
 */
import { SLOT_HOLDING_STATUSES, type RegistrationStatus } from '@nova/schemas';

/** Horas que a vaga fica reservada para o squad promovido incompleto. */
export const RESERVATION_HOURS = 24;

export interface WaitlistRegistration {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  /** Membros que já confirmaram presença. Inscrição solo ou importada conta como completa. */
  confirmedMembers: number;
  /** Inscrição de squad (precisa do mínimo de membros confirmados)? */
  isTeam: boolean;
}

export interface WaitlistContext {
  maxParticipants: number;
  manualApproval: boolean;
  /** Mínimo de membros confirmados para a inscrição de squad valer. */
  requiredMembers: number;
  registrationClosesAt: string | null;
  now: Date;
}

export interface Promotion {
  id: string;
  status: Extract<RegistrationStatus, 'CONFIRMED' | 'PENDING_APPROVAL' | 'PENDING_MEMBERS'>;
  /** Preenchido só para squad incompleto: até quando a vaga fica guardada. */
  reservedUntil: string | null;
}

/** Lista de espera na ordem de entrada. */
export function waitlistInOrder<T extends Pick<WaitlistRegistration, 'status' | 'createdAt' | 'id'>>(registrations: T[]): T[] {
  return registrations.filter((r) => r.status === 'WAITLIST').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Status com que alguém da lista de espera assume a vaga. */
export function promotedStatus(r: Pick<WaitlistRegistration, 'isTeam' | 'confirmedMembers'>, ctx: Pick<WaitlistContext, 'manualApproval' | 'requiredMembers' | 'registrationClosesAt' | 'now'>): Omit<Promotion, 'id'> {
  if (r.isTeam && r.confirmedMembers < ctx.requiredMembers) {
    const in24h = ctx.now.getTime() + RESERVATION_HOURS * 3600_000;
    const closes = ctx.registrationClosesAt ? new Date(ctx.registrationClosesAt).getTime() : Number.POSITIVE_INFINITY;
    // Prazo já vencido não encurta a reserva: valem as 24 horas.
    const until = closes > ctx.now.getTime() ? Math.min(in24h, closes) : in24h;
    return { status: 'PENDING_MEMBERS', reservedUntil: new Date(until).toISOString() };
  }
  return { status: ctx.manualApproval ? 'PENDING_APPROVAL' : 'CONFIRMED', reservedUntil: null };
}

/**
 * Preenche as vagas livres com os primeiros da lista de espera, na ordem de entrada.
 * Não muda nada quando não há vaga livre ou a lista está vazia.
 */
export function promoteFromWaitlist(registrations: WaitlistRegistration[], ctx: WaitlistContext): Promotion[] {
  const taken = registrations.filter((r) => SLOT_HOLDING_STATUSES.includes(r.status)).length;
  const free = Math.max(0, ctx.maxParticipants - taken);
  return waitlistInOrder(registrations)
    .slice(0, free)
    .map((r) => ({ id: r.id, ...promotedStatus(r, ctx) }));
}
