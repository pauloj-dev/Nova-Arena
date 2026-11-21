/**
 * Módulo `chat` da API simulada: chat por partida (issue 125). Mesmas regras da API real (`packages/api/src/modules/chat`):
 *
 * - Lê e escreve quem joga a partida e a organização do campeonato (dono, co-organizador, moderador) e Admin.
 * - Até 500 caracteres; 5 mensagens a cada 30 s por pessoa na partida (429 `RATE_LIMITED`).
 * - Só com o campeonato em andamento (ou pausado); depois, só leitura (409 `CHAT_CLOSED` ao escrever).
 * - A organização oculta qualquer mensagem; o autor, a própria. Nada é apagado.
 * - Depois de gravar, publica `chat.updated` em `match:{id}` no barramento do protótipo (sem o texto).
 */
import { http, type HttpHandler } from 'msw';
import { ACTIVE_REGISTRATION_STATUSES, CHAT_RATE_LIMIT, MatchChatInput, type ChatAuthorRole, type MatchChat, type MatchChatMessage } from '@nova/schemas';
import { publish } from '../bus';
import { findStage, getRun, splitMatchId } from '../competition';
import { collection, db, nowIso, save, uid, type DbUser } from '../db';
import { body, conflict, forbidden, handle, HttpProblem, json, notFound, param, requireUser, tournamentAccess, url } from '../http';

export const moduleName = 'chat';

export interface DbChatMessage {
  id: string;
  matchId: string;
  authorId: string;
  authorRole: ChatAuthorRole;
  body: string;
  hiddenAt: string | null;
  hiddenById: string | null;
  createdAt: string;
}

export const chatMessages = () => collection<DbChatMessage>('chatMessages');

const HISTORY_LIMIT = 100;

interface ChatAccess {
  matchId: string;
  tournamentId: string;
  role: ChatAuthorRole;
  closedReason: string | null;
}

/** Papel do usuário no chat da partida, ou nulo se não pode ver. Organização vem antes de jogador. */
export function chatAccess(user: DbUser, matchId: string): ChatAccess | null {
  let found: ReturnType<typeof findStage>;
  let nodeId: string;
  try {
    const split = splitMatchId(matchId);
    nodeId = split.nodeId;
    found = findStage(split.stageId);
  } catch {
    return null;
  }
  const run = getRun(found.stage.id);
  const node = run?.confirmed ? run.structure.matches.find((m) => m.id === nodeId) : undefined;
  if (!run || !node) return null;
  const t = found.tournament;
  const closedReason = t.status !== 'IN_PROGRESS' && t.status !== 'PAUSED' ? 'O campeonato não está em andamento: o chat fica só para leitura.' : null;
  const base = { matchId, tournamentId: t.id, closedReason };
  if (tournamentAccess(user, t) !== null) return { ...base, role: 'STAFF' };
  const reg = db().registrations.find(
    (r) => r.tournamentId === t.id && ACTIVE_REGISTRATION_STATUSES.includes(r.status) && (r.userId === user.id || r.members.some((m) => m.userId === user.id && m.confirmedAt)),
  );
  if (reg && node.slots.some((s) => s.entrantId === reg.id)) return { ...base, role: 'PLAYER' };
  return null;
}

function requireAccess(matchId: string): { user: DbUser; access: ChatAccess } {
  const user = requireUser();
  let exists = false;
  try {
    const { stageId, nodeId } = splitMatchId(matchId);
    exists = Boolean(getRun(stageId)?.structure.matches.some((m) => m.id === nodeId));
  } catch {
    exists = false;
  }
  if (!exists) throw notFound('Partida');
  const access = chatAccess(user, matchId);
  if (!access) throw forbidden('O chat é só para quem joga a partida e para a organização do campeonato.');
  return { user, access };
}

function toMessage(m: DbChatMessage, viewerRole: ChatAuthorRole): MatchChatMessage {
  const author = db().users.find((u) => u.id === m.authorId);
  return {
    id: m.id,
    matchId: m.matchId,
    authorId: m.authorId,
    authorNickname: author?.nickname ?? 'Usuário',
    authorAvatarUrl: author?.avatarUrl ?? null,
    authorRole: m.authorRole,
    body: m.hiddenAt && viewerRole !== 'STAFF' ? '' : m.body,
    hidden: m.hiddenAt !== null,
    createdAt: m.createdAt,
  };
}

export const handlers: HttpHandler[] = [
  http.get(
    url('/matches/:id/chat'),
    handle(({ params }) => {
      const { access } = requireAccess(param(params, 'id'));
      const messages = chatMessages()
        .filter((m) => m.matchId === access.matchId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(-HISTORY_LIMIT);
      const result: MatchChat = { messages: messages.map((m) => toMessage(m, access.role)), canPost: access.closedReason === null, canModerate: access.role === 'STAFF', closedReason: access.closedReason };
      return json(result);
    }),
  ),

  http.post(
    url('/matches/:id/chat'),
    handle(async ({ params, request }) => {
      const { user, access } = requireAccess(param(params, 'id'));
      if (access.closedReason) throw conflict(access.closedReason, 'CHAT_CLOSED');
      const input = await body(request, MatchChatInput);
      const since = Date.now() - CHAT_RATE_LIMIT.windowSeconds * 1000;
      const recent = chatMessages().filter((m) => m.matchId === access.matchId && m.authorId === user.id && new Date(m.createdAt).getTime() > since);
      if (recent.length >= CHAT_RATE_LIMIT.messages) {
        const oldest = Math.min(...recent.map((m) => new Date(m.createdAt).getTime()));
        const seconds = Math.max(1, Math.ceil((oldest + CHAT_RATE_LIMIT.windowSeconds * 1000 - Date.now()) / 1000));
        throw new HttpProblem(429, `Muitas tentativas. Espere ${seconds} s e tente de novo.`, 'RATE_LIMITED');
      }
      const record: DbChatMessage = { id: uid('cm'), matchId: access.matchId, authorId: user.id, authorRole: access.role, body: input.body, hiddenAt: null, hiddenById: null, createdAt: nowIso() };
      chatMessages().push(record);
      save();
      publish(`match:${access.matchId}`, { type: 'chat.updated', matchId: access.matchId });
      return json(toMessage(record, access.role), 201);
    }),
  ),

  http.delete(
    url('/matches/:id/chat/:messageId'),
    handle(({ params }) => {
      const { user, access } = requireAccess(param(params, 'id'));
      const message = chatMessages().find((m) => m.id === param(params, 'messageId') && m.matchId === access.matchId);
      if (!message) throw notFound('Mensagem');
      if (access.role !== 'STAFF' && message.authorId !== user.id) throw forbidden('Só a organização oculta mensagens de outras pessoas.');
      if (!message.hiddenAt) {
        message.hiddenAt = nowIso();
        message.hiddenById = user.id;
        save();
        publish(`match:${access.matchId}`, { type: 'chat.updated', matchId: access.matchId });
      }
      return json(toMessage(message, access.role));
    }),
  ),
];
