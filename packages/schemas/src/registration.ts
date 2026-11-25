import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { EventConflict } from './event';
import { TournamentSummary } from './tournament';

export const RegistrationStatus = z.enum(['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED']);
export type RegistrationStatus = z.infer<typeof RegistrationStatus>;

/** Status que ocupam vaga. */
export const SLOT_HOLDING_STATUSES: RegistrationStatus[] = ['PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED'];

export const RegistrationMember = z.object({
  userId: Id,
  nickname: z.string(),
  avatarUrl: z.string().nullable(),
  isCaptain: z.boolean(),
  isSub: z.boolean(),
  confirmedAt: IsoDateTime.nullable(),
  /** Falso quando o jogador ainda não informou o ID do jogo exigido. */
  hasGameAccount: z.boolean(),
});
export type RegistrationMember = z.infer<typeof RegistrationMember>;

/**
 * Jogador sem conta na plataforma, no elenco de uma inscrição criada pela organização (planilha ou cadastro
 * manual, RN-18). `gameId` só vai preenchido para a organização do campeonato; para o público é `null`.
 */
export const RegistrationGuest = z.object({ id: Id, name: z.string(), gameId: z.string().nullable(), isSub: z.boolean() });
export type RegistrationGuest = z.infer<typeof RegistrationGuest>;

export const Registration = z.object({
  id: Id,
  tournamentId: Id,
  /** Nome exibido: apelido (solo) ou nome do squad. */
  displayName: z.string(),
  tag: z.string().nullable(),
  logoUrl: z.string().nullable(),
  userId: Id.nullable(),
  teamId: Id.nullable(),
  status: RegistrationStatus,
  seed: z.number().int().nullable(),
  waitlistPosition: z.number().int().nullable(),
  statusReason: z.string().nullable(),
  members: z.array(RegistrationMember),
  /** Elenco sem conta na plataforma (só nas inscrições criadas pela organização, RN-18). */
  guests: z.array(RegistrationGuest).default([]),
  /** Mínimo de membros confirmados para a inscrição valer. */
  requiredMembers: z.number().int(),
  reservedUntil: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Registration = z.infer<typeof Registration>;

export const RegisterInTournamentInput = z.object({
  teamId: Id.optional(),
  acceptRules: z.literal(true, 'É preciso aceitar o regulamento'),
});
export type RegisterInTournamentInput = z.infer<typeof RegisterInTournamentInput>;

export const ReviewRegistrationInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(3, 'Informe o motivo') }),
  z.object({ action: z.literal('remove'), reason: z.string().min(3, 'Informe o motivo') }),
  z.object({ action: z.literal('replace'), withRegistrationId: Id }),
]);
export type ReviewRegistrationInput = z.infer<typeof ReviewRegistrationInput>;

/** "Meus campeonatos" do participante. */
export const MyTournamentEntry = z.object({
  tournament: TournamentSummary,
  registration: Registration,
  nextMatch: z
    .object({ id: Id, label: z.string(), scheduledAt: IsoDateTime.nullable(), opponent: z.string().nullable(), checkInOpen: z.boolean() })
    .nullable(),
  finalPlacement: z.number().int().nullable(),
});
export type MyTournamentEntry = z.infer<typeof MyTournamentEntry>;

// ── Acréscimos da F1.9 (inscrições do participante) ──────────────────

/** Status de uma inscrição que ainda está valendo (ocupa vaga ou está na lista de espera). */
export const ACTIVE_REGISTRATION_STATUSES: RegistrationStatus[] = [...SLOT_HOLDING_STATUSES, 'WAITLIST'];

/** Horas que a vaga fica reservada para o squad promovido incompleto (RN-12). */
export const WAITLIST_RESERVATION_HOURS = 24;

/** O que a API diz sobre quem está vendo o painel de inscrição, além da própria inscrição. */
export const RegistrationEligibility = z.object({
  /** Dono ou equipe do campeonato: não pode se inscrever nele (PRD §6, nota ³). */
  isOrganizer: z.boolean(),
  /** Evento com regra "um só campeonato" (ADR-0005): o outro campeonato do evento em que a pessoa já está. */
  eventConflict: EventConflict.nullable().optional(),
});
export type RegistrationEligibility = z.infer<typeof RegistrationEligibility>;

/** Resposta da revisão de uma inscrição: a inscrição alterada e quem subiu da lista de espera (RN-12). */
export const ReviewRegistrationResult = z.object({ registration: Registration, promoted: z.array(Registration) });
export type ReviewRegistrationResult = z.infer<typeof ReviewRegistrationResult>;

// ── Elenco da inscrição de squad (trava de elenco, PRD §12.1) ────────

/**
 * Escalar alguém no elenco da inscrição. O capitão escolhe um membro do squad (`userId`); a organização pode
 * escalar qualquer jogador, pelo apelido ou pelo id.
 */
export const AddRosterMemberInput = z
  .object({ userId: Id.optional(), nickname: z.string().trim().min(1, 'Informe o apelido do jogador').max(40).optional() })
  .refine((v) => Boolean(v.userId ?? v.nickname), { message: 'Informe quem vai entrar no elenco', path: ['nickname'] });
export type AddRosterMemberInput = z.infer<typeof AddRosterMemberInput>;

/** Remanejar (só a organização): o jogador sai do elenco desta inscrição e entra no de outro squad do mesmo campeonato. */
export const MoveRosterMemberInput = z.object({ toRegistrationId: Id });
export type MoveRosterMemberInput = z.infer<typeof MoveRosterMemberInput>;

/** Resposta da troca de elenco: as inscrições que mudaram (a de origem e, ao remanejar, a de destino). */
export const RosterChangeResult = z.object({ registrations: z.array(Registration) });
export type RosterChangeResult = z.infer<typeof RosterChangeResult>;
