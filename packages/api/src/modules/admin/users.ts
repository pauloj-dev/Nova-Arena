/**
 * Gestão de usuários do painel Admin (issues #91 e #96, ADM-04, ADM-07). Porta de `apps/web/mocks/handlers/admin-users.ts`.
 *
 * - `GET /admin/users` (busca por apelido ou e-mail, filtro de papel e status, 20 por página) e `GET /admin/users/:id`.
 * - `POST /admin/users/:id/sanctions` e `DELETE /admin/sanctions/:id`: efeito imediato (`sanctions.ts`).
 * - `POST /admin/users/:id/reset-password`: o link vai **só por e-mail** para a pessoa; o Admin nunca o vê (`link` volta
 *   vazio — mostrar o link é atalho do protótipo).
 * - `POST /admin/users/:id/merge`: mescla de contas (RN-13), irreversível. `:id` é a conta que fica.
 *
 * Todas exigem Admin com 2FA (`adminArea`, no app). Só o Super Admin age sobre a conta de outro Admin.
 */
import { audited, Prisma, withAudit, type Tx } from '@nova/db';
import { ACTIVE_REGISTRATION_STATUSES, AdminUser, AdminUserDetail, CreateSanctionInput, MergeUsersInput, MergeUsersResult, numberedPage, PasswordResetLink, Role, RoleRevokeInput, SanctionResult, UserStatus } from '@nova/schemas';
import { Hono } from 'hono';
import { auditContext, requireAdmin } from '../../auth/admin';
import { randomToken, sha256 } from '../../auth/crypto';
import { linkFor } from '../../auth/email-tokens';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { revalidateTournaments } from '../../revalidate';
import { releaseTournamentsOf } from './rn09';
import { applySanction, dropSessions, expireSuspensions, liftSanction } from './sanctions';
import { adminUserInclude, AfterCommit, assertCanModerate, findTargetUser, hasRole, isAdminUser, isUuid, normalize, pageOf, toAdminUserDetail, toAdminUsers, type AdminUserRow } from './shared';

const RESET_TTL_MS = 3600_000;
const LIVE_TOURNAMENT = { notIn: ['FINISHED', 'ARCHIVED', 'CANCELLED'] as ('FINISHED' | 'ARCHIVED' | 'CANCELLED')[] };

export const adminUsers = new Hono<AppEnv>();

async function actorWithName(c: AppContext) {
  const actor = await requireAdmin(c);
  const row = await c.get('deps').db().user.findUniqueOrThrow({ where: { id: actor.id }, select: { nickname: true } });
  return { ...actor, nickname: row.nickname };
}

/** Lê o corpo opcional `{ reason }` (DELETE pode vir sem corpo). */
export async function optionalReason(c: AppContext): Promise<string | null> {
  try {
    const parsed = RoleRevokeInput.safeParse(await c.req.json());
    return parsed.success ? parsed.data.reason?.trim() || null : null;
  } catch {
    return null;
  }
}

adminUsers.get('/admin/users', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  await expireSuspensions(db, now());
  const term = normalize((c.req.query('q') ?? '').trim());
  const role = Role.safeParse(c.req.query('role'));
  const status = UserStatus.safeParse(c.req.query('status'));
  const where: Prisma.UserWhereInput = {
    ...(role.success ? { roles: { some: { role: role.data } } } : {}),
    ...(status.success ? { status: status.data } : {}),
    ...(term ? { OR: [{ nicknameKey: { contains: term } }, { email: { contains: term, mode: 'insensitive' } }] } : {}),
  };
  const total = await db.user.count({ where });
  const page = pageOf(c.req.query('page'), total);
  const rows = await db.user.findMany({ where, include: adminUserInclude, orderBy: [{ nicknameKey: 'asc' }], skip: page.skip, take: page.take });
  return respond(c, numberedPage(AdminUser), { items: await toAdminUsers(db, rows, now()), page: page.page, pageCount: page.pageCount, total });
});

adminUsers.get('/admin/users/:id', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  await expireSuspensions(db, now());
  const target = await findTargetUser(db, c.req.param('id'));
  return respond(c, AdminUserDetail, await toAdminUserDetail(db, target.id, now()));
});

adminUsers.post('/admin/users/:id/sanctions', async (c) => {
  const actor = await actorWithName(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const target = await findTargetUser(db, c.req.param('id'));
  const input = await body(c, CreateSanctionInput);
  await expireSuspensions(db, now());
  const fresh = await findTargetUser(db, target.id);
  const outcome = await applySanction(db, await auditContext(c), actor, fresh, input, now());
  await outcome.after.flush(c);
  if (outcome.affectedTournaments.length > 0) revalidateTournaments(c);
  return respond(c, SanctionResult, { sanction: outcome.sanction, user: await toAdminUserDetail(db, target.id, now()), affectedTournaments: outcome.affectedTournaments }, 201);
});

/** Remove a sanção antes do prazo: a conta volta a ficar ativa (se não houver outra em vigor). */
adminUsers.delete('/admin/sanctions/:id', async (c) => {
  const actor = await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const id = c.req.param('id');
  const record = isUuid(id) ? await db.sanction.findUnique({ where: { id }, select: { id: true, userId: true } }) : null;
  if (!record) throw notFound('Sanção');
  const target = await findTargetUser(db, record.userId);
  const reason = await optionalReason(c);
  const after = await liftSanction(db, await auditContext(c), actor, target, record.id, reason, now());
  await after.flush(c);
  return respond(c, AdminUserDetail, await toAdminUserDetail(db, target.id, now()));
});

/** Gera o link de redefinição e manda por e-mail para a pessoa (uso único, 1 hora). */
adminUsers.post('/admin/users/:id/reset-password', async (c) => {
  const actor = await requireAdmin(c);
  const { db: getDb, now, mailer } = c.get('deps');
  const db = getDb();
  const target = await findTargetUser(db, c.req.param('id'));
  // Redefinir a senha de um Admin daria acesso à conta dele: mesma proteção das sanções.
  assertCanModerate(actor, target, 'redefinir a senha de');
  const token = randomToken();
  await withAudit(db, await auditContext(c), async (tx) => {
    await tx.emailToken.create({ data: { userId: target.id, type: 'RESET', tokenHash: sha256(token), expiresAt: new Date(now().getTime() + RESET_TTL_MS) } });
    await audited(tx, { action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: target.id, entityLabel: target.nickname, after: { linkEnviadoPara: target.email } });
  });
  const link = linkFor(c, '/redefinir-senha', token);
  try {
    await mailer(c.get('env'), c.get('log')).send(target.email, { template: 'RESET_PASSWORD', data: { nickname: target.nickname, link } });
  } catch (error) {
    c.get('log').error('não foi possível enviar o e-mail de redefinição', { userId: target.id, error: error instanceof Error ? error.message : String(error) });
  }
  await new AfterCommit()
    .notify([target.id], { type: 'SANCTION', title: 'Redefinição de senha', body: 'A administração gerou um link para você criar uma senha nova. Se não foi você quem pediu, fale com o suporte.', link: null })
    .flush(c);
  // O link só vai por e-mail: o Admin nunca o vê.
  return respond(c, PasswordResetLink, { link: '' });
});

// ── Mescla de contas (RN-13) ─────────────────────────────────────────
/** Campeonatos em andamento (não finalizados) com inscrição ativa da pessoa, sozinha ou no elenco de um squad. */
async function liveTournamentIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx.registration.findMany({
    where: { status: { in: ACTIVE_REGISTRATION_STATUSES }, tournament: { status: LIVE_TOURNAMENT }, OR: [{ userId }, { members: { some: { userId } } }] },
    select: { tournamentId: true },
  });
  return new Set(rows.map((r) => r.tournamentId));
}

async function moveData(tx: Tx, source: AdminUserRow, target: AdminUserRow) {
  const moved = { registrations: 0, teams: 0, gameAccounts: 0 };

  // Inscrições solo e participações em inscrições de squad. Uma linha por campeonato: se o destino já tem a dele, a da origem fica.
  const touched = new Set<string>();
  for (const r of await tx.registration.findMany({ where: { userId: source.id }, select: { id: true, tournamentId: true } })) {
    const clash = await tx.registration.findUnique({ where: { tournamentId_userId: { tournamentId: r.tournamentId, userId: target.id } }, select: { id: true } });
    if (clash) continue;
    await tx.registration.update({ where: { id: r.id }, data: { userId: target.id } });
    touched.add(r.id);
  }
  for (const m of await tx.registrationMember.findMany({ where: { userId: source.id } })) {
    const existing = await tx.registrationMember.findUnique({ where: { tournamentId_userId: { tournamentId: m.tournamentId, userId: target.id } } });
    if (existing && existing.registrationId === m.registrationId) {
      // O destino já estava no elenco dessa inscrição: sobra uma entrada só (capitania fica com quem tinha).
      await tx.registrationMember.delete({ where: { id: m.id } });
      if (m.isCaptain && !existing.isCaptain) await tx.registrationMember.update({ where: { id: existing.id }, data: { isCaptain: true } });
      touched.add(m.registrationId);
    } else if (!existing) {
      await tx.registrationMember.update({ where: { id: m.id }, data: { userId: target.id } });
      touched.add(m.registrationId);
    }
  }
  moved.registrations = touched.size;

  // Squads: participação e capitania.
  for (const membership of await tx.teamMember.findMany({ where: { userId: source.id } })) {
    moved.teams += 1;
    const already = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: membership.teamId, userId: target.id } } });
    if (already) {
      await tx.teamMember.delete({ where: { teamId_userId: { teamId: membership.teamId, userId: source.id } } });
      if (membership.role === 'CAPTAIN') await tx.teamMember.update({ where: { teamId_userId: { teamId: membership.teamId, userId: target.id } }, data: { role: 'CAPTAIN' } });
    } else {
      await tx.teamMember.update({ where: { teamId_userId: { teamId: membership.teamId, userId: source.id } }, data: { userId: target.id } });
    }
  }
  await tx.team.updateMany({ where: { captainId: source.id }, data: { captainId: target.id } });
  await tx.teamInvite.updateMany({ where: { invitedUserId: source.id }, data: { invitedUserId: target.id } });
  await tx.teamInvite.updateMany({ where: { createdById: source.id }, data: { createdById: target.id } });

  // IDs de jogo: em conflito, vale o do destino.
  const targetGames = new Set((await tx.gameAccount.findMany({ where: { userId: target.id }, select: { gameId: true } })).map((a) => a.gameId));
  for (const account of await tx.gameAccount.findMany({ where: { userId: source.id } })) {
    if (targetGames.has(account.gameId)) {
      await tx.gameAccount.delete({ where: { id: account.id } });
      continue;
    }
    await tx.gameAccount.update({ where: { id: account.id }, data: { userId: target.id } });
    moved.gameAccounts += 1;
  }

  // Seguidos (sem repetir), denúncias, sanções, check-ins e kills por jogador.
  for (const f of await tx.follow.findMany({ where: { userId: source.id } })) {
    const key = { userId_targetType_targetId: { userId: target.id, targetType: f.targetType, targetId: f.targetId } };
    if (!(await tx.follow.findUnique({ where: key }))) await tx.follow.create({ data: { userId: target.id, targetType: f.targetType, targetId: f.targetId, createdAt: f.createdAt } });
    await tx.follow.delete({ where: { userId_targetType_targetId: { userId: source.id, targetType: f.targetType, targetId: f.targetId } } });
  }
  await tx.report.updateMany({ where: { reporterId: source.id }, data: { reporterId: target.id } });
  await tx.report.updateMany({ where: { targetOwnerUserId: source.id }, data: { targetOwnerUserId: target.id } });
  await tx.report.updateMany({ where: { targetType: 'USER', targetId: source.id }, data: { targetId: target.id, targetLabel: target.nickname, targetLink: `/u/${encodeURIComponent(target.nickname)}` } });
  await tx.sanction.updateMany({ where: { userId: source.id }, data: { userId: target.id } });
  for (const ci of await tx.checkIn.findMany({ where: { userId: source.id } })) {
    const dup = await tx.checkIn.findUnique({ where: { matchId_registrationId_userId: { matchId: ci.matchId, registrationId: ci.registrationId, userId: target.id } } });
    if (!dup) await tx.checkIn.create({ data: { matchId: ci.matchId, registrationId: ci.registrationId, userId: target.id, at: ci.at } });
    await tx.checkIn.delete({ where: { matchId_registrationId_userId: { matchId: ci.matchId, registrationId: ci.registrationId, userId: source.id } } });
  }
  for (const stat of await tx.playerStat.findMany({ where: { userId: source.id } })) {
    const dup = await tx.playerStat.findUnique({ where: { matchParticipantId_userId: { matchParticipantId: stat.matchParticipantId, userId: target.id } } });
    if (!dup) {
      await tx.playerStat.update({ where: { id: stat.id }, data: { userId: target.id } });
      continue;
    }
    // Os dois jogaram a mesma partida pelo mesmo inscrito: soma os números (kills por jogador).
    const a = (dup.stats ?? {}) as Record<string, unknown>;
    const b = (stat.stats ?? {}) as Record<string, unknown>;
    const sum: Record<string, unknown> = { ...b, ...a };
    for (const [k, v] of Object.entries(b)) if (typeof v === 'number' && typeof a[k] === 'number') sum[k] = (a[k] as number) + v;
    await tx.playerStat.update({ where: { id: dup.id }, data: { stats: sum as Prisma.InputJsonObject } });
    await tx.playerStat.delete({ where: { id: stat.id } });
  }
  await tx.achievement.updateMany({ where: { userId: source.id }, data: { userId: target.id } });
  return moved;
}

/** `:id` é a conta de destino (a que fica); `sourceUserId` é a duplicada, que vira `MERGED`. Irreversível. */
adminUsers.post('/admin/users/:id/merge', async (c) => {
  const actor = await requireAdmin(c);
  const { db: getDb, now } = c.get('deps');
  const db = getDb();
  const target = await findTargetUser(db, c.req.param('id'));
  const input = await body(c, MergeUsersInput);
  const source = isUuid(input.sourceUserId) ? await db.user.findUnique({ where: { id: input.sourceUserId }, include: adminUserInclude }) : null;
  if (!source) throw badRequest('Conta de origem não encontrada.', 'VALIDATION', { sourceUserId: 'Conta não encontrada.' });
  if (source.id === target.id) throw badRequest('Escolha duas contas diferentes.', 'SAME_ACCOUNT', { sourceUserId: 'Escolha outra conta.' });
  for (const u of [source, target]) {
    if (u.status === 'MERGED' || u.status === 'DELETED') throw conflict(`A conta ${u.nickname} não existe mais (foi mesclada ou excluída).`, 'ACCOUNT_GONE');
  }
  if (source.id === actor.id) throw forbidden('Você não pode mesclar a sua própria conta em outra.');
  if (isAdminUser(source)) throw forbidden('Conta de administrador não pode ser a origem da mescla. Revogue o papel antes.');
  if (hasRole(target, 'SUPER_ADMIN') && !actor.isSuperAdmin) throw forbidden('Só o Super Admin pode mesclar outra conta na dele.');

  const reason = input.reason.trim();
  const after = new AfterCommit();
  const wasOrganizer = hasRole(source, 'ORGANIZER');
  const sourceRoles = source.roles.map((r) => r.role);
  const result = await withAudit(db, { ...(await auditContext(c)), reason }, async (tx) => {
    // Trava as duas contas (ordem fixa, sem impasse) e confere o conflito dentro da transação.
    await tx.$queryRaw`SELECT id FROM users WHERE id IN (${Prisma.join([source.id, target.id].sort())}) ORDER BY id FOR UPDATE`;
    const [mine, theirs] = await Promise.all([liveTournamentIds(tx, target.id), liveTournamentIds(tx, source.id)]);
    const clash = [...theirs].filter((id) => mine.has(id));
    if (clash.length > 0) {
      const names = (await tx.tournament.findMany({ where: { id: { in: clash } }, select: { name: true }, orderBy: { name: 'asc' } })).map((t) => t.name);
      throw conflict(`As duas contas estão inscritas no mesmo campeonato ativo (${names.join(', ')}). Resolva o conflito antes de mesclar.`, 'MERGE_CONFLICT');
    }
    const moved = await moveData(tx, source, target);
    // A origem fica sem login e sem papéis (os papéis não são transferidos). O apelido continua reservado.
    for (const r of sourceRoles) if (r !== 'PARTICIPANT') await tx.userRole.delete({ where: { userId_role: { userId: source.id, role: r } } });
    await tx.organizerLimits.deleteMany({ where: { userId: source.id } });
    await tx.user.update({ where: { id: source.id }, data: { status: 'MERGED', mergedIntoId: target.id } });
    await dropSessions(tx, source.id, now());
    await audited(tx, {
      action: 'USERS_MERGED',
      entityType: 'User',
      entityId: target.id,
      entityLabel: `${source.nickname} → ${target.nickname}`,
      before: { origem: source.nickname, origemId: source.id, origemStatus: source.status, origemPapeis: sourceRoles },
      after: { destino: target.nickname, origemStatus: 'MERGED', inscricoesTransferidas: moved.registrations, squadsTransferidos: moved.teams, idsDeJogoTransferidos: moved.gameAccounts },
      reason,
    });
    const affected = wasOrganizer ? await releaseTournamentsOf(tx, source, `Conta de ${source.nickname} mesclada em ${target.nickname}`, after) : [];
    return { moved, affected };
  });
  after.publish(`user:${source.id}`, { type: 'session.revoked', reason: 'MERGED' });
  after.notify([target.id], { type: 'SANCTION', title: 'Contas mescladas', body: `A conta ${source.nickname} foi mesclada na sua. Inscrições, squads e IDs de jogo agora estão aqui.`, link: '/minha-conta' });
  await after.flush(c);
  if (result.affected.length > 0 || result.moved.registrations > 0) revalidateTournaments(c);
  return respond(c, MergeUsersResult, { target: await toAdminUserDetail(db, target.id, now()), moved: result.moved });
});
