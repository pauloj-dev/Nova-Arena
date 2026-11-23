/**
 * Módulo `notifications` (issue #98, PAR-10): lista, contador, leitura, preferências por tipo e canal, e seguir
 * campeonato ou jogo (RN-15). Porta de `apps/web/mocks/handlers/notifications.ts` (e do "seguir" de
 * `mocks/handlers/users.ts`): mesmas rotas, mensagens e códigos.
 *
 * As notificações são gravadas por `notify()` (`src/notify.ts`), chamado pelos outros módulos depois do commit.
 * Diferenças da API simulada:
 * - Sem dados de demonstração semeados na leitura (o seed do banco cuida disso).
 * - O cursor é opaco (data + id da última da página), estável mesmo com notificações chegando entre as páginas.
 * - As preferências trazem também `push` (issue #109).
 */
import { FollowList, FollowTargetType, Notification, NotificationPreference, NotificationPreferencesInput, page, UnreadCount } from '@nova/schemas';
import type { NotificationType as DbNotificationType, Prisma } from '@nova/db';
import { NotificationType } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';

const PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NotificationPage = page(Notification);
const Preferences = z.array(NotificationPreference);

type Row = { id: string; type: DbNotificationType; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date };

const toNotification = (n: Row): Notification => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() });

/** Cursor opaco: a data e o id da última notificação da página anterior. */
const Cursor = z.object({ t: z.iso.datetime(), id: z.uuid() });
function encodeCursor(n: Row): string {
  return Buffer.from(JSON.stringify({ t: n.createdAt.toISOString(), id: n.id })).toString('base64url');
}
function decodeCursor(raw: string | undefined): z.infer<typeof Cursor> | null {
  if (!raw) return null;
  try {
    const parsed = Cursor.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Uma linha por tipo, na ordem do contrato. Sem registro = tudo ligado. `SANCTION` sempre ligado. */
async function preferencesOf(c: AppContext, userId: string): Promise<NotificationPreference[]> {
  const saved = await c.get('deps').db().notificationPreference.findMany({ where: { userId } });
  return NotificationType.options.map((type) => {
    if (type === 'SANCTION') return { type, inApp: true, email: true, push: true };
    const pref = saved.find((p) => p.type === type);
    return { type, inApp: pref?.inApp ?? true, email: pref?.email ?? true, push: pref?.push ?? true };
  });
}

export const notifications = new Hono<AppEnv>();

notifications.get('/notifications/unread-count', async (c) => {
  const session = await requireSession(c);
  const count = await c.get('deps').db().notification.count({ where: { userId: session.userId, inApp: true, readAt: null } });
  return respond(c, UnreadCount, { count });
});

notifications.post('/notifications/read-all', async (c) => {
  const session = await requireSession(c);
  const { db, now } = c.get('deps');
  await db().notification.updateMany({ where: { userId: session.userId, inApp: true, readAt: null }, data: { readAt: now() } });
  return respond(c, UnreadCount, { count: 0 });
});

/** Mais recentes primeiro, por cursor. `unread=1` filtra as não lidas; `limit` de 1 a 50 (padrão 10). */
notifications.get('/notifications', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const onlyUnread = c.req.query('unread') === '1' || c.req.query('unread') === 'true';
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(c.req.query('limit') ?? '', 10) || PAGE_SIZE));
  const cursor = decodeCursor(c.req.query('cursor'));
  const where: Prisma.NotificationWhereInput = { userId: session.userId, inApp: true, ...(onlyUnread ? { readAt: null } : {}) };
  const after: Prisma.NotificationWhereInput = cursor ? { OR: [{ createdAt: { lt: new Date(cursor.t) } }, { createdAt: new Date(cursor.t), id: { lt: cursor.id } }] } : {};
  const [rows, total] = await Promise.all([
    db.notification.findMany({ where: { ...where, ...after }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 }),
    db.notification.count({ where }),
  ]);
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  c.header('Cache-Control', 'private, no-store');
  return respond(c, NotificationPage, { items: items.map(toNotification), nextCursor: rows.length > limit && last ? encodeCursor(last) : null, total });
});

notifications.post('/notifications/:id/read', async (c) => {
  const session = await requireSession(c);
  const { db, now } = c.get('deps');
  const id = c.req.param('id');
  // Só o dono enxerga a notificação: a de outra pessoa "não existe".
  const found = UUID.test(id) ? await db().notification.findFirst({ where: { id, userId: session.userId, inApp: true } }) : null;
  if (!found) throw notFound('Notificação');
  if (found.readAt) return respond(c, Notification, toNotification(found));
  await db().notification.updateMany({ where: { id, readAt: null }, data: { readAt: now() } });
  return respond(c, Notification, toNotification(await db().notification.findUniqueOrThrow({ where: { id } })));
});

// ── Preferências ─────────────────────────────────────────────────────

notifications.get('/me/notification-preferences', async (c) => {
  const session = await requireSession(c);
  return respond(c, Preferences, await preferencesOf(c, session.userId));
});

notifications.put('/me/notification-preferences', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, NotificationPreferencesInput);
  if (input.preferences.some((p) => p.type === 'SANCTION' && (!p.inApp || !p.email || p.push === false))) {
    throw badRequest('Os avisos da moderação não podem ser desligados.', 'SANCTION_ALWAYS_ON');
  }
  const db = c.get('deps').db();
  await db.$transaction(
    input.preferences
      .filter((p) => p.type !== 'SANCTION')
      .map((p) =>
        db.notificationPreference.upsert({
          where: { userId_type: { userId: session.userId, type: p.type } },
          create: { userId: session.userId, type: p.type, inApp: p.inApp, email: p.email, ...(p.push === undefined ? {} : { push: p.push }) },
          update: { inApp: p.inApp, email: p.email, ...(p.push === undefined ? {} : { push: p.push }) },
        }),
      ),
  );
  return respond(c, Preferences, await preferencesOf(c, session.userId));
});

// ── Seguir campeonato ou jogo (RN-15) ────────────────────────────────

async function followList(c: AppContext, userId: string): Promise<FollowList> {
  const rows = await c.get('deps').db().follow.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { targetType: true, targetId: true } });
  return { tournaments: rows.filter((f) => f.targetType === 'TOURNAMENT').map((f) => f.targetId), games: rows.filter((f) => f.targetType === 'GAME').map((f) => f.targetId) };
}

/** Confere o tipo e se o alvo existe (e é visível para quem pede). Devolve o tipo do banco e o id canônico. */
async function followTarget(c: AppContext, userId: string): Promise<{ targetType: 'TOURNAMENT' | 'GAME'; targetId: string }> {
  const type = FollowTargetType.safeParse(c.req.param('type'));
  if (!type.success) throw notFound('Recurso');
  const id = c.req.param('id') ?? '';
  const db = c.get('deps').db();
  const where = UUID.test(id) ? { OR: [{ id }, { slug: id }] } : { slug: id };
  if (type.data === 'game') {
    const game = await db.game.findFirst({ where, select: { id: true } });
    if (!game) throw notFound('Jogo');
    return { targetType: 'GAME', targetId: game.id };
  }
  const t = await db.tournament.findFirst({ where, select: { id: true, status: true, ownerId: true, staff: { where: { userId }, select: { userId: true } } } });
  // Rascunho não existe para quem não é da organização.
  if (!t || (t.status === 'DRAFT' && t.ownerId !== userId && t.staff.length === 0 && !isAdmin(await currentRoles(c)))) throw notFound('Campeonato');
  return { targetType: 'TOURNAMENT', targetId: t.id };
}

notifications.get('/me/follows', async (c) => {
  const session = await requireSession(c);
  return respond(c, FollowList, await followList(c, session.userId));
});

/** Idempotente: seguir de novo não duplica. */
notifications.put('/me/follows/:type/:id', async (c) => {
  const session = await requireSession(c);
  const target = await followTarget(c, session.userId);
  await c
    .get('deps')
    .db()
    .follow.upsert({ where: { userId_targetType_targetId: { userId: session.userId, ...target } }, create: { userId: session.userId, ...target }, update: {} });
  return respond(c, FollowList, await followList(c, session.userId));
});

notifications.delete('/me/follows/:type/:id', async (c) => {
  const session = await requireSession(c);
  const target = await followTarget(c, session.userId);
  await c.get('deps').db().follow.deleteMany({ where: { userId: session.userId, ...target } });
  return respond(c, FollowList, await followList(c, session.userId));
});

export { notificationJobs } from './jobs';
