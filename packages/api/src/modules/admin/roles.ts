/**
 * Delegação de acesso (issue #92, ADM-02, ADM-03, PRD §7.3). Porta de `apps/web/mocks/handlers/admin-roles.ts` e das
 * rotas de convite de `apps/web/mocks/handlers/users.ts`.
 *
 * - Convites de Admin/Organizador: o token **só existe na resposta da criação** (e no e-mail, quando é por e-mail);
 *   o banco guarda o hash. Aceite exige login e e-mail verificado; convite expirado, revogado ou esgotado responde 410
 *   e não concede nada (CT-03). O limite de usos vale sob concorrência: o uso é contado num `UPDATE` condicional.
 * - Conceder/revogar papel (nota ¹ da matriz, RN-11): ninguém remove o Super Admin; Admin remove Admin mais novo no
 *   papel; o mais antigo vira pedido que só o Super Admin aprova (regra desligável nas configurações).
 * - Revogar organizador aplica a RN-09. Organizador novo começa com o limite padrão (RN-10).
 * - Mudança de papel é auditada pelo gatilho de `user_roles` (ROLE_GRANTED/ROLE_REVOKED), com o motivo do contexto.
 */
import { audited, grantRole, revokeRole, withAudit, type Tx } from '@nova/db';
import {
  AcceptRoleInviteResponse,
  type AdminUser,
  ACTIVE_TOURNAMENT_STATUSES,
  AdminMember,
  AdminOrganizer,
  AdminOrganizerRequest,
  AdminRemovalRequest,
  AdminUserDetail,
  CreateRoleInviteInput,
  numberedPage,
  OrganizerLimitsInput,
  ReviewOrganizerRequestInput,
  RoleChangeInput,
  RoleInvite,
  RoleInvitePreview,
  RoleRevokeResult,
} from '@nova/schemas';
import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { auditContext, requireAdmin, requireSuperAdmin } from '../../auth/admin';
import { sha256 } from '../../auth/crypto';
import { requireSession } from '../../auth/session';
import { siteUrl } from '../../auth/email-tokens';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { revalidateTournaments } from '../../revalidate';
import { loadMe } from '../../views';
import { markUnchanged } from '../site/events';
import { loadSettings } from '../site/store';
import { releaseTournamentsOf } from './rn09';
import { expireSuspensions } from './sanctions';
import { activeAdminIds, adminUserInclude, AfterCommit, DEFAULT_LIMITS, findTargetUser, hasRole, isUuid, nicknames, normalize, pageOf, toAdminUserDetail, toAdminUsers, tournamentsPlayed, type AdminUserRow } from './shared';
import { optionalReason } from './users';
import { messages } from '../../messages/pt-BR';

const HOUR_MS = 3600_000;
const VALIDITY_MS: Record<CreateRoleInviteInput['validity'], number> = { '1h': HOUR_MS, '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS };
type GrantRole = 'ADMIN' | 'ORGANIZER';
const ROLE_NAME: Record<GrantRole, string> = { ADMIN: 'administrador', ORGANIZER: 'organizador' };

export const adminRoles = new Hono<AppEnv>();

// ── Convites ─────────────────────────────────────────────────────────
type InviteRow = { id: string; role: string; email: string | null; maxUses: number; uses: number; expiresAt: Date; revokedAt: Date | null; createdById: string; createdAt: Date };

function inviteState(invite: InviteRow, now: Date): RoleInvite['state'] {
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (invite.uses >= invite.maxUses) return 'EXHAUSTED';
  return 'VALID';
}

const asGrantRole = (role: string): GrantRole => (role === 'ADMIN' ? 'ADMIN' : 'ORGANIZER');

function toRoleInvite(invite: InviteRow, names: Map<string, string>, now: Date, link: string | null = null): RoleInvite {
  return {
    id: invite.id,
    role: asGrantRole(invite.role),
    email: invite.email,
    link,
    maxUses: invite.maxUses,
    uses: invite.uses,
    state: inviteState(invite, now),
    createdByNickname: names.get(invite.createdById) ?? 'Nova Arena',
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

const INVALID_INVITE: Record<Exclude<RoleInvite['state'], 'VALID'>, { title: string; code: string }> = {
  EXPIRED: { title: 'Este convite expirou. Peça um novo a quem convidou você.', code: 'INVITE_EXPIRED' },
  REVOKED: { title: 'Este convite foi cancelado por quem o criou.', code: 'INVITE_REVOKED' },
  EXHAUSTED: { title: 'Este convite já foi usado o número máximo de vezes.', code: 'INVITE_EXHAUSTED' },
};

adminRoles.get('/admin/invites', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const rows = await db.roleInvite.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  const names = await nicknames(
    db,
    rows.map((r) => r.createdById),
  );
  return respond(
    c,
    z.array(RoleInvite),
    rows.map((r) => toRoleInvite(r, names, c.get('deps').now())),
  );
});

adminRoles.post('/admin/invites', async (c) => {
  const actor = await requireAdmin(c);
  const input = await body(c, CreateRoleInviteInput);
  const { db: getDb, now: clock, mailer } = c.get('deps');
  const db = getDb();
  const now = clock();
  // 48 caracteres hexadecimais; só o hash vai para o banco.
  const token = randomBytes(24).toString('hex');
  const email = input.email?.trim().toLowerCase() || null;
  const invite = await withAudit(db, await auditContext(c), async (tx) => {
    const created = await tx.roleInvite.create({
      data: { role: input.role, tokenHash: sha256(token), email, maxUses: email ? 1 : input.maxUses, expiresAt: new Date(now.getTime() + VALIDITY_MS[input.validity]), createdById: actor.id },
    });
    // O token nunca entra na auditoria.
    await audited(tx, {
      action: 'INVITE_CREATED',
      entityType: 'RoleInvite',
      entityId: created.id,
      entityLabel: `Convite de ${ROLE_NAME[input.role]}`,
      after: { papel: input.role, validade: input.validity, usos: created.maxUses, ...(email ? { email } : {}) },
    });
    return created;
  });
  const link = siteUrl(c, `/convite/${token}`);
  const names = await nicknames(db, [actor.id]);
  if (email) {
    try {
      await mailer(c.get('env'), c.get('log')).send(email, {
        template: 'ROLE_INVITE',
        data: { role: ROLE_NAME[input.role], inviter: names.get(actor.id) ?? 'Nova Arena', link, expiresAt: invite.expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) },
      });
    } catch (error) {
      c.get('log').error('não foi possível enviar o convite por e-mail', { inviteId: invite.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return respond(c, RoleInvite, toRoleInvite(invite, names, now, link), 201);
});

adminRoles.delete('/admin/invites/:id', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const id = c.req.param('id');
  const invite = isUuid(id) ? await db.roleInvite.findUnique({ where: { id } }) : null;
  if (!invite) throw notFound('Convite');
  const state = inviteState(invite, now);
  if (state === 'REVOKED') throw conflict('Este convite já foi revogado.', 'INVITE_REVOKED');
  const saved = await withAudit(db, await auditContext(c), async (tx) => {
    const { count } = await tx.roleInvite.updateMany({ where: { id: invite.id, revokedAt: null }, data: { revokedAt: now } });
    if (count === 0) throw conflict('Este convite já foi revogado.', 'INVITE_REVOKED');
    await audited(tx, { action: 'INVITE_REVOKED', entityType: 'RoleInvite', entityId: invite.id, entityLabel: `Convite de ${ROLE_NAME[asGrantRole(invite.role)]}`, before: { estado: state, usos: `${invite.uses}/${invite.maxUses}` }, after: { estado: 'REVOKED' } });
    return tx.roleInvite.findUniqueOrThrow({ where: { id: invite.id } });
  });
  return respond(c, RoleInvite, toRoleInvite(saved, await nicknames(db, [saved.createdById]), now));
});

async function findInviteByToken(c: AppContext, token: string) {
  const invite = token.length >= 8 && token.length <= 200 ? await c.get('deps').db().roleInvite.findUnique({ where: { tokenHash: sha256(token) } }) : null;
  if (!invite) throw notFound('Convite');
  return invite;
}

/** Público: quem convidou, para qual papel e se ainda vale (a tela do convite mostra antes do login). */
adminRoles.get('/role-invites/:token', async (c) => {
  const invite = await findInviteByToken(c, c.req.param('token'));
  const names = await nicknames(c.get('deps').db(), [invite.createdById]);
  return respond(c, RoleInvitePreview, { role: asGrantRole(invite.role), state: inviteState(invite, c.get('deps').now()), invitedBy: names.get(invite.createdById) ?? 'Nova Arena', expiresAt: invite.expiresAt.toISOString() });
});

/** Organizador novo começa com o limite padrão da RN-10 (3 simultâneos, todos os jogos). */
async function ensureOrganizerLimits(tx: Tx, userId: string): Promise<number> {
  const limits = await tx.organizerLimits.upsert({ where: { userId }, create: { userId, maxActiveTournaments: DEFAULT_LIMITS.maxActiveTournaments, allowedGameIds: [] }, update: {} });
  return limits.maxActiveTournaments;
}

adminRoles.post('/role-invites/:token/accept', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const invite = await findInviteByToken(c, c.req.param('token'));
  // Convite inválido: 410 e nada muda (nenhum papel concedido, `uses` intacto).
  const state = inviteState(invite, now);
  if (state !== 'VALID') throw new HttpProblem(410, INVALID_INVITE[state].title, INVALID_INVITE[state].code);
  const user = await db.user.findUniqueOrThrow({ where: { id: session.userId }, include: { roles: true } });
  if (!user.emailVerified) throw new HttpProblem(403, 'Confirme seu e-mail antes de aceitar o convite.', 'EMAIL_NOT_VERIFIED');
  if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) throw forbidden('Este convite foi enviado para outro e-mail.');
  const role = asGrantRole(invite.role);
  if (hasRole(user, role)) throw conflict(role === 'ADMIN' ? 'Você já é administrador.' : 'Você já é organizador.', 'ROLE_ALREADY_GRANTED');

  await withAudit(db, { ...(await auditContext(c)), reason: 'Convite de papel aceito' }, async (tx) => {
    // Conta o uso só se o convite ainda vale **agora** (limite de usos sob concorrência: um UPDATE condicional por vez).
    const { count } = await tx.roleInvite.updateMany({
      where: { id: invite.id, revokedAt: null, expiresAt: { gt: now }, uses: { lt: tx.roleInvite.fields.maxUses } },
      data: { uses: { increment: 1 } },
    });
    if (count === 0) {
      const current = await tx.roleInvite.findUniqueOrThrow({ where: { id: invite.id } });
      const now2 = inviteState(current, now);
      const which = now2 === 'VALID' ? 'EXHAUSTED' : now2;
      throw new HttpProblem(410, INVALID_INVITE[which].title, INVALID_INVITE[which].code);
    }
    if (!(await grantRole(tx, user.id, role, invite.createdById))) throw conflict(role === 'ADMIN' ? 'Você já é administrador.' : 'Você já é organizador.', 'ROLE_ALREADY_GRANTED');
    if (role === 'ORGANIZER') await ensureOrganizerLimits(tx, user.id);
    await audited(tx, { action: 'INVITE_ACCEPTED', entityType: 'User', entityId: user.id, entityLabel: user.nickname, before: { papel: null }, after: { papel: role, convite: invite.id } });
  });
  return respond(c, AcceptRoleInviteResponse, { role, user: await loadMe(db, user.id) });
});

// ── Administradores ──────────────────────────────────────────────────
/** Desde quando a pessoa é Admin (base da RN-11): a data do papel ADMIN; sem ele, a do SUPER_ADMIN. */
function adminSince(u: { roles: { role: string; grantedAt: Date }[]; createdAt: Date }): Date {
  return (u.roles.find((r) => r.role === 'ADMIN') ?? u.roles.find((r) => r.role === 'SUPER_ADMIN'))?.grantedAt ?? u.createdAt;
}

adminRoles.get('/admin/admins', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  await expireSuspensions(db, now());
  const rows = await db.user.findMany({ where: { status: { notIn: ['MERGED', 'DELETED'] }, roles: { some: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } } }, include: adminUserInclude });
  const users = await toAdminUsers(db, rows, now());
  const members: AdminMember[] = rows.map((r, i) => ({ ...(users[i] as AdminUser), adminSince: adminSince(r).toISOString(), isSuperAdmin: hasRole(r, 'SUPER_ADMIN') }));
  members.sort((a, b) => Number(b.isSuperAdmin) - Number(a.isSuperAdmin) || a.adminSince.localeCompare(b.adminSince));
  return respond(c, z.array(AdminMember), members);
});

adminRoles.post('/admin/users/:id/roles', async (c) => {
  const actor = await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const target = await findTargetUser(db, c.req.param('id'));
  const input = await body(c, RoleChangeInput);
  if (target.status !== 'ACTIVE') throw conflict('Só uma conta ativa pode receber um papel.', 'ACCOUNT_NOT_ACTIVE');
  if (hasRole(target, input.role)) throw conflict(`${target.nickname} já é ${ROLE_NAME[input.role]}.`, 'ROLE_ALREADY_GRANTED');
  if (!target.emailVerified) throw conflict('A conta precisa ter o e-mail confirmado para receber um papel.', 'EMAIL_NOT_VERIFIED');
  const reason = input.reason?.trim() || null;
  await withAudit(db, await auditContext(c, reason), async (tx) => {
    if (!(await grantRole(tx, target.id, input.role, actor.id))) throw conflict(`${target.nickname} já é ${ROLE_NAME[input.role]}.`, 'ROLE_ALREADY_GRANTED');
    if (input.role === 'ORGANIZER') await ensureOrganizerLimits(tx, target.id);
  });
  const after = new AfterCommit();
  if (input.role === 'ORGANIZER') {
    after.notify([target.id], { type: 'ORGANIZER_REQUEST_RESULT', title: messages.roles.organizerGranted.title, body: messages.roles.organizerGranted.body, link: '/organizador' });
  } else {
    after.notify([target.id], { type: 'SANCTION', title: messages.roles.adminGranted.title, body: messages.roles.adminGranted.body, link: '/minha-conta/seguranca' });
  }
  await after.flush(c);
  return respond(c, AdminUserDetail, await toAdminUserDetail(db, target.id, now()));
});

async function removeAdminRole(tx: Tx, target: AdminUserRow, after: AfterCommit, reason: string | null): Promise<void> {
  await revokeRole(tx, target.id, 'ADMIN');
  after.notify([target.id], { type: 'SANCTION', title: messages.roles.adminRevoked.title, body: messages.roles.adminRevoked.body(reason), link: null });
}

adminRoles.delete('/admin/users/:id/roles/:role', async (c) => {
  const actor = await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const target = await findTargetUser(db, c.req.param('id'));
  const role = c.req.param('role');
  const reason = await optionalReason(c);
  const after = new AfterCommit();

  if (role === 'ORGANIZER') {
    if (!hasRole(target, 'ORGANIZER')) throw conflict(`${target.nickname} não é organizador.`, 'ROLE_NOT_GRANTED');
    const affected = await withAudit(db, await auditContext(c, reason), async (tx) => {
      if (!(await revokeRole(tx, target.id, 'ORGANIZER'))) throw conflict(`${target.nickname} não é organizador.`, 'ROLE_NOT_GRANTED');
      // Sem o papel, sem selo e sem limites próprios (se voltar a ser organizador, começa do padrão).
      await tx.organizerLimits.deleteMany({ where: { userId: target.id } });
      return releaseTournamentsOf(tx, target, `Organizador ${target.nickname} revogado`, after);
    });
    after.notify([target.id], {
      type: 'ORGANIZER_REQUEST_RESULT',
      title: messages.roles.organizerRevoked.title,
      body: messages.roles.organizerRevoked.body(reason),
      link: null,
    });
    await after.flush(c);
    if (affected.length > 0) revalidateTournaments(c);
    return respond(c, RoleRevokeResult, { outcome: 'REVOKED', requestId: null, affectedTournaments: affected });
  }

  if (role !== 'ADMIN') throw notFound('Papel');
  // RN-11.
  if (hasRole(target, 'SUPER_ADMIN')) throw forbidden('Ninguém remove o Super Admin. Ele só transfere o papel.');
  if (!hasRole(target, 'ADMIN')) throw conflict(`${target.nickname} não é administrador.`, 'ROLE_NOT_GRANTED');
  if (target.id === actor.id) throw forbidden('Você não pode remover o seu próprio papel de administrador. Peça a outro administrador.');

  const me = await db.user.findUniqueOrThrow({ where: { id: actor.id }, include: { roles: true } });
  const targetIsNewer = adminSince(target).getTime() > adminSince(me).getTime();
  const settings = await loadSettings(db);
  if (actor.isSuperAdmin || targetIsNewer || !settings.requireApprovalForSeniorAdminRemoval) {
    await withAudit(db, await auditContext(c, reason), async (tx) => {
      await removeAdminRole(tx, target, after, reason);
      // Pedidos pendentes sobre a mesma pessoa perdem o sentido.
      await tx.adminRemovalRequest.updateMany({ where: { targetUserId: target.id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: actor.id, decidedAt: now() } });
    });
    await after.flush(c);
    return respond(c, RoleRevokeResult, { outcome: 'REVOKED', requestId: null, affectedTournaments: [] });
  }

  // Admin mais antigo: o papel continua até o Super Admin aprovar.
  if (await db.adminRemovalRequest.findFirst({ where: { targetUserId: target.id, status: 'PENDING' } })) {
    throw conflict(`Já existe um pedido de remoção de ${target.nickname} aguardando o Super Admin.`, 'REMOVAL_ALREADY_REQUESTED');
  }
  const record = await withAudit(db, await auditContext(c, reason), async (tx) => {
    const created = await tx.adminRemovalRequest.create({ data: { targetUserId: target.id, requestedById: actor.id, reason } });
    await audited(tx, { action: 'ADMIN_REMOVAL_REQUESTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, after: { pedido: created.id, situacao: 'PENDING' }, reason });
    return created;
  });
  const actorName = (await nicknames(db, [actor.id])).get(actor.id);
  await after
    .notify(await activeAdminIds(db, true), {
      type: 'ANNOUNCEMENT',
      title: messages.roles.removalRequested.title,
      body: messages.roles.removalRequested.body(actorName, target.nickname),
      link: '/admin/administradores',
    })
    .flush(c);
  return respond(c, RoleRevokeResult, { outcome: 'PENDING_APPROVAL', requestId: record.id, affectedTournaments: [] }, 202);
});

// ── Pedidos de remoção de Admin (RN-11) ──────────────────────────────
type RemovalRow = { id: string; targetUserId: string; requestedById: string; reason: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: Date; decidedAt: Date | null; decidedById: string | null };
function toRemovalRequest(r: RemovalRow, names: Map<string, string>): AdminRemovalRequest {
  return {
    id: r.id,
    targetUserId: r.targetUserId,
    targetNickname: names.get(r.targetUserId) ?? 'Conta removida',
    requestedById: r.requestedById,
    requestedByNickname: names.get(r.requestedById) ?? 'Conta removida',
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.decidedAt?.toISOString() ?? null,
    reviewedByNickname: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
  };
}

adminRoles.get('/admin/admin-removal-requests', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const rows = await db.adminRemovalRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  rows.sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'));
  const names = await nicknames(
    db,
    rows.flatMap((r) => [r.targetUserId, r.requestedById, r.decidedById]),
  );
  return respond(
    c,
    z.array(AdminRemovalRequest),
    rows.map((r) => toRemovalRequest(r, names)),
  );
});

adminRoles.post('/admin/admin-removal-requests/:id/:decision', async (c) => {
  const actor = await requireSuperAdmin(c);
  const decision = c.req.param('decision');
  if (decision !== 'approve' && decision !== 'reject') throw notFound('Rota');
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const id = c.req.param('id');
  const record = isUuid(id) ? await db.adminRemovalRequest.findUnique({ where: { id } }) : null;
  if (!record) throw notFound('Pedido');
  if (record.status !== 'PENDING') throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
  const names = await nicknames(db, [record.targetUserId, record.requestedById, actor.id]);
  const targetName = names.get(record.targetUserId) ?? record.targetUserId;
  const requesterName = names.get(record.requestedById) ?? 'outro administrador';
  const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
  const after = new AfterCommit();
  const saved = await withAudit(db, await auditContext(c, record.reason), async (tx) => {
    const { count } = await tx.adminRemovalRequest.updateMany({ where: { id: record.id, status: 'PENDING' }, data: { status, decidedById: actor.id, decidedAt: now } });
    if (count === 0) throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
    await audited(tx, {
      action: 'ADMIN_REMOVAL_REVIEWED',
      entityType: 'User',
      entityId: record.targetUserId,
      entityLabel: targetName,
      before: { pedido: record.id, situacao: 'PENDING' },
      after: { pedido: record.id, situacao: status },
      reason: record.reason,
    });
    if (decision === 'approve') {
      const target = await tx.user.findUnique({ where: { id: record.targetUserId }, include: adminUserInclude });
      if (target && hasRole(target, 'ADMIN') && !hasRole(target, 'SUPER_ADMIN')) {
        const why = record.reason ? `${record.reason} (pedido de ${requesterName})` : `Pedido de ${requesterName} aprovado`;
        // O motivo da remoção vai para o registro ROLE_REVOKED do gatilho.
        await tx.$executeRaw`SELECT set_config('nova.reason', ${why}, true)`;
        await removeAdminRole(tx, target, after, why);
      }
    }
    return tx.adminRemovalRequest.findUniqueOrThrow({ where: { id: record.id } });
  });
  after.notify([record.requestedById], {
    type: 'ANNOUNCEMENT',
    title: messages.roles.removalDecided.title(decision === 'approve'),
    body: messages.roles.removalDecided.body(decision === 'approve', targetName),
    link: '/admin/administradores',
  });
  await after.flush(c);
  return respond(c, AdminRemovalRequest, toRemovalRequest(saved, names));
});

// ── Organizadores (RN-10) ────────────────────────────────────────────
async function toAdminOrganizers(c: AppContext, rows: AdminUserRow[]): Promise<AdminOrganizer[]> {
  const db = c.get('deps').db();
  const ids = rows.map((r) => r.id);
  const [users, owned] = await Promise.all([toAdminUsers(db, rows, c.get('deps').now()), db.tournament.groupBy({ by: ['ownerId', 'status'], where: { ownerId: { in: ids } }, _count: { _all: true } })]);
  return rows.map((r, i) => {
    const mine = owned.filter((o) => o.ownerId === r.id);
    return {
      ...(users[i] as AdminUser),
      organizerLimits: r.organizerLimits ? { maxActiveTournaments: r.organizerLimits.maxActiveTournaments, allowedGameIds: r.organizerLimits.allowedGameIds } : { ...DEFAULT_LIMITS },
      activeTournaments: mine.filter((o) => ACTIVE_TOURNAMENT_STATUSES.includes(o.status)).reduce((s, o) => s + o._count._all, 0),
      totalTournaments: mine.reduce((s, o) => s + o._count._all, 0),
    };
  });
}

adminRoles.get('/admin/organizers', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  await expireSuspensions(db, now());
  const term = normalize((c.req.query('q') ?? '').trim());
  const where = {
    status: { notIn: ['MERGED', 'DELETED'] as ('MERGED' | 'DELETED')[] },
    roles: { some: { role: 'ORGANIZER' as const } },
    ...(term ? { OR: [{ nicknameKey: { contains: term } }, { email: { contains: term, mode: 'insensitive' as const } }] } : {}),
  };
  const total = await db.user.count({ where });
  const page = pageOf(c.req.query('page'), total);
  const rows = await db.user.findMany({ where, include: adminUserInclude, orderBy: { nicknameKey: 'asc' }, skip: page.skip, take: page.take });
  return respond(c, numberedPage(AdminOrganizer), { items: await toAdminOrganizers(c, rows), page: page.page, pageCount: page.pageCount, total });
});

/** RN-10: limite de campeonatos simultâneos, jogos permitidos (vazio = todos) e selo verificado. */
adminRoles.patch('/admin/users/:id/organizer-limits', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const target = await findTargetUser(db, c.req.param('id'));
  const input = await body(c, OrganizerLimitsInput);
  if (!hasRole(target, 'ORGANIZER')) throw conflict(`${target.nickname} não é organizador.`, 'ROLE_NOT_GRANTED');
  const allowedGameIds = [...new Set(input.allowedGameIds)];
  const games = allowedGameIds.every(isUuid) ? await db.game.findMany({ where: { id: { in: allowedGameIds } }, select: { id: true, name: true } }) : [];
  if (games.length !== allowedGameIds.length) throw badRequest('Jogo não encontrado.', 'VALIDATION', { allowedGameIds: 'Escolha jogos do catálogo.' });
  const current = target.organizerLimits ?? { ...DEFAULT_LIMITS, verified: false };
  const knownNames = new Map((await db.game.findMany({ where: { id: { in: [...current.allowedGameIds, ...allowedGameIds].filter(isUuid) } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const gameNames = (ids: string[]) => (ids.length === 0 ? 'todos' : ids.map((id) => knownNames.get(id) ?? id));
  const before = { simultaneos: current.maxActiveTournaments, jogos: gameNames(current.allowedGameIds), verificado: current.verified };
  const after = { simultaneos: input.maxActiveTournaments, jogos: gameNames(allowedGameIds), verificado: input.verified };
  if (JSON.stringify(before) === JSON.stringify(after)) markUnchanged(c);
  await withAudit(db, await auditContext(c), async (tx) => {
    const data = { maxActiveTournaments: input.maxActiveTournaments, allowedGameIds, verified: input.verified };
    await tx.organizerLimits.upsert({ where: { userId: target.id }, create: { userId: target.id, ...data }, update: data });
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      await audited(tx, { action: 'ORGANIZER_LIMITS_CHANGED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before, after });
    }
  });
  const fresh = await findTargetUser(db, target.id);
  const [view] = await toAdminOrganizers(c, [fresh]);
  return respond(c, AdminOrganizer, view as AdminOrganizer);
});

// ── Fila de pedidos de organizador (US-ADM-03) ───────────────────────
type RequestRow = { id: string; userId: string; justification: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewReason: string | null; createdAt: Date; user: { nickname: string; avatarUrl: string | null; createdAt: Date } };
async function toAdminOrganizerRequests(c: AppContext, rows: RequestRow[]): Promise<AdminOrganizerRequest[]> {
  const db = c.get('deps').db();
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [played, sanctions] = await Promise.all([tournamentsPlayed(db, ids), db.sanction.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } })]);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    nickname: r.user.nickname,
    avatarUrl: r.user.avatarUrl,
    justification: r.justification,
    status: r.status,
    reviewReason: r.reviewReason,
    tournamentsPlayed: played.get(r.userId) ?? 0,
    memberSince: r.user.createdAt.toISOString(),
    sanctions: sanctions.find((s) => s.userId === r.userId)?._count._all ?? 0,
    createdAt: r.createdAt.toISOString(),
  }));
}
const requestInclude = { user: { select: { nickname: true, avatarUrl: true, createdAt: true } } } as const;

adminRoles.get('/admin/organizer-requests', async (c) => {
  await requireAdmin(c);
  const db = c.get('deps').db();
  const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).safeParse(c.req.query('status'));
  const rows = await db.organizerRequest.findMany({ where: status.success ? { status: status.data } : {}, include: requestInclude, orderBy: { createdAt: 'desc' }, take: 500 });
  // Pendentes: os mais antigos primeiro (fila). Analisados: os mais recentes primeiro.
  rows.sort((a, b) => (a.status === 'PENDING' && b.status === 'PENDING' ? a.createdAt.getTime() - b.createdAt.getTime() : Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.getTime() - a.createdAt.getTime()));
  return respond(c, z.array(AdminOrganizerRequest), await toAdminOrganizerRequests(c, rows));
});

adminRoles.patch('/admin/organizer-requests/:id', async (c) => {
  const actor = await requireAdmin(c);
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const id = c.req.param('id');
  const record = isUuid(id) ? await db.organizerRequest.findUnique({ where: { id }, include: { ...requestInclude, user: { select: { ...requestInclude.user.select, status: true } } } }) : null;
  if (!record) throw notFound('Pedido');
  const input = await body(c, ReviewOrganizerRequestInput);
  if (record.status !== 'PENDING') throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
  if (input.action === 'approve' && record.user.status !== 'ACTIVE') throw conflict('A conta precisa estar ativa para virar organizadora.', 'ACCOUNT_NOT_ACTIVE');
  const reason = input.reason?.trim() || null;
  const status = input.action === 'approve' ? 'APPROVED' : 'REJECTED';
  await withAudit(db, await auditContext(c, input.action === 'approve' ? (reason ?? 'Pedido de organizador aprovado') : reason), async (tx) => {
    const { count } = await tx.organizerRequest.updateMany({ where: { id: record.id, status: 'PENDING' }, data: { status, reviewReason: reason, reviewedById: actor.id, reviewedAt: now } });
    if (count === 0) throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
    await audited(tx, {
      action: 'ORGANIZER_REQUEST_REVIEWED',
      entityType: 'OrganizerRequest',
      entityId: record.id,
      entityLabel: `Pedido de ${record.user.nickname}`,
      before: { situacao: 'PENDING' },
      after: { situacao: status },
      reason,
    });
    if (input.action === 'approve') {
      await grantRole(tx, record.userId, 'ORGANIZER', actor.id);
      await ensureOrganizerLimits(tx, record.userId);
    }
  });
  const after = new AfterCommit();
  if (input.action === 'approve') {
    after.notify([record.userId], {
      type: 'ORGANIZER_REQUEST_RESULT',
      title: messages.roles.organizerRequestApproved.title,
      body: messages.roles.organizerRequestApproved.body(reason),
      link: '/organizador',
    });
  } else {
    after.notify([record.userId], { type: 'ORGANIZER_REQUEST_RESULT', title: messages.roles.organizerRequestRejected.title, body: messages.roles.organizerRequestRejected.body(reason), link: '/minha-conta' });
  }
  await after.flush(c);
  const saved = await db.organizerRequest.findUniqueOrThrow({ where: { id: record.id }, include: requestInclude });
  const [view] = await toAdminOrganizerRequests(c, [saved]);
  return respond(c, AdminOrganizerRequest, view as AdminOrganizerRequest);
});
