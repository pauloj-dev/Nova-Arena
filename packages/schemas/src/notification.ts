/** Contratos de notificações e de tempo real (F2). */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';

export const NotificationType = z.enum([
  'REGISTRATION_CONFIRMED',
  'TEAM_INVITE',
  'CHECKIN_OPEN',
  'MATCH_SOON',
  'RESULT_POSTED',
  'QUALIFIED',
  'ELIMINATED',
  'ANNOUNCEMENT',
  'ORGANIZER_REQUEST_RESULT',
  'DISPUTE_UPDATE',
  'SANCTION',
]);
export type NotificationType = z.infer<typeof NotificationType>;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, { label: string; description: string }> = {
  REGISTRATION_CONFIRMED: { label: 'Inscrição confirmada', description: 'Quando sua inscrição é confirmada, recusada ou sai da lista de espera.' },
  TEAM_INVITE: { label: 'Convite de squad', description: 'Quando alguém te convida para um squad ou pede sua confirmação.' },
  CHECKIN_OPEN: { label: 'Check-in aberto', description: 'Quando abre a janela de check-in de uma partida sua.' },
  MATCH_SOON: { label: 'Partida em 15 minutos', description: 'Lembrete antes de cada partida.' },
  RESULT_POSTED: { label: 'Resultado lançado', description: 'Quando o resultado de uma partida sua é lançado ou corrigido.' },
  QUALIFIED: { label: 'Classificação', description: 'Quando você avança de fase.' },
  ELIMINATED: { label: 'Eliminação', description: 'Quando você é eliminado ou o campeonato termina.' },
  ANNOUNCEMENT: { label: 'Comunicados', description: 'Avisos da organização dos campeonatos que você joga ou segue.' },
  ORGANIZER_REQUEST_RESULT: { label: 'Pedido de organizador', description: 'Resposta ao seu pedido para virar organizador.' },
  DISPUTE_UPDATE: { label: 'Disputas', description: 'Atualizações em resultados contestados.' },
  SANCTION: { label: 'Avisos da moderação', description: 'Advertências e sanções. Não pode ser desligado.' },
};

export const Notification = z.object({
  id: Id,
  type: NotificationType,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  readAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Notification = z.infer<typeof Notification>;

export const NotificationPreference = z.object({ type: NotificationType, inApp: z.boolean(), email: z.boolean() });
export type NotificationPreference = z.infer<typeof NotificationPreference>;
export const NotificationPreferencesInput = z.object({ preferences: z.array(NotificationPreference) });
export const UnreadCount = z.object({ count: z.number().int() });

/**
 * Eventos de tempo real (PRD §18.3). Levam só o que mudou — nunca dados sensíveis.
 * A tela reage invalidando as consultas e buscando os dados na API, que confere a permissão.
 */
export const RealtimeEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('match.updated'), matchId: Id, stageId: Id, status: z.string() }),
  z.object({ type: z.literal('standings.updated'), stageId: Id, groupId: z.string().nullable().optional() }),
  z.object({ type: z.literal('stage.advanced'), fromStageId: Id, toStageId: Id }),
  z.object({ type: z.literal('bracket.updated'), stageId: Id }),
  z.object({ type: z.literal('announcement.created'), tournamentId: Id, title: z.string() }),
  z.object({ type: z.literal('tournament.updated'), tournamentId: Id }),
  z.object({ type: z.literal('notification.created'), id: Id }),
  z.object({ type: z.literal('lobby.revealed'), matchId: Id }),
  z.object({ type: z.literal('session.revoked'), reason: z.string() }),
]);
export type RealtimeEvent = z.infer<typeof RealtimeEvent>;

/** Canais: `tournament:{id}` (público), `match:{id}` (participantes e staff), `user:{id}` (só o dono). */
export type RealtimeChannel = `tournament:${string}` | `match:${string}` | `user:${string}`;
