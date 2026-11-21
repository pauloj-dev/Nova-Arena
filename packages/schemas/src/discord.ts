/**
 * Bot do Discord (issue 121): vínculo de um servidor a um campeonato, check-in e próxima partida por comando, e avisos
 * automáticos no canal vinculado. As interações chegam por webhook HTTP (Vercel Function), sem processo contínuo.
 */
import { z } from 'zod';
import { IsoDateTime } from './common';

export const DiscordLinkState = z.enum(['NONE', 'PENDING', 'ACTIVE']);
export type DiscordLinkState = z.infer<typeof DiscordLinkState>;

/** Estado do vínculo de um campeonato com um servidor do Discord (`GET /tournaments/:id/discord`). */
export const DiscordLinkStatus = z.object({
  /** O bot está configurado neste ambiente. Desligado: a tela explica e não oferece o vínculo. */
  enabled: z.boolean(),
  /** Endereço para adicionar o bot a um servidor (nulo sem o bot configurado). */
  installUrl: z.string().nullable(),
  state: DiscordLinkState,
  /** Validade do código de vínculo em aberto (o código em si só aparece uma vez, ao ser gerado). */
  codeExpiresAt: IsoDateTime.nullable(),
  guildId: z.string().nullable(),
  guildName: z.string().nullable(),
  channelId: z.string().nullable(),
  linkedAt: IsoDateTime.nullable(),
  linkedByNickname: z.string().nullable(),
  /** Último aviso entregue no canal. */
  lastAnnouncementAt: IsoDateTime.nullable(),
  /** Último problema na entrega (ex.: o bot perdeu a permissão no canal). */
  lastError: z.string().nullable(),
});
export type DiscordLinkStatus = z.infer<typeof DiscordLinkStatus>;

/** Código de vínculo recém-gerado (`POST /tournaments/:id/discord/code`): mostrado uma única vez. */
export const DiscordLinkCode = z.object({
  code: z.string(),
  expiresAt: IsoDateTime,
  /** O comando pronto para colar no Discord. */
  command: z.string(),
});
export type DiscordLinkCode = z.infer<typeof DiscordLinkCode>;

export const DiscordQueued = z.object({ queued: z.boolean() });
export type DiscordQueued = z.infer<typeof DiscordQueued>;

/** Validade do código de vínculo. */
export const DISCORD_LINK_CODE_TTL_MINUTES = 15;

/** Tipos de aviso que o bot publica no canal vinculado. */
export const DiscordAnnouncementKind = z.enum(['MATCH_SOON', 'RESULT_POSTED', 'BRACKET_RELEASED', 'CHAMPION', 'TEST']);
export type DiscordAnnouncementKind = z.infer<typeof DiscordAnnouncementKind>;

// ── Interações (payload do Discord, só o que a Nova Arena usa) ───────
const DiscordUser = z.object({ id: z.string(), username: z.string().optional(), global_name: z.string().nullable().optional() });
const DiscordOption: z.ZodType<{ name: string; type: number; value?: string | number | boolean; options?: { name: string; type: number; value?: string | number | boolean }[] }> = z.object({
  name: z.string(),
  type: z.number(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({ name: z.string(), type: z.number(), value: z.union([z.string(), z.number(), z.boolean()]).optional() })).optional(),
});

/** Interação recebida em `POST /discord/interactions` (já com a assinatura conferida). */
export const DiscordInteraction = z.object({
  id: z.string(),
  application_id: z.string().optional(),
  /** 1 = PING, 2 = comando. */
  type: z.number(),
  token: z.string().optional(),
  guild_id: z.string().optional(),
  channel_id: z.string().optional(),
  /** No servidor: o membro (com as permissões calculadas no canal). Em mensagem direta: só `user`. */
  member: z.object({ user: DiscordUser, permissions: z.string().optional() }).optional(),
  user: DiscordUser.optional(),
  data: z.object({ name: z.string(), options: z.array(DiscordOption).optional() }).optional(),
  guild: z.object({ id: z.string(), name: z.string().optional() }).optional(),
});
export type DiscordInteraction = z.infer<typeof DiscordInteraction>;

/** Resposta à interação: 1 = PONG; 4 = mensagem (flag 64 = só quem chamou vê). */
export const DiscordInteractionResponse = z.object({
  type: z.number(),
  data: z
    .object({
      content: z.string().max(2000),
      flags: z.number().optional(),
      allowed_mentions: z.object({ parse: z.array(z.string()) }).optional(),
    })
    .optional(),
});
export type DiscordInteractionResponse = z.infer<typeof DiscordInteractionResponse>;
