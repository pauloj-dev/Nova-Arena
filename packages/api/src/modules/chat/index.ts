/**
 * Chat por partida (issue 125). Porta de `apps/web/mocks/handlers/chat.ts`.
 *
 * - Quem lê e escreve: quem joga a partida (solo ou no elenco ativo do squad) e a organização do campeonato (dono,
 *   co-organizador, moderador) e Admin — a mesma regra do canal de tempo real `match:{id}` (`modules/realtime`).
 * - `GET /matches/:id/chat`: as últimas 100 mensagens, das mais antigas para as mais novas.
 * - `POST /matches/:id/chat`: até 500 caracteres; 5 mensagens a cada 30 s por pessoa na partida (429 `RATE_LIMITED`).
 *   Só com o campeonato em andamento (ou pausado); depois fica só para leitura.
 * - `DELETE /matches/:id/chat/:messageId`: a organização oculta qualquer mensagem; o autor, a própria. Nada é
 *   apagado: a moderação continua vendo o texto. A denúncia é pelo `ReportButton` (alvo `CHAT_MESSAGE`).
 * - Depois de gravar, publica `chat.updated` em `match:{id}` (sem o texto: a tela busca na API).
 */
import { ACTIVE_REGISTRATION_STATUSES, CHAT_RATE_LIMIT, MatchChat, MatchChatInput, MatchChatMessage, type ChatAuthorRole } from '@nova/schemas';
import type { PrismaClient, Role } from '@nova/db';
import { Hono } from 'hono';
import { body, respond, type AppEnv } from '../../context';
import { forbidden, HttpProblem, notFound } from '../../errors';
import { currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { findMatch } from '../../competition/bracket';
import { publish } from '../../notify';
import { enforceLimit } from '../../security';
import { isUuid } from '../competition/access';

const HISTORY_LIMIT = 100;
const OPEN_STATUSES = new Set(['IN_PROGRESS', 'PAUSED']);

export interface ChatAccess {
  matchId: string;
  tournamentId: string;
  role: ChatAuthorRole;
  /** Pode escrever agora; senão, o motivo. */
  closedReason: string | null;
}

/**
 * Papel de quem pede no chat da partida, ou `null` se não pode ver. Organização vem antes: quem é staff e também
 * joga fala como organização.
 */
export async function chatAccess(db: PrismaClient, viewer: { userId: string; roles: readonly Role[] }, matchId: string): Promise<ChatAccess | null> {
  const found = isUuid(matchId) ? await findMatch(db, matchId) : null;
  if (!found) return null;
  const t = found.stage.tournament;
  const base = { matchId: found.row.id, tournamentId: t.id };
  const closedReason = !OPEN_STATUSES.has(t.status)
    ? 'O campeonato não está em andamento: o chat fica só para leitura.'
    : found.row.status === 'CANCELLED'
      ? 'A partida foi cancelada: o chat fica só para leitura.'
      : null;
  if (isAdmin(viewer.roles) || t.ownerId === viewer.userId) return { ...base, role: 'STAFF', closedReason };
  const staff = await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: viewer.userId } }, select: { role: true } });
  if (staff) return { ...base, role: 'STAFF', closedReason };
  const reg = await db.registration.findFirst({
    where: { tournamentId: t.id, status: { in: [...ACTIVE_REGISTRATION_STATUSES] }, OR: [{ userId: viewer.userId }, { members: { some: { userId: viewer.userId } } }] },
    select: { id: true },
  });
  if (reg && found.node.slots.some((s) => s.entrantId === reg.id)) return { ...base, role: 'PLAYER', closedReason };
  return null;
}

type MessageRow = { id: string; matchId: string; authorId: string; authorRole: string; body: string; hiddenAt: Date | null; createdAt: Date };

async function toMessages(db: PrismaClient, rows: MessageRow[], viewerRole: ChatAuthorRole): Promise<MatchChatMessage[]> {
  const ids = [...new Set(rows.map((r) => r.authorId))];
  const users = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, avatarUrl: true } })).map((u) => [u.id, u]));
  return rows.map((r) => ({
    id: r.id,
    matchId: r.matchId,
    authorId: r.authorId,
    authorNickname: users.get(r.authorId)?.nickname ?? 'Usuário',
    authorAvatarUrl: users.get(r.authorId)?.avatarUrl ?? null,
    authorRole: r.authorRole === 'STAFF' ? 'STAFF' : 'PLAYER',
    // A organização continua vendo o texto ocultado (para moderar); os jogadores, não.
    body: r.hiddenAt && viewerRole !== 'STAFF' ? '' : r.body,
    hidden: r.hiddenAt !== null,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function requireAccess(c: Parameters<typeof requireSession>[0], matchId: string): Promise<{ access: ChatAccess; userId: string }> {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  if (!isUuid(matchId) || !(await db.match.findUnique({ where: { id: matchId }, select: { id: true } }))) throw notFound('Partida');
  const access = await chatAccess(db, { userId: session.userId, roles: await currentRoles(c) }, matchId);
  if (!access) throw forbidden('O chat é só para quem joga a partida e para a organização do campeonato.');
  return { access, userId: session.userId };
}

export const chat = new Hono<AppEnv>();

chat.get('/matches/:id/chat', async (c) => {
  const { access } = await requireAccess(c, c.req.param('id'));
  const db = c.get('deps').db();
  const rows = await db.matchChatMessage.findMany({ where: { matchId: access.matchId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT });
  c.header('Cache-Control', 'private, no-store');
  return respond(c, MatchChat, {
    messages: await toMessages(db, rows.reverse(), access.role),
    canPost: access.closedReason === null,
    canModerate: access.role === 'STAFF',
    closedReason: access.closedReason,
  });
});

chat.post('/matches/:id/chat', async (c) => {
  const { access, userId } = await requireAccess(c, c.req.param('id'));
  if (access.closedReason) throw new HttpProblem(409, access.closedReason, 'CHAT_CLOSED');
  const input = await body(c, MatchChatInput);
  const { limiter, now, db: getDb } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), { name: 'chat', tokens: CHAT_RATE_LIMIT.messages, windowSeconds: CHAT_RATE_LIMIT.windowSeconds }, `${userId}:${access.matchId}`, now());
  const db = getDb();
  const row = await db.matchChatMessage.create({ data: { matchId: access.matchId, authorId: userId, authorRole: access.role, body: input.body, createdAt: now() } });
  await publish(c, `match:${access.matchId}`, { type: 'chat.updated', matchId: access.matchId });
  const [message] = await toMessages(db, [row], access.role);
  return respond(c, MatchChatMessage, message as MatchChatMessage, 201);
});

chat.delete('/matches/:id/chat/:messageId', async (c) => {
  const { access, userId } = await requireAccess(c, c.req.param('id'));
  const db = c.get('deps').db();
  const messageId = c.req.param('messageId');
  const row = isUuid(messageId) ? await db.matchChatMessage.findFirst({ where: { id: messageId, matchId: access.matchId } }) : null;
  if (!row) throw notFound('Mensagem');
  if (access.role !== 'STAFF' && row.authorId !== userId) throw forbidden('Só a organização oculta mensagens de outras pessoas.');
  const updated = row.hiddenAt ? row : await db.matchChatMessage.update({ where: { id: row.id }, data: { hiddenAt: c.get('deps').now(), hiddenById: userId } });
  if (!row.hiddenAt) await publish(c, `match:${access.matchId}`, { type: 'chat.updated', matchId: access.matchId });
  const [message] = await toMessages(db, [updated], access.role);
  return respond(c, MatchChatMessage, message as MatchChatMessage);
});
