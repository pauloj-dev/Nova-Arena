/**
 * Regras de inscrição (PRD §12, RN-06 e RN-12) como funções puras.
 * A API simulada (`mocks/handlers/registrations.ts`) e as telas usam as mesmas funções;
 * em B1 elas vão para a API real sem mudar.
 */
import { WAITLIST_RESERVATION_HOURS, type RegistrationStatus, type TournamentStatus } from '@nova/schemas';

const HOUR_MS = 3_600_000;

// ── Tamanho do squad para o modo ─────────────────────────────────────
export interface ModeSize {
  teamSize: number;
  maxSubs: number;
}
export type SquadSizeCheck = { ok: true } | { ok: false; reason: 'TOO_SMALL'; missing: number } | { ok: false; reason: 'TOO_BIG'; excess: number };

/** O squad precisa ter pelo menos `teamSize` jogadores e no máximo `teamSize + maxSubs`. */
export function checkSquadSize(memberCount: number, mode: ModeSize): SquadSizeCheck {
  if (memberCount < mode.teamSize) return { ok: false, reason: 'TOO_SMALL', missing: mode.teamSize - memberCount };
  const max = mode.teamSize + mode.maxSubs;
  if (memberCount > max) return { ok: false, reason: 'TOO_BIG', excess: memberCount - max };
  return { ok: true };
}

export function squadSizeMessage(check: SquadSizeCheck, mode: ModeSize & { name: string }): string | null {
  if (check.ok) return null;
  if (check.reason === 'TOO_SMALL') {
    return `O squad precisa de pelo menos ${plural(mode.teamSize, 'jogador', 'jogadores')} para o modo ${mode.name}. ${check.missing === 1 ? 'Falta 1' : `Faltam ${check.missing}`}.`;
  }
  const limit = mode.maxSubs > 0 ? `${mode.teamSize} + ${plural(mode.maxSubs, 'reserva', 'reservas')}` : plural(mode.teamSize, 'jogador', 'jogadores');
  return `O squad tem ${plural(check.excess, 'jogador', 'jogadores')} a mais do que o modo ${mode.name} aceita (${limit}).`;
}

// ── Janela de inscrição ──────────────────────────────────────────────
export interface RegistrationWindowInput {
  status: TournamentStatus;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
}
export type RegistrationWindow = 'NOT_OPEN_YET' | 'OPEN' | 'CLOSED' | 'CANCELLED';

/** Só dá para se inscrever com o campeonato em "Inscrições abertas" e dentro do prazo. */
export function registrationWindow(t: RegistrationWindowInput, now: Date = new Date()): RegistrationWindow {
  if (t.status === 'CANCELLED') return 'CANCELLED';
  if (t.status === 'DRAFT' || t.status === 'PUBLISHED') return 'NOT_OPEN_YET';
  if (t.status !== 'REGISTRATION_OPEN') return 'CLOSED';
  const at = now.getTime();
  if (t.registrationOpensAt && at < Date.parse(t.registrationOpensAt)) return 'NOT_OPEN_YET';
  if (t.registrationClosesAt && at >= Date.parse(t.registrationClosesAt)) return 'CLOSED';
  return 'OPEN';
}

// ── Status inicial e avanço ──────────────────────────────────────────
export interface InitialStatusInput {
  /** Vagas livres neste momento. */
  freeSlots: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;
  isTeam: boolean;
  /** Membros já confirmados (na inscrição de squad, o capitão conta). */
  confirmedMembers: number;
  /** Mínimo de confirmados para a inscrição valer (`teamSize` do modo). */
  requiredMembers: number;
}

/**
 * Status de uma inscrição nova. `FULL` = sem vaga e sem lista de espera (a API responde 409).
 * Ordem: vaga → membros → aprovação.
 */
export function initialRegistrationStatus(input: InitialStatusInput): RegistrationStatus | 'FULL' {
  if (input.freeSlots <= 0) return input.waitlistEnabled ? 'WAITLIST' : 'FULL';
  return statusWithSlot(input);
}

export type SlotStatus = Extract<RegistrationStatus, 'CONFIRMED' | 'PENDING_APPROVAL' | 'PENDING_MEMBERS'>;

/** Status de quem tem vaga garantida: aguardando membros, aguardando aprovação ou confirmada. */
export function statusWithSlot(input: Pick<InitialStatusInput, 'manualApproval' | 'isTeam' | 'confirmedMembers' | 'requiredMembers'>): SlotStatus {
  if (input.isTeam && input.confirmedMembers < input.requiredMembers) return 'PENDING_MEMBERS';
  return input.manualApproval ? 'PENDING_APPROVAL' : 'CONFIRMED';
}

/**
 * Status depois que um membro confirma. Só a inscrição "Aguardando membros" avança;
 * na lista de espera a confirmação fica guardada para a hora da promoção.
 */
export function statusAfterMemberConfirmation(
  current: RegistrationStatus,
  input: Pick<InitialStatusInput, 'manualApproval' | 'confirmedMembers' | 'requiredMembers'>,
): RegistrationStatus {
  if (current !== 'PENDING_MEMBERS') return current;
  return statusWithSlot({ ...input, isTeam: true });
}

// ── Lista de espera (RN-12) ──────────────────────────────────────────
export interface WaitlistEntry {
  id: string;
  createdAt: string;
  isTeam: boolean;
  confirmedMembers: number;
  requiredMembers: number;
}
export interface Promotion {
  id: string;
  status: SlotStatus;
  /** Preenchido quando o promovido é um squad incompleto: a vaga fica reservada até aqui. */
  reservedUntil: string | null;
}
export interface PromotionInput {
  freeSlots: number;
  waitlist: WaitlistEntry[];
  manualApproval: boolean;
  registrationClosesAt: string | null;
  now: Date;
}

/** Fim da reserva do squad promovido incompleto: 24 h ou o fechamento das inscrições, o que vier primeiro. */
export function reservationDeadline(now: Date, registrationClosesAt: string | null): string {
  const byHours = now.getTime() + WAITLIST_RESERVATION_HOURS * HOUR_MS;
  const byClose = registrationClosesAt ? Date.parse(registrationClosesAt) : Number.POSITIVE_INFINITY;
  return new Date(Math.min(byHours, byClose)).toISOString();
}

/**
 * Quem sobe da lista de espera quando abrem `freeSlots` vagas: na ordem de entrada.
 * Squad incompleto sobe como "Aguardando membros" com a vaga reservada; se as inscrições
 * já fecharam ele não tem como completar, então a vaga vai para o próximo.
 */
export function planPromotions(input: PromotionInput): Promotion[] {
  const closed = input.registrationClosesAt !== null && Date.parse(input.registrationClosesAt) <= input.now.getTime();
  const queue = [...input.waitlist].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const promotions: Promotion[] = [];
  for (const entry of queue) {
    if (promotions.length >= input.freeSlots) break;
    const status = statusWithSlot({ manualApproval: input.manualApproval, isTeam: entry.isTeam, confirmedMembers: entry.confirmedMembers, requiredMembers: entry.requiredMembers });
    if (status === 'PENDING_MEMBERS') {
      if (closed) continue;
      promotions.push({ id: entry.id, status, reservedUntil: reservationDeadline(input.now, input.registrationClosesAt) });
    } else {
      promotions.push({ id: entry.id, status, reservedUntil: null });
    }
  }
  return promotions;
}

/** A reserva do squad promovido venceu sem ele completar: a vaga passa adiante e ele volta ao fim da fila. */
export function isReservationExpired(r: { status: RegistrationStatus; reservedUntil: string | null }, now: Date): boolean {
  return r.status === 'PENDING_MEMBERS' && r.reservedUntil !== null && Date.parse(r.reservedUntil) <= now.getTime();
}

// ── Cancelamento (RN-06) ─────────────────────────────────────────────
export interface CancellationInput {
  status: TournamentStatus;
  startsAt: string | null;
  rosterLockAt: string | null;
  checkIn: { enabled: boolean; opensMinutesBefore: number };
}

/** Limite para cancelar: abertura do check-in ou trava de elenco, o que vier primeiro. Nulo = sem data marcada. */
export function cancellationDeadline(t: Pick<CancellationInput, 'startsAt' | 'rosterLockAt' | 'checkIn'>): string | null {
  const limits: number[] = [];
  if (t.startsAt) limits.push(Date.parse(t.startsAt) - (t.checkIn.enabled ? t.checkIn.opensMinutesBefore * 60_000 : 0));
  if (t.rosterLockAt) limits.push(Date.parse(t.rosterLockAt));
  return limits.length > 0 ? new Date(Math.min(...limits)).toISOString() : null;
}

const CANCELLABLE_TOURNAMENT_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];

/** Depois do prazo o participante não cancela mais: vira desistência, tratada com a organização. */
export function canCancelRegistration(t: CancellationInput, now: Date = new Date()): boolean {
  if (!CANCELLABLE_TOURNAMENT_STATUSES.includes(t.status)) return false;
  const deadline = cancellationDeadline(t);
  return deadline === null || now.getTime() < Date.parse(deadline);
}

// ── Pendências (textos para "Meus campeonatos" e a home) ─────────────
export interface PendencyMember {
  userId: string;
  confirmedAt: string | null;
  hasGameAccount: boolean;
}
export interface PendencyInput {
  status: RegistrationStatus;
  teamId: string | null;
  members: PendencyMember[];
  requiredMembers: number;
  waitlistPosition: number | null;
}

/** Quantas confirmações ainda faltam para o squad atingir o mínimo. */
export function missingConfirmations(r: Pick<PendencyInput, 'members' | 'requiredMembers'>): number {
  return Math.max(0, r.requiredMembers - r.members.filter((m) => m.confirmedAt !== null).length);
}

/** O que falta resolver nesta inscrição, do ponto de vista de quem está vendo. */
export function registrationPendencies(r: PendencyInput, viewerId: string | null): string[] {
  const list: string[] = [];
  const me = viewerId ? r.members.find((m) => m.userId === viewerId) : undefined;
  const active = r.status === 'PENDING_MEMBERS' || r.status === 'PENDING_APPROVAL' || r.status === 'CONFIRMED' || r.status === 'WAITLIST';
  if (!active) return list;

  if (r.teamId && me && me.confirmedAt === null) list.push('Confirme sua participação');
  if (me && !me.hasGameAccount) list.push('Informe seu ID do jogo');

  const missing = r.teamId ? missingConfirmations(r) : 0;
  if (missing > 0) {
    const pending = r.members.filter((m) => m.confirmedAt === null).length;
    if (pending < missing) list.push(`Elenco incompleto: ${missing === 1 ? 'falta 1 jogador' : `faltam ${missing} jogadores`}`);
    else list.push(missing === 1 ? 'Falta 1 membro confirmar' : `Faltam ${missing} membros confirmarem`);
  }
  if (r.status === 'PENDING_APPROVAL') list.push('Aguardando a organização aprovar');
  if (r.status === 'WAITLIST' && r.waitlistPosition !== null) list.push(`${r.waitlistPosition}º na lista de espera`);
  return list;
}

// ── "Meus campeonatos" ───────────────────────────────────────────────
const ACTIVE_STATUSES: RegistrationStatus[] = ['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST'];
/** Campeonatos que já acabaram: inscrição neles é histórico e não prende squad nem elenco. */
export const ENDED_TOURNAMENT_STATUSES: TournamentStatus[] = ['FINISHED', 'ARCHIVED', 'CANCELLED'];

/** Entra em "Em andamento e próximos": inscrição valendo em campeonato que não acabou. O resto é histórico. */
export function isCurrentEntry(entry: { registration: { status: RegistrationStatus }; tournament: { status: TournamentStatus } }): boolean {
  return ACTIVE_STATUSES.includes(entry.registration.status) && !ENDED_TOURNAMENT_STATUSES.includes(entry.tournament.status);
}

// ── Painel de inscrição ──────────────────────────────────────────────
export interface PanelInput {
  tournament: RegistrationWindowInput & { maxParticipants: number; takenSlots: number; waitlistEnabled: boolean; waitlistCount: number };
  isAuthenticated: boolean;
  /** Já existe uma inscrição minha (ativa, ou encerrada pela organização). */
  hasRegistration: boolean;
  /** Sou dono ou da equipe do campeonato. */
  isOrganizer: boolean;
  /** O jogo exige ID e eu ainda não informei. */
  missingGameAccount: boolean;
  now: Date;
}
export type PanelView =
  | { kind: 'REGISTERED' }
  | { kind: 'CANCELLED' }
  | { kind: 'CLOSED' }
  | { kind: 'ORGANIZER' }
  | { kind: 'NOT_OPEN_YET'; opensAt: string | null }
  | { kind: 'FULL' }
  | { kind: 'VISITOR'; waitlist: boolean }
  | { kind: 'CAN_REGISTER'; waitlist: boolean; waitlistPosition: number | null; missingGameAccount: boolean };

/**
 * Qual estado o painel de inscrição mostra. A ordem importa: quem já está inscrito vê a inscrição
 * mesmo com as inscrições encerradas; o aviso de organizador vem antes de qualquer botão.
 */
export function registrationPanelView(input: PanelInput): PanelView {
  const { tournament: t } = input;
  if (input.hasRegistration) return { kind: 'REGISTERED' };
  const window = registrationWindow(t, input.now);
  if (window === 'CANCELLED') return { kind: 'CANCELLED' };
  if (window === 'CLOSED') return { kind: 'CLOSED' };
  if (input.isOrganizer) return { kind: 'ORGANIZER' };
  if (window === 'NOT_OPEN_YET') return { kind: 'NOT_OPEN_YET', opensAt: t.registrationOpensAt };
  const full = t.takenSlots >= t.maxParticipants;
  if (full && !t.waitlistEnabled) return { kind: 'FULL' };
  if (!input.isAuthenticated) return { kind: 'VISITOR', waitlist: full };
  return { kind: 'CAN_REGISTER', waitlist: full, waitlistPosition: full ? t.waitlistCount + 1 : null, missingGameAccount: input.missingGameAccount };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
