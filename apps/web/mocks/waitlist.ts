/**
 * RN-12 — a fila de espera em dia, compartilhada pelos módulos `registrations` (participante)
 * e `registrations-manage` / `tournaments` (organização).
 *
 * No protótipo roda "sob demanda", antes de cada leitura ou mudança de inscrição.
 * Na API real (B1) é um job agendado (Vercel Cron), além da chamada nas mudanças.
 */
import type { TournamentStatus } from '@nova/schemas';
import { isReservationExpired, planPromotions } from '@/features/registrations/lib/rules';
import { db, save, type DbRegistration, type DbTournament } from './db';
import { takenSlots } from './views';

/** Antes de a fase 1 começar: reserva vencida sempre devolve o squad à lista de espera. */
const BEFORE_START: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
/** Estados em que a fila anda sozinha. Depois do check-in só a organização substitui (RN-06). */
export const AUTO_PROMOTION_STATUSES: TournamentStatus[] = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

const confirmedCount = (r: DbRegistration) => r.members.filter((m) => m.confirmedAt !== null).length;

function teamSizeOf(t: DbTournament): number {
  return db().games.find((g) => g.id === t.gameId)?.modes.find((m) => m.id === t.gameModeId)?.teamSize ?? 1;
}

/**
 * Coloca a fila em dia: devolve ao fim da lista de espera o squad promovido que não completou o
 * elenco no prazo (24 h ou o fechamento das inscrições, o que vier primeiro) e promove os primeiros
 * da fila para as vagas livres. Vale para qualquer promoção — automática, por cancelamento do
 * participante ou por remoção/recusa feita pela organização.
 */
export function settleWaitlist(t: DbTournament, now: Date = new Date()): void {
  if (!BEFORE_START.includes(t.status)) return;
  const d = db();
  let changed = false;

  d.registrations
    .filter((r) => r.tournamentId === t.id && isReservationExpired(r, now))
    .forEach((r, index) => {
      r.status = 'WAITLIST';
      r.reservedUntil = null;
      // A posição na fila é a ordem de `createdAt`: voltar ao fim da fila é entrar de novo agora.
      r.createdAt = new Date(now.getTime() + index).toISOString();
      changed = true;
    });

  if (AUTO_PROMOTION_STATUSES.includes(t.status)) {
    const freeSlots = t.maxParticipants - takenSlots(t.id);
    if (freeSlots > 0) {
      const requiredMembers = teamSizeOf(t);
      const waitlist = d.registrations
        .filter((r) => r.tournamentId === t.id && r.status === 'WAITLIST')
        .map((r) => ({ id: r.id, createdAt: r.createdAt, isTeam: r.teamId !== null, confirmedMembers: confirmedCount(r), requiredMembers }));
      for (const promotion of planPromotions({ freeSlots, waitlist, manualApproval: t.manualApproval, registrationClosesAt: t.registrationClosesAt, now })) {
        const r = d.registrations.find((x) => x.id === promotion.id);
        if (!r) continue;
        r.status = promotion.status;
        r.reservedUntil = promotion.reservedUntil;
        changed = true;
        // Ponto de extensão: notificar o promovido ("Sua vaga saiu!").
      }
    }
  }
  if (changed) save();
}
