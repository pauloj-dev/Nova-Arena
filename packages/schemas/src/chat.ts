/**
 * Chat por partida (issue 125): capitães e jogadores da partida conversam com a organização, sobre o canal de tempo
 * real `match:{id}`. O evento só avisa que há mensagem nova; o texto vem da API, que confere quem pode ler.
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const CHAT_MESSAGE_MAX_LENGTH = 500;
/** Limite de envio por pessoa em cada partida. */
export const CHAT_RATE_LIMIT = { messages: 5, windowSeconds: 30 } as const;

export const ChatAuthorRole = z.enum(['PLAYER', 'STAFF']);
export type ChatAuthorRole = z.infer<typeof ChatAuthorRole>;

export const MatchChatMessage = z.object({
  id: Id,
  matchId: Id,
  authorId: Id,
  authorNickname: z.string(),
  authorAvatarUrl: z.string().nullable(),
  /** Quem escreveu: alguém da partida ou da organização (dono, co-organizador, moderador ou Admin). */
  authorRole: ChatAuthorRole,
  /** Vazio quando a mensagem foi ocultada pela organização. */
  body: z.string(),
  hidden: z.boolean(),
  createdAt: IsoDateTime,
});
export type MatchChatMessage = z.infer<typeof MatchChatMessage>;

/** `GET /matches/:id/chat`: as mensagens (mais antigas primeiro) e o que quem pediu pode fazer. */
export const MatchChat = z.object({
  messages: z.array(MatchChatMessage),
  /** Pode escrever agora? */
  canPost: z.boolean(),
  /** Pode ocultar mensagens (organização)? */
  canModerate: z.boolean(),
  /** Por que não pode escrever (ex.: campeonato encerrado). Nulo quando pode. */
  closedReason: z.string().nullable(),
});
export type MatchChat = z.infer<typeof MatchChat>;

export const MatchChatInput = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Escreva a mensagem')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Use até ${CHAT_MESSAGE_MAX_LENGTH} caracteres`),
});
export type MatchChatInput = z.infer<typeof MatchChatInput>;
