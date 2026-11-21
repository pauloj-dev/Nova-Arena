/**
 * Fila de alertas antifraude (issue #114) no painel de moderação. Porta de `apps/web/mocks/handlers/admin-fraud.ts`.
 *
 * - `GET /admin/fraud-alerts?status=&kind=&page=`: abertos primeiro (o mais recente no topo), depois os tratados.
 * - `PATCH /admin/fraud-alerts/:id`: fecha o alerta como tratado ou improcedente, com a explicação (auditado).
 * - Alertas de **ações administrativas em massa** só aparecem para o Super Admin: um Admin não analisa alerta
 *   sobre outro Admin (nem sobre si mesmo).
 * - `watchAdminActions`: middleware de `/admin/*` que, depois de cada alteração bem-sucedida, confere as ações em
 *   massa do Admin (`checkMassAdminActions`).
 */
import { audited, withAudit, type FraudAlert as DbFraudAlert, type Prisma, type PrismaClient } from '@nova/db';
import { FRAUD_ALERT_LABELS, FraudAlertKind, FraudAlertPage, FraudAlertStatus, MASS_ACTION_LABELS, MassActionKind, ReviewFraudAlertInput, FraudAlert, type FraudAlertUser } from '@nova/schemas';
import { Hono, type MiddlewareHandler } from 'hono';
import { auditContext, requireAdmin } from '../../auth/admin';
import { body, respond, type AppEnv } from '../../context';
import { conflict, forbidden, notFound } from '../../errors';
import { checkMassAdminActions } from '../../fraud';
import { isUuid, pageOf } from '../admin/shared';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const watchAdminActions: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (!MUTATIONS.has(c.req.method) || c.res.status >= 400) return;
  const session = c.get('session');
  if (session) await checkMassAdminActions(c, session.userId);
};

type Details = FraudAlert['details'];

function summaryOf(alert: DbFraudAlert, details: Details, actorNickname: string | null): string {
  const n = (key: string) => (typeof details[key] === 'number' ? (details[key] as number) : 0);
  switch (alert.kind) {
    case 'MULTI_ACCOUNT_IP':
      return `${n('accounts')} contas entraram do IP ${String(details.ip ?? '')} em ${n('windowHours')} h.`;
    case 'MULTI_ACCOUNT_DEVICE':
      return `${n('accounts')} contas entraram do mesmo aparelho em ${n('windowDays')} dias.`;
    case 'DUPLICATE_GAME_ID':
      return `O ID "${String(details.playerId ?? '')}" do ${String(details.game ?? 'jogo')} está em ${n('accounts')} contas.`;
    case 'MASS_ADMIN_ACTION': {
      const action = MassActionKind.safeParse(details.action);
      const what = action.success ? MASS_ACTION_LABELS[action.data] : 'ações';
      return `${actorNickname ?? 'Um Admin'} fez ${n('count')} ${what} em ${n('windowSeconds')} s.`;
    }
  }
}

async function toAlerts(db: PrismaClient, rows: DbFraudAlert[]): Promise<FraudAlert[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    r.userIds.forEach((id) => ids.add(id));
    if (r.actorId) ids.add(r.actorId);
    if (r.reviewedById) ids.add(r.reviewedById);
  }
  const users = await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nickname: true, status: true } });
  const byId = new Map<string, FraudAlertUser>(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const details = (r.details ?? {}) as Details;
    const actor = r.actorId ? (byId.get(r.actorId) ?? null) : null;
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      severity: r.severity === 'HIGH' || r.severity === 'LOW' ? r.severity : 'MEDIUM',
      summary: summaryOf(r, details, actor?.nickname ?? null),
      users: r.userIds.map((id) => byId.get(id)).filter((u): u is FraudAlertUser => Boolean(u)),
      actor,
      details,
      occurrences: r.occurrences,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      reviewedByNickname: r.reviewedById ? (byId.get(r.reviewedById)?.nickname ?? null) : null,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      resolution: r.resolution,
    };
  });
}

/** O que cada um vê: o Admin não vê os alertas de ações em massa (são sobre Admins). */
const visibleTo = (actor: { isSuperAdmin: boolean }): Prisma.FraudAlertWhereInput => (actor.isSuperAdmin ? {} : { kind: { not: 'MASS_ADMIN_ACTION' } });

export const fraud = new Hono<AppEnv>();

fraud.get('/admin/fraud-alerts', async (c) => {
  const actor = await requireAdmin(c);
  const db = c.get('deps').db();
  const status = FraudAlertStatus.safeParse(c.req.query('status'));
  const kind = FraudAlertKind.safeParse(c.req.query('kind'));
  const scope = visibleTo(actor);
  const where: Prisma.FraudAlertWhereInput = { AND: [scope, status.success ? { status: status.data } : {}, kind.success ? { kind: kind.data } : {}] };
  const [total, openCount] = await Promise.all([db.fraudAlert.count({ where }), db.fraudAlert.count({ where: { AND: [scope, { status: 'OPEN' }] } })]);
  const { page, pageCount, skip, take } = pageOf(c.req.query('page'), total);
  // Abertos primeiro (o enum ordena OPEN antes dos fechados), o mais recente no topo.
  const rows = await db.fraudAlert.findMany({ where, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], skip, take });
  return respond(c, FraudAlertPage, { items: await toAlerts(db, rows), page, pageCount, total, openCount });
});

fraud.patch('/admin/fraud-alerts/:id', async (c) => {
  const actor = await requireAdmin(c);
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const alert = isUuid(id) ? await db.fraudAlert.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } }) : null;
  if (!alert) throw notFound('Alerta');
  if (alert.actorId === actor.id) throw forbidden('Outro Super Admin precisa analisar um alerta sobre as suas próprias ações.', 'OWN_ALERT');
  if (alert.status !== 'OPEN') throw conflict('Este alerta já foi analisado.', 'ALERT_CLOSED');
  const input = await body(c, ReviewFraudAlertInput);
  const now = c.get('deps').now();
  const saved = await withAudit(db, await auditContext(c, input.resolution), async (tx) => {
    const updated = await tx.fraudAlert.update({ where: { id: alert.id }, data: { status: input.status, resolution: input.resolution, reviewedById: actor.id, reviewedAt: now } });
    await audited(tx, {
      action: 'FRAUD_ALERT_REVIEWED',
      entityType: 'FraudAlert',
      entityId: alert.id,
      entityLabel: FRAUD_ALERT_LABELS[alert.kind],
      before: { status: alert.status },
      after: { status: input.status },
      reason: input.resolution,
    });
    return updated;
  });
  const [item] = await toAlerts(db, [saved]);
  return respond(c, FraudAlert, item as FraudAlert);
});
