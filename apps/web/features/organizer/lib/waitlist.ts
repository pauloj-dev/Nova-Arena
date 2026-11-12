/**
 * RN-12 — promoção da lista de espera na gestão de inscrições do organizador.
 *
 * A regra em si mora em `features/registrations/lib/rules.ts` (`planPromotions`): é a mesma
 * usada quando o próprio participante cancela. Este arquivo é só o adaptador que transforma
 * as inscrições do campeonato na entrada daquela função.
 */
import { SLOT_HOLDING_STATUSES, type RegistrationStatus } from '@nova/schemas';
import { planPromotions, type Promotion, type WaitlistEntry } from '@/features/registrations/lib/rules';

export type { Promotion };

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

/** Lista de espera na ordem de entrada. */
export function waitlistInOrder<T extends Pick<WaitlistRegistration, 'status' | 'createdAt' | 'id'>>(registrations: T[]): T[] {
  return registrations.filter((r) => r.status === 'WAITLIST').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function toEntry(r: WaitlistRegistration, requiredMembers: number): WaitlistEntry {
  return { id: r.id, createdAt: r.createdAt, isTeam: r.isTeam, confirmedMembers: r.confirmedMembers, requiredMembers };
}

/**
 * Preenche as vagas livres com a lista de espera, na ordem de entrada. Squad incompleto sobe
 * "aguardando membros" com a vaga reservada por 24 h ou até o fechamento das inscrições; depois
 * do fechamento ele é pulado e a vaga vai para o próximo.
 */
export function promoteFromWaitlist(registrations: WaitlistRegistration[], ctx: WaitlistContext): Promotion[] {
  const taken = registrations.filter((r) => SLOT_HOLDING_STATUSES.includes(r.status)).length;
  return planPromotions({
    freeSlots: Math.max(0, ctx.maxParticipants - taken),
    waitlist: waitlistInOrder(registrations).map((r) => toEntry(r, ctx.requiredMembers)),
    manualApproval: ctx.manualApproval,
    registrationClosesAt: ctx.registrationClosesAt,
    now: ctx.now,
  });
}

/**
 * Como uma inscrição específica da lista de espera assumiria uma vaga (substituição feita pela
 * organização). Nulo quando ela não pode assumir: squad incompleto com as inscrições já fechadas.
 */
export function promotionFor(r: WaitlistRegistration, ctx: Omit<WaitlistContext, 'maxParticipants'>): Promotion | null {
  return planPromotions({ freeSlots: 1, waitlist: [toEntry(r, ctx.requiredMembers)], manualApproval: ctx.manualApproval, registrationClosesAt: ctx.registrationClosesAt, now: ctx.now })[0] ?? null;
}
