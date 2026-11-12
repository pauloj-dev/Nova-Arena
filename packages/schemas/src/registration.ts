import { z } from 'zod';
import { Id, IsoDateTime } from './common';
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

/** Linha do CSV de importação de inscritos (mitigação do risco R6). */
export const ImportRegistrationRow = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  tag: z.string().max(5).optional(),
  contact: z.string().optional(),
  gameId: z.string().optional(),
});
export type ImportRegistrationRow = z.infer<typeof ImportRegistrationRow>;
export const ImportRegistrationsInput = z.object({ rows: z.array(ImportRegistrationRow).min(1).max(1024) });
export const ImportRegistrationsResult = z.object({ created: z.number().int(), waitlisted: z.number().int(), skipped: z.array(z.object({ row: z.number().int(), reason: z.string() })) });

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
