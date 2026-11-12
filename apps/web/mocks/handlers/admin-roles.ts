/**
 * Módulo `admin-roles` da API simulada (ADM-02 e ADM-03): administradores, organizadores,
 * convites de papel (PRD §7.3, US-ADM-02) e fila de pedidos de organizador (US-ADM-03).
 *
 * Regras:
 * - RN-11: ninguém remove o Super Admin; Admin remove Admin mais novo no papel; para remover um mais
 *   antigo, o pedido fica pendente até o Super Admin aprovar (regra desligável nas configurações);
 * - RN-09: ao revogar um organizador, os campeonatos em curso passam ao co-organizador mais antigo
 *   ou são pausados e vão para a fila "Sem responsável";
 * - RN-10: organizador novo começa com 3 campeonatos simultâneos e todos os jogos.
 * - Toda mudança de papel é auditada (PRD §6).
 */
import { http, type HttpHandler } from 'msw';
import {
  ACTIVE_TOURNAMENT_STATUSES,
  CreateRoleInviteInput,
  OrganizerLimitsInput,
  ReviewOrganizerRequestInput,
  RoleChangeInput,
  RoleRevokeInput,
  type AdminMember,
  type AdminOrganizer,
  type AdminOrganizerRequest,
  type AdminRemovalRequest,
  type RoleInvite,
  type RoleRevokeResult,
} from '@nova/schemas';
import { audit, auditLogs } from '../audit';
import { collection, db, nowIso, save, uid, type DbOrganizerRequest, type DbRoleInvite, type DbUser } from '../db';
import { badRequest, body, conflict, forbidden, handle, hasRole, isAdmin, json, notFound, paginateNumbered, param, query, url } from '../http';
import { notify } from '../notify';
import { findUser } from '../views';
import { adminOnly, siteSettings, superAdminOnly } from './admin-settings';
import { releaseTournamentsOf } from './admin-tournaments';
import { expireSuspensions, findTargetUser, sanctions, toAdminUser, toAdminUserDetail } from './admin-users';

export const moduleName = 'admin-roles';

const HOUR = 3600_000;
const VALIDITY_MS: Record<CreateRoleInviteInput['validity'], number> = { '1h': HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR };
const DEFAULT_LIMITS = { maxActiveTournaments: 3, allowedGameIds: [] as string[] };
type GrantRole = 'ADMIN' | 'ORGANIZER';
const ROLE_NAME: Record<GrantRole, string> = { ADMIN: 'administrador', ORGANIZER: 'organizador' };

// ── Desde quando cada pessoa tem o papel (base da RN-11) ─────────────
interface DbRoleGrant {
  userId: string;
  role: GrantRole;
  grantedAt: string;
  grantedById: string | null;
}

/** Na primeira leitura, quem já tem papel no banco entra com a data de criação da conta. */
const roleGrants = () =>
  collection<DbRoleGrant>('roleGrants', () =>
    db().users.flatMap((u) => (['ADMIN', 'ORGANIZER'] as const).filter((role) => u.roles.includes(role)).map((role) => ({ userId: u.id, role, grantedAt: u.createdAt, grantedById: null }))),
  );

// No navegador a coleção nasce junto com a página, antes de qualquer convite ser aceito.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') setTimeout(() => roleGrants(), 0);

function recordGrant(user: DbUser, role: GrantRole, by: DbUser | null): void {
  const list = roleGrants();
  const existing = list.find((g) => g.userId === user.id && g.role === role);
  if (existing) {
    existing.grantedAt = nowIso();
    existing.grantedById = by?.id ?? null;
  } else list.push({ userId: user.id, role, grantedAt: nowIso(), grantedById: by?.id ?? null });
  save();
}

function dropGrant(userId: string, role: GrantRole): void {
  const list = roleGrants();
  const index = list.findIndex((g) => g.userId === userId && g.role === role);
  if (index >= 0) list.splice(index, 1);
}

function grantedAt(user: DbUser, role: GrantRole): string {
  return roleGrants().find((g) => g.userId === user.id && g.role === role)?.grantedAt ?? user.createdAt;
}

/**
 * O aceite do convite acontece em outro módulo (`users`), que concede o papel sem registrar desde quando.
 * Aqui, quem aparece com o papel e sem registro ganha a data de agora e a entrada de auditoria do aceite
 * (US-ADM-02: "criar e aceitar o convite geram registros na auditoria"). É idempotente.
 */
export function reconcileRoleGrants(): void {
  const list = roleGrants();
  for (const user of db().users) {
    for (const role of ['ADMIN', 'ORGANIZER'] as const) {
      if (!user.roles.includes(role) || list.some((g) => g.userId === user.id && g.role === role)) continue;
      list.push({ userId: user.id, role, grantedAt: nowIso(), grantedById: null });
      if (role === 'ORGANIZER' && !user.organizerLimits) user.organizerLimits = { ...DEFAULT_LIMITS };
      save();
      const alreadyLogged = auditLogs().some((l) => l.entityId === user.id && (l.action === 'INVITE_ACCEPTED' || l.action === 'ROLE_GRANTED') && l.after?.papel === role);
      if (!alreadyLogged) {
        audit(user, { action: 'INVITE_ACCEPTED', entityType: 'User', entityId: user.id, entityLabel: user.nickname, before: { papel: null }, after: { papel: role }, reason: 'Convite de papel aceito' });
      }
    }
  }
}

// ── Convites ─────────────────────────────────────────────────────────
function inviteState(invite: DbRoleInvite): RoleInvite['state'] {
  if (invite.revokedAt) return 'REVOKED';
  if (new Date(invite.expiresAt).getTime() <= Date.now()) return 'EXPIRED';
  if (invite.uses >= invite.maxUses) return 'EXHAUSTED';
  return 'VALID';
}

/** O link completo só sai na resposta da criação (a API real guarda apenas o hash do token). */
function toRoleInvite(invite: DbRoleInvite, link: string | null = null): RoleInvite {
  return {
    id: invite.id,
    role: invite.role,
    email: invite.email,
    link,
    maxUses: invite.maxUses,
    uses: invite.uses,
    state: inviteState(invite),
    createdByNickname: findUser(invite.createdById)?.nickname ?? 'Nova Arena',
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
  };
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Administradores ──────────────────────────────────────────────────
function toAdminMember(u: DbUser): AdminMember {
  return { ...toAdminUser(u), adminSince: grantedAt(u, 'ADMIN'), isSuperAdmin: hasRole(u, 'SUPER_ADMIN') };
}

interface DbAdminRemovalRequest {
  id: string;
  targetUserId: string;
  requestedById: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  reviewedAt: string | null;
  reviewedById: string | null;
}
const removalRequests = () => collection<DbAdminRemovalRequest>('adminRemovalRequests');

function toRemovalRequest(r: DbAdminRemovalRequest): AdminRemovalRequest {
  return {
    id: r.id,
    targetUserId: r.targetUserId,
    targetNickname: findUser(r.targetUserId)?.nickname ?? 'Conta removida',
    requestedById: r.requestedById,
    requestedByNickname: findUser(r.requestedById)?.nickname ?? 'Conta removida',
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewedByNickname: findUser(r.reviewedById)?.nickname ?? null,
  };
}

function removeAdminRole(actor: DbUser, target: DbUser, reason: string | null): void {
  const before = [...target.roles];
  target.roles = target.roles.filter((r) => r !== 'ADMIN');
  dropGrant(target.id, 'ADMIN');
  save();
  audit(actor, { action: 'ROLE_REVOKED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { papeis: before }, after: { papeis: target.roles, papelRemovido: 'ADMIN' }, reason });
  notify([target.id], 'SANCTION', 'Você não é mais administrador', reason ? `Seu acesso à área de administração foi removido. Motivo: ${reason}` : 'Seu acesso à área de administração foi removido.', null);
}

// ── Organizadores ────────────────────────────────────────────────────
function toAdminOrganizer(u: DbUser): AdminOrganizer {
  const owned = db().tournaments.filter((t) => t.ownerId === u.id);
  return {
    ...toAdminUser(u),
    organizerLimits: u.organizerLimits ?? { ...DEFAULT_LIMITS },
    activeTournaments: owned.filter((t) => ACTIVE_TOURNAMENT_STATUSES.includes(t.status)).length,
    totalTournaments: owned.length,
  };
}

function grantOrganizer(actor: DbUser, target: DbUser, reason: string | null): void {
  const before = [...target.roles];
  target.roles = [...target.roles, 'ORGANIZER'];
  if (!target.organizerLimits) target.organizerLimits = { ...DEFAULT_LIMITS };
  recordGrant(target, 'ORGANIZER', actor);
  save();
  audit(actor, { action: 'ROLE_GRANTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { papeis: before }, after: { papeis: target.roles, papel: 'ORGANIZER', limite: target.organizerLimits.maxActiveTournaments }, reason });
}

function toAdminOrganizerRequest(r: DbOrganizerRequest): AdminOrganizerRequest {
  const d = db();
  const user = findUser(r.userId);
  const played = new Set(d.registrations.filter((x) => (x.userId === r.userId || x.members.some((m) => m.userId === r.userId)) && x.status !== 'REJECTED' && x.status !== 'CANCELLED').map((x) => x.tournamentId));
  return {
    id: r.id,
    userId: r.userId,
    nickname: user?.nickname ?? 'Conta removida',
    avatarUrl: user?.avatarUrl ?? null,
    justification: r.justification,
    status: r.status,
    reviewReason: r.reviewReason,
    tournamentsPlayed: played.size,
    memberSince: user?.createdAt ?? r.createdAt,
    sanctions: sanctions().filter((s) => s.userId === r.userId).length,
    createdAt: r.createdAt,
  };
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

async function optionalReason(request: Request): Promise<string | null> {
  try {
    const parsed = RoleRevokeInput.safeParse(await request.json());
    return parsed.success ? (parsed.data.reason?.trim() || null) : null;
  } catch {
    return null;
  }
}

export const handlers: HttpHandler[] = [
  // ── Administradores ────────────────────────────────────────────────
  http.get(
    url('/admin/admins'),
    handle(() => {
      adminOnly();
      expireSuspensions();
      reconcileRoleGrants();
      const admins = db()
        .users.filter((u) => isAdmin(u) && u.status !== 'MERGED' && u.status !== 'DELETED')
        .map(toAdminMember)
        .sort((a, b) => Number(b.isSuperAdmin) - Number(a.isSuperAdmin) || a.adminSince.localeCompare(b.adminSince));
      return json(admins);
    }),
  ),

  // ── Convites (PRD §7.3) ────────────────────────────────────────────
  http.get(
    url('/admin/invites'),
    handle(() => {
      adminOnly();
      reconcileRoleGrants();
      return json([...db().roleInvites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => toRoleInvite(i)));
    }),
  ),

  http.post(
    url('/admin/invites'),
    handle(async ({ request }) => {
      const actor = adminOnly();
      const input = await body(request, CreateRoleInviteInput);
      roleGrants();
      const now = Date.now();
      const invite: DbRoleInvite = {
        id: uid('ri'),
        token: newToken(),
        role: input.role,
        email: input.email?.trim().toLowerCase() || null,
        maxUses: input.email ? 1 : input.maxUses,
        uses: 0,
        expiresAt: new Date(now + VALIDITY_MS[input.validity]).toISOString(),
        revokedAt: null,
        createdById: actor.id,
        createdAt: new Date(now).toISOString(),
      };
      db().roleInvites.push(invite);
      save();
      audit(actor, {
        action: 'INVITE_CREATED',
        entityType: 'RoleInvite',
        entityId: invite.id,
        entityLabel: `Convite de ${ROLE_NAME[invite.role]}`,
        // O token nunca entra na auditoria.
        after: { papel: invite.role, validade: input.validity, usos: invite.maxUses, ...(invite.email ? { email: invite.email } : {}) },
      });
      const link = `${new URL(request.url).origin}/convite/${invite.token}`;
      return json(toRoleInvite(invite, link), 201);
    }),
  ),

  http.delete(
    url('/admin/invites/:id'),
    handle(({ params }) => {
      const actor = adminOnly();
      const invite = db().roleInvites.find((i) => i.id === param(params, 'id'));
      if (!invite) throw notFound('Convite');
      const state = inviteState(invite);
      if (state === 'REVOKED') throw conflict('Este convite já foi revogado.', 'INVITE_REVOKED');
      invite.revokedAt = nowIso();
      save();
      audit(actor, { action: 'INVITE_REVOKED', entityType: 'RoleInvite', entityId: invite.id, entityLabel: `Convite de ${ROLE_NAME[invite.role]}`, before: { estado: state, usos: `${invite.uses}/${invite.maxUses}` }, after: { estado: 'REVOKED' } });
      return json(toRoleInvite(invite));
    }),
  ),

  // ── Conceder e revogar papéis ──────────────────────────────────────
  http.post(
    url('/admin/users/:id/roles'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      const input = await body(request, RoleChangeInput);
      reconcileRoleGrants();
      if (target.status !== 'ACTIVE') throw conflict('Só uma conta ativa pode receber um papel.', 'ACCOUNT_NOT_ACTIVE');
      if (target.roles.includes(input.role)) throw conflict(`${target.nickname} já é ${ROLE_NAME[input.role]}.`, 'ROLE_ALREADY_GRANTED');
      if (!target.emailVerified) throw conflict('A conta precisa ter o e-mail confirmado para receber um papel.', 'EMAIL_NOT_VERIFIED');
      const reason = input.reason?.trim() || null;
      if (input.role === 'ORGANIZER') {
        grantOrganizer(actor, target, reason);
        notify([target.id], 'ORGANIZER_REQUEST_RESULT', 'Você agora é organizador', 'A administração liberou a área de organização para você. Já dá para criar o seu primeiro campeonato.', '/organizador');
      } else {
        const before = [...target.roles];
        target.roles = [...target.roles, 'ADMIN'];
        recordGrant(target, 'ADMIN', actor);
        save();
        audit(actor, { action: 'ROLE_GRANTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { papeis: before }, after: { papeis: target.roles, papel: 'ADMIN' }, reason });
        notify([target.id], 'SANCTION', 'Você agora é administrador', 'Para entrar na área de administração, ative a verificação em duas etapas.', '/minha-conta/seguranca');
      }
      return json(toAdminUserDetail(target));
    }),
  ),

  http.delete(
    url('/admin/users/:id/roles/:role'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      const role = param(params, 'role');
      const reason = await optionalReason(request);
      reconcileRoleGrants();

      if (role === 'ORGANIZER') {
        if (!target.roles.includes('ORGANIZER')) throw conflict(`${target.nickname} não é organizador.`, 'ROLE_NOT_GRANTED');
        const before = [...target.roles];
        target.roles = target.roles.filter((r) => r !== 'ORGANIZER');
        target.verifiedOrganizer = false;
        target.organizerLimits = null;
        dropGrant(target.id, 'ORGANIZER');
        save();
        audit(actor, { action: 'ROLE_REVOKED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { papeis: before }, after: { papeis: target.roles, papelRemovido: 'ORGANIZER' }, reason });
        notify([target.id], 'ORGANIZER_REQUEST_RESULT', 'Você não é mais organizador', reason ? `A administração removeu o seu acesso à área de organização. Motivo: ${reason}` : 'A administração removeu o seu acesso à área de organização.', null);
        const affectedTournaments = releaseTournamentsOf(target, actor, `Organizador ${target.nickname} revogado`);
        const result: RoleRevokeResult = { outcome: 'REVOKED', requestId: null, affectedTournaments };
        return json(result);
      }

      if (role !== 'ADMIN') throw notFound('Papel');
      // RN-11.
      if (hasRole(target, 'SUPER_ADMIN')) throw forbidden('Ninguém remove o Super Admin. Ele só transfere o papel.');
      if (!target.roles.includes('ADMIN')) throw conflict(`${target.nickname} não é administrador.`, 'ROLE_NOT_GRANTED');
      if (target.id === actor.id) throw forbidden('Você não pode remover o seu próprio papel de administrador. Peça a outro administrador.');

      const actorIsSuper = hasRole(actor, 'SUPER_ADMIN');
      const targetIsNewer = grantedAt(target, 'ADMIN') > grantedAt(actor, 'ADMIN');
      if (actorIsSuper || targetIsNewer || !siteSettings().requireApprovalForSeniorAdminRemoval) {
        removeAdminRole(actor, target, reason);
        // Pedidos pendentes sobre a mesma pessoa perdem o sentido.
        for (const r of removalRequests()) {
          if (r.targetUserId === target.id && r.status === 'PENDING') {
            r.status = 'APPROVED';
            r.reviewedAt = nowIso();
            r.reviewedById = actor.id;
          }
        }
        save();
        const result: RoleRevokeResult = { outcome: 'REVOKED', requestId: null, affectedTournaments: [] };
        return json(result);
      }

      // Admin mais antigo: o papel continua até o Super Admin aprovar.
      if (removalRequests().some((r) => r.targetUserId === target.id && r.status === 'PENDING')) {
        throw conflict(`Já existe um pedido de remoção de ${target.nickname} aguardando o Super Admin.`, 'REMOVAL_ALREADY_REQUESTED');
      }
      const record: DbAdminRemovalRequest = { id: uid('arr'), targetUserId: target.id, requestedById: actor.id, reason, status: 'PENDING', createdAt: nowIso(), reviewedAt: null, reviewedById: null };
      removalRequests().push(record);
      save();
      audit(actor, { action: 'ADMIN_REMOVAL_REQUESTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, after: { pedido: record.id, situacao: 'PENDING' }, reason });
      notify(
        db()
          .users.filter((u) => hasRole(u, 'SUPER_ADMIN'))
          .map((u) => u.id),
        'ANNOUNCEMENT',
        'Pedido de remoção de administrador',
        `${actor.nickname} pediu a remoção de ${target.nickname}, que é administrador há mais tempo. A decisão é sua.`,
        '/admin/administradores',
      );
      const result: RoleRevokeResult = { outcome: 'PENDING_APPROVAL', requestId: record.id, affectedTournaments: [] };
      return json(result, 202);
    }),
  ),

  // ── Pedidos de remoção de Admin (RN-11) ────────────────────────────
  http.get(
    url('/admin/admin-removal-requests'),
    handle(() => {
      adminOnly();
      return json([...removalRequests()].sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt)).map(toRemovalRequest));
    }),
  ),

  http.post(
    url('/admin/admin-removal-requests/:id/:decision'),
    handle(({ params }) => {
      const actor = superAdminOnly();
      const decision = param(params, 'decision');
      if (decision !== 'approve' && decision !== 'reject') throw notFound();
      const record = removalRequests().find((r) => r.id === param(params, 'id'));
      if (!record) throw notFound('Pedido');
      if (record.status !== 'PENDING') throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
      const target = findUser(record.targetUserId);
      const requester = findUser(record.requestedById);
      record.status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
      record.reviewedAt = nowIso();
      record.reviewedById = actor.id;
      save();
      audit(actor, {
        action: 'ADMIN_REMOVAL_REVIEWED',
        entityType: 'User',
        entityId: record.targetUserId,
        entityLabel: target?.nickname ?? record.targetUserId,
        before: { pedido: record.id, situacao: 'PENDING' },
        after: { pedido: record.id, situacao: record.status },
        reason: record.reason,
      });
      if (decision === 'approve' && target?.roles.includes('ADMIN') && !hasRole(target, 'SUPER_ADMIN')) {
        removeAdminRole(actor, target, record.reason ? `${record.reason} (pedido de ${requester?.nickname ?? 'outro administrador'})` : `Pedido de ${requester?.nickname ?? 'outro administrador'} aprovado`);
      }
      if (requester) {
        notify(
          [requester.id],
          'ANNOUNCEMENT',
          decision === 'approve' ? 'Pedido de remoção aprovado' : 'Pedido de remoção recusado',
          decision === 'approve' ? `${target?.nickname ?? 'A conta'} não é mais administrador.` : `${target?.nickname ?? 'A conta'} continua como administrador.`,
          '/admin/administradores',
        );
      }
      return json(toRemovalRequest(record));
    }),
  ),

  // ── Organizadores ──────────────────────────────────────────────────
  http.get(
    url('/admin/organizers'),
    handle(({ request }) => {
      adminOnly();
      expireSuspensions();
      reconcileRoleGrants();
      const q = query(request);
      const term = normalize((q.get('q') ?? '').trim());
      const rows = db()
        .users.filter((u) => u.roles.includes('ORGANIZER') && u.status !== 'MERGED' && u.status !== 'DELETED')
        .filter((u) => !term || normalize(u.nickname).includes(term) || u.email.toLowerCase().includes(term))
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR'))
        .map(toAdminOrganizer);
      return json(paginateNumbered(rows, q.get('page')));
    }),
  ),

  /** RN-10: limite de campeonatos simultâneos, jogos permitidos (vazio = todos) e selo verificado. */
  http.patch(
    url('/admin/users/:id/organizer-limits'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      const input = await body(request, OrganizerLimitsInput);
      if (!target.roles.includes('ORGANIZER')) throw conflict(`${target.nickname} não é organizador.`, 'ROLE_NOT_GRANTED');
      const games = db().games;
      const unknown = input.allowedGameIds.filter((id) => !games.some((g) => g.id === id));
      if (unknown.length > 0) throw badRequest('Jogo não encontrado.', 'VALIDATION', { allowedGameIds: 'Escolha jogos do catálogo.' });
      const gameNames = (ids: string[]) => (ids.length === 0 ? 'todos' : ids.map((id) => games.find((g) => g.id === id)?.name ?? id));
      const current = target.organizerLimits ?? { ...DEFAULT_LIMITS };
      const before = { simultaneos: current.maxActiveTournaments, jogos: gameNames(current.allowedGameIds), verificado: target.verifiedOrganizer };
      const allowedGameIds = [...new Set(input.allowedGameIds)];
      target.organizerLimits = { maxActiveTournaments: input.maxActiveTournaments, allowedGameIds };
      target.verifiedOrganizer = input.verified;
      save();
      const after = { simultaneos: input.maxActiveTournaments, jogos: gameNames(allowedGameIds), verificado: input.verified };
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        audit(actor, { action: 'ORGANIZER_LIMITS_CHANGED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before, after });
      }
      return json(toAdminOrganizer(target));
    }),
  ),

  // ── Fila de pedidos de organizador (US-ADM-03) ─────────────────────
  http.get(
    url('/admin/organizer-requests'),
    handle(({ request }) => {
      adminOnly();
      const status = query(request).get('status');
      const rows = db()
        .organizerRequests.filter((r) => !status || r.status === status)
        // Pendentes: os mais antigos primeiro (fila). Analisados: os mais recentes primeiro.
        .sort((a, b) => (a.status === 'PENDING' && b.status === 'PENDING' ? a.createdAt.localeCompare(b.createdAt) : Number(b.status === 'PENDING') - Number(a.status === 'PENDING') || b.createdAt.localeCompare(a.createdAt)))
        .map(toAdminOrganizerRequest);
      return json(rows);
    }),
  ),

  http.patch(
    url('/admin/organizer-requests/:id'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const record = db().organizerRequests.find((r) => r.id === param(params, 'id'));
      if (!record) throw notFound('Pedido');
      const input = await body(request, ReviewOrganizerRequestInput);
      if (record.status !== 'PENDING') throw conflict('Este pedido já foi analisado.', 'ALREADY_REVIEWED');
      const target = findUser(record.userId);
      if (!target) throw notFound('Usuário');
      if (input.action === 'approve' && target.status !== 'ACTIVE') throw conflict('A conta precisa estar ativa para virar organizadora.', 'ACCOUNT_NOT_ACTIVE');
      reconcileRoleGrants();

      const reason = input.reason?.trim() || null;
      record.status = input.action === 'approve' ? 'APPROVED' : 'REJECTED';
      record.reviewReason = reason;
      record.reviewedById = actor.id;
      record.reviewedAt = nowIso();
      save();
      audit(actor, {
        action: 'ORGANIZER_REQUEST_REVIEWED',
        entityType: 'OrganizerRequest',
        entityId: record.id,
        entityLabel: `Pedido de ${target.nickname}`,
        before: { situacao: 'PENDING' },
        after: { situacao: record.status },
        reason,
      });
      if (input.action === 'approve') {
        if (!target.roles.includes('ORGANIZER')) grantOrganizer(actor, target, reason ?? 'Pedido de organizador aprovado');
        notify(
          [target.id],
          'ORGANIZER_REQUEST_RESULT',
          'Pedido de organizador aprovado',
          reason ? `Você já pode criar campeonatos. Recado da administração: ${reason}` : 'Você já pode criar campeonatos na área de organização.',
          '/organizador',
        );
      } else {
        notify([target.id], 'ORGANIZER_REQUEST_RESULT', 'Pedido de organizador recusado', `Motivo: ${reason}. Você pode enviar um novo pedido quando quiser.`, '/minha-conta');
      }
      return json(toAdminOrganizerRequest(record));
    }),
  ),
];
