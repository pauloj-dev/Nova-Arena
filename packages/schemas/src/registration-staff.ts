/**
 * Inscrições criadas pela organização: importação por planilha, inscrito avulso e elenco sem conta (RN-18).
 * Fica em arquivo próprio para só entrar no JavaScript das telas da organização que usam esses formulários, e
 * não no de toda página que lê uma inscrição (`registration.ts`).
 */
import { z } from 'zod';

/** Limites dos campos do jogador sem conta (RN-18). */
export const GUEST_NAME_MAX = 40;
export const GUEST_GAME_ID_MAX = 40;

/** Jogador sem conta que a organização coloca no elenco de uma inscrição criada por ela (RN-18). */
export const GuestMemberInput = z.object({
  name: z.string().trim().min(1, 'Informe o nome do jogador').max(GUEST_NAME_MAX, `O nome pode ter no máximo ${GUEST_NAME_MAX} caracteres`),
  gameId: z.string().trim().max(GUEST_GAME_ID_MAX, `O ID no jogo pode ter no máximo ${GUEST_GAME_ID_MAX} caracteres`).nullable().optional(),
  isSub: z.boolean().optional(),
});
export type GuestMemberInput = z.infer<typeof GuestMemberInput>;

/** Corrigir um jogador sem conta: só os campos enviados mudam (`gameId: null` apaga o ID). */
export const UpdateGuestMemberInput = GuestMemberInput.partial().refine((v) => v.name !== undefined || v.gameId !== undefined || v.isSub !== undefined, { message: 'Informe o que mudar' });
export type UpdateGuestMemberInput = z.infer<typeof UpdateGuestMemberInput>;

/** Teto de jogadores por linha (bem acima de qualquer modo; o limite de verdade é o do modo do campeonato). */
const MAX_GUESTS_PER_ROW = 20;

/** Linha do CSV de importação de inscritos (mitigação do risco R6). Em campeonato por squad, pode trazer o elenco. */
export const ImportRegistrationRow = z.object({
  name: z.string().min(1, 'Nome obrigatório'),
  tag: z.string().max(5).optional(),
  contact: z.string().optional(),
  gameId: z.string().optional(),
  members: z.array(GuestMemberInput).max(MAX_GUESTS_PER_ROW).optional(),
});
export type ImportRegistrationRow = z.infer<typeof ImportRegistrationRow>;

/** Inscrito avulso: a organização cadastra um jogador ou squad sem conta, sem planilha (RN-18). */
export const ManualRegistrationInput = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(60, 'O nome pode ter no máximo 60 caracteres'),
  tag: z.string().trim().max(5, 'A tag pode ter no máximo 5 caracteres').optional(),
  contact: z.string().trim().max(120, 'O contato pode ter no máximo 120 caracteres').optional(),
  gameId: z.string().trim().max(GUEST_GAME_ID_MAX, `O ID no jogo pode ter no máximo ${GUEST_GAME_ID_MAX} caracteres`).optional(),
  members: z.array(GuestMemberInput).max(MAX_GUESTS_PER_ROW).optional(),
});
export type ManualRegistrationInput = z.infer<typeof ManualRegistrationInput>;
export const ImportRegistrationsInput = z.object({ rows: z.array(ImportRegistrationRow).min(1).max(1024) });
export const ImportRegistrationsResult = z.object({ created: z.number().int(), waitlisted: z.number().int(), skipped: z.array(z.object({ row: z.number().int(), reason: z.string() })) });
export type ImportRegistrationsInput = z.infer<typeof ImportRegistrationsInput>;
export type ImportRegistrationsResult = z.infer<typeof ImportRegistrationsResult>;
