/**
 * Módulo `admin-users` da API simulada (ADM-04): busca de usuários, perfil completo, sanções
 * (advertência, suspensão com prazo, banimento), redefinição de senha e mescla de contas (RN-13).
 *
 * Regras:
 * - sanção tem efeito imediato: muda o status, derruba a sessão (`session.revoked`) e avisa o usuário;
 * - suspensão expira sozinha no prazo (conferido a cada leitura e, no navegador, por um relógio);
 * - ninguém sanciona o Super Admin nem a si mesmo; só o Super Admin sanciona outro Admin;
 * - organizador suspenso ou banido: RN-09 nos campeonatos dele.
 */
import { http, type HttpHandler } from 'msw';
import {
  ACTIVE_REGISTRATION_STATUSES,
  CreateSanctionInput,
  MergeUsersInput,
  Role,
  RoleRevokeInput,
  UserStatus,
  type AdminUser,
  type AdminUserDetail,
  type MergeUsersResult,
  type OrphanOutcome,
  type Sanction,
  type SanctionResult,
} from '@nova/schemas';
import { audit } from '../audit';
import { publish } from '../bus';
import { matchMetas } from '../competition';
import { collection, db, nowIso, save, uid, type DbUser } from '../db';
import { badRequest, body, conflict, forbidden, handle, hasRole, isAdmin, json, notFound, paginateNumbered, param, query, url } from '../http';
import { notify } from '../notify';
import { findUser } from '../views';
import { adminOnly } from './admin-settings';
import { releaseTournamentsOf } from './admin-tournaments';
import { reports } from './reports';

export const moduleName = 'admin-users';

const DAY = 24 * 3600_000;

// ── Sanções ──────────────────────────────────────────────────────────
export interface DbSanction {
  id: string;
  userId: string;
  type: Sanction['type'];
  reason: string;
  issuedById: string;
  startsAt: string;
  endsAt: string | null;
  liftedAt: string | null;
  reportId: string | null;
}
export const sanctions = () => collection<DbSanction>('sanctions');

export function toSanction(s: DbSanction): Sanction {
  return { id: s.id, userId: s.userId, type: s.type, reason: s.reason, issuedByNickname: findUser(s.issuedById)?.nickname ?? 'Administração', startsAt: s.startsAt, endsAt: s.endsAt, liftedAt: s.liftedAt, reportId: s.reportId };
}

function isInForce(s: DbSanction, now: number): boolean {
  if (s.liftedAt || s.type === 'WARNING') return false;
  return s.endsAt === null || new Date(s.endsAt).getTime() > now;
}

/** Suspensão em vigor do usuário (a que termina por último), se houver. */
export function activeSuspension(userId: string, now = Date.now()): DbSanction | undefined {
  return sanctions()
    .filter((s) => s.userId === userId && s.type === 'SUSPENSION' && isInForce(s, now))
    .sort((a, b) => (b.endsAt ?? '').localeCompare(a.endsAt ?? ''))[0];
}

/** Suspensão vencida devolve a conta para "ativa". Chamado a cada leitura dos módulos do Admin. */
export function expireSuspensions(now = Date.now()): void {
  let changed = false;
  for (const user of db().users) {
    if (user.status === 'SUSPENDED' && !activeSuspension(user.id, now)) {
      user.status = 'ACTIVE';
      changed = true;
    }
  }
  if (changed) save();
}

// No navegador, o relógio garante que a suspensão vença mesmo sem ninguém abrir o painel
// (o login confere `user.status`, que é de outro módulo).
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
  setTimeout(() => expireSuspensions(), 0);
  setInterval(() => expireSuspensions(), 30_000);
}

// ── Conversões ───────────────────────────────────────────────────────
export function toAdminUser(u: DbUser): AdminUser {
  return {
    id: u.id,
    nickname: u.nickname,
    email: u.email,
    avatarUrl: u.avatarUrl,
    roles: u.roles,
    status: u.status,
    emailVerified: u.emailVerified,
    twoFactorEnabled: u.twoFactorEnabled,
    verifiedOrganizer: u.verifiedOrganizer,
    createdAt: u.createdAt,
    lastSeenAt: u.lastSeenAt,
    suspendedUntil: u.status === 'SUSPENDED' ? (activeSuspension(u.id)?.endsAt ?? null) : null,
  };
}

function registrationsOf(userId: string) {
  return db().registrations.filter((r) => r.userId === userId || r.members.some((m) => m.userId === userId));
}

export function reportsAgainst(userId: string): number {
  return reports().filter((r) => r.targetOwnerUserId === userId || (r.targetType === 'USER' && r.targetId === userId)).length;
}

export function toAdminUserDetail(u: DbUser): AdminUserDetail {
  const d = db();
  const played = new Set(
    registrationsOf(u.id)
      .filter((r) => r.status !== 'REJECTED' && r.status !== 'CANCELLED')
      .map((r) => r.tournamentId),
  );
  return {
    ...toAdminUser(u),
    bio: u.bio,
    state: u.state,
    gameAccounts: u.gameAccounts.map((a) => ({ gameName: d.games.find((g) => g.id === a.gameId)?.name ?? 'Jogo', fields: a.fields })),
    sanctions: sanctions()
      .filter((s) => s.userId === u.id)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
      .map(toSanction),
    tournamentsPlayed: played.size,
    tournamentsOrganized: d.tournaments.filter((t) => t.ownerId === u.id).length,
    teams: d.teams.filter((t) => t.members.some((m) => m.userId === u.id)).map((t) => ({ id: t.id, name: t.name, tag: t.tag, isCaptain: t.captainId === u.id })),
    reportsAgainst: reportsAgainst(u.id),
    organizerLimits: u.roles.includes('ORGANIZER') ? (u.organizerLimits ?? { maxActiveTournaments: 3, allowedGameIds: [] }) : null,
  };
}

export function findTargetUser(id: string): DbUser {
  const user = db().users.find((u) => u.id === id);
  if (!user) throw notFound('Usuário');
  return user;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Quem pode agir sobre quem: nunca sobre o Super Admin nem sobre si mesmo; sobre outro Admin, só o Super Admin. */
export function assertCanModerate(actor: DbUser, target: DbUser, what: string): void {
  if (target.id === actor.id) throw forbidden(`Você não pode ${what} a própria conta.`);
  if (hasRole(target, 'SUPER_ADMIN')) throw forbidden(`Ninguém pode ${what} o Super Admin.`);
  if (isAdmin(target) && !hasRole(actor, 'SUPER_ADMIN')) throw forbidden(`Só o Super Admin pode ${what} outro administrador.`);
  if (target.status === 'MERGED' || target.status === 'DELETED') throw conflict('Esta conta não existe mais (foi mesclada ou excluída).', 'ACCOUNT_GONE');
}

const SANCTION_TEXT: Record<Sanction['type'], { title: string; verb: string }> = {
  WARNING: { title: 'Você recebeu uma advertência', verb: 'Advertência aplicada' },
  SUSPENSION: { title: 'Sua conta foi suspensa', verb: 'Suspensão aplicada' },
  BAN: { title: 'Sua conta foi banida', verb: 'Banimento aplicado' },
};

/**
 * Aplica a sanção com efeito imediato. Usado por `POST /admin/users/:id/sanctions`
 * (inclusive nas ações rápidas da moderação, com `reportId`).
 */
export function applySanction(actor: DbUser, target: DbUser, input: CreateSanctionInput): SanctionResult {
  assertCanModerate(actor, target, 'sancionar');
  if (target.status === 'BANNED') throw conflict('Esta conta já está banida.', 'ALREADY_BANNED');
  const report = input.reportId ? reports().find((r) => r.id === input.reportId) : undefined;
  if (input.reportId && !report) throw badRequest('Denúncia não encontrada.', 'VALIDATION', { reportId: 'Denúncia não encontrada.' });

  const now = Date.now();
  const startsAt = new Date(now).toISOString();
  const endsAt = input.type === 'SUSPENSION' ? new Date(now + (input.days ?? 1) * DAY).toISOString() : null;
  const before = { status: target.status };

  // Uma suspensão nova (ou o banimento) substitui a suspensão em vigor: fica só uma valendo.
  if (input.type !== 'WARNING') {
    for (const s of sanctions()) if (s.userId === target.id && s.type === 'SUSPENSION' && isInForce(s, now)) s.liftedAt = startsAt;
  }
  const record: DbSanction = { id: uid('sa'), userId: target.id, type: input.type, reason: input.reason.trim(), issuedById: actor.id, startsAt, endsAt, liftedAt: null, reportId: report?.id ?? null };
  sanctions().push(record);
  if (input.type === 'SUSPENSION') target.status = 'SUSPENDED';
  if (input.type === 'BAN') target.status = 'BANNED';
  const reportBefore = report?.status;
  if (report) {
    report.status = 'ACTIONED';
    report.resolution = `${SANCTION_TEXT[input.type].verb}: ${record.reason}`;
    report.handledByNickname = actor.nickname;
    report.updatedAt = startsAt;
  }
  save();

  audit(actor, {
    action: 'USER_SANCTIONED',
    entityType: 'User',
    entityId: target.id,
    entityLabel: target.nickname,
    before,
    after: { status: target.status, sancao: input.type, ...(endsAt ? { ate: endsAt } : {}), ...(report ? { denuncia: report.id } : {}) },
    reason: record.reason,
  });
  if (report) {
    audit(actor, { action: 'REPORT_HANDLED', entityType: 'Report', entityId: report.id, entityLabel: report.targetLabel, before: { status: reportBefore }, after: { status: 'ACTIONED' }, reason: report.resolution });
  }

  const until = endsAt ? ` até ${new Date(endsAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : '';
  notify([target.id], 'SANCTION', SANCTION_TEXT[input.type].title, `${input.type === 'SUSPENSION' ? `Suspensão${until}. ` : ''}Motivo: ${record.reason}`, null);

  let affectedTournaments: OrphanOutcome[] = [];
  if (input.type !== 'WARNING') {
    // Derruba a sessão aberta (CT-09). O evento não leva dado sensível: só o motivo genérico.
    publish(`user:${target.id}`, { type: 'session.revoked', reason: input.type === 'BAN' ? 'BANNED' : 'SUSPENDED' });
    affectedTournaments = releaseTournamentsOf(target, actor, input.type === 'BAN' ? `Organizador ${target.nickname} banido` : `Organizador ${target.nickname} suspenso`);
  }
  return { sanction: toSanction(record), user: toAdminUserDetail(target), affectedTournaments };
}

// ── Mescla de contas (RN-13) ─────────────────────────────────────────
const LIVE_TOURNAMENT = (status: string) => status !== 'FINISHED' && status !== 'ARCHIVED' && status !== 'CANCELLED';

function activeTournamentIdsOf(userId: string): Set<string> {
  const d = db();
  return new Set(
    registrationsOf(userId)
      .filter((r) => ACTIVE_REGISTRATION_STATUSES.includes(r.status))
      .filter((r) => LIVE_TOURNAMENT(d.tournaments.find((t) => t.id === r.tournamentId)?.status ?? 'FINISHED'))
      .map((r) => r.tournamentId),
  );
}

function mergeUsers(actor: DbUser, target: DbUser, source: DbUser, reason: string): MergeUsersResult {
  const d = db();
  if (source.id === target.id) throw badRequest('Escolha duas contas diferentes.', 'SAME_ACCOUNT', { sourceUserId: 'Escolha outra conta.' });
  for (const u of [source, target]) {
    if (u.status === 'MERGED' || u.status === 'DELETED') throw conflict(`A conta ${u.nickname} não existe mais (foi mesclada ou excluída).`, 'ACCOUNT_GONE');
  }
  if (source.id === actor.id) throw forbidden('Você não pode mesclar a sua própria conta em outra.');
  if (isAdmin(source)) throw forbidden('Conta de administrador não pode ser a origem da mescla. Revogue o papel antes.');
  if (hasRole(target, 'SUPER_ADMIN') && !hasRole(actor, 'SUPER_ADMIN')) throw forbidden('Só o Super Admin pode mesclar outra conta na dele.');

  // Bloqueio: as duas contas no mesmo campeonato ativo (sozinhas ou em squads).
  const targetTournaments = activeTournamentIdsOf(target.id);
  const clash = [...activeTournamentIdsOf(source.id)].filter((id) => targetTournaments.has(id));
  if (clash.length > 0) {
    const names = clash.map((id) => d.tournaments.find((t) => t.id === id)?.name ?? id);
    throw conflict(`As duas contas estão inscritas no mesmo campeonato ativo (${names.join(', ')}). Resolva o conflito antes de mesclar.`, 'MERGE_CONFLICT');
  }

  const moved = { registrations: 0, teams: 0, gameAccounts: 0 };

  // Inscrições solo e participações em inscrições de squad.
  for (const r of d.registrations) {
    let touched = false;
    if (r.userId === source.id) {
      r.userId = target.id;
      touched = true;
    }
    for (const m of r.members) {
      if (m.userId !== source.id) continue;
      touched = true;
      m.userId = target.id;
    }
    if (touched) {
      // O destino já estava no elenco dessa inscrição: sobra uma entrada só.
      const seen = new Set<string>();
      r.members = r.members.filter((m) => (seen.has(m.userId) ? false : (seen.add(m.userId), true)));
      moved.registrations += 1;
    }
  }

  // Squads: participação e capitania.
  for (const team of d.teams) {
    const membership = team.members.find((m) => m.userId === source.id);
    if (!membership) continue;
    moved.teams += 1;
    const already = team.members.find((m) => m.userId === target.id);
    if (already) {
      team.members = team.members.filter((m) => m.userId !== source.id);
      if (membership.role === 'CAPTAIN') already.role = 'CAPTAIN';
    } else {
      membership.userId = target.id;
    }
    if (team.captainId === source.id) team.captainId = target.id;
  }
  for (const invite of d.teamInvites) {
    if (invite.invitedUserId === source.id) invite.invitedUserId = target.id;
    if (invite.invitedById === source.id) invite.invitedById = target.id;
  }

  // IDs de jogo: em conflito, vale o do destino.
  for (const account of source.gameAccounts) {
    if (target.gameAccounts.some((a) => a.gameId === account.gameId)) continue;
    target.gameAccounts.push(account);
    moved.gameAccounts += 1;
  }
  source.gameAccounts = [];

  // Seguidos, denúncias e histórico de partidas (check-ins e kills por jogador).
  for (const f of d.follows) {
    if (f.userId !== source.id) continue;
    f.userId = target.id;
  }
  const seenFollows = new Set<string>();
  d.follows = d.follows.filter((f) => {
    const key = `${f.userId}|${f.targetType}|${f.targetId}`;
    if (seenFollows.has(key)) return false;
    seenFollows.add(key);
    return true;
  });
  for (const r of reports()) {
    if (r.reporterId === source.id) {
      r.reporterId = target.id;
      r.reporterNickname = target.nickname;
    }
    if (r.targetOwnerUserId === source.id) r.targetOwnerUserId = target.id;
    if (r.targetType === 'USER' && r.targetId === source.id) {
      r.targetId = target.id;
      r.targetLabel = target.nickname;
      r.targetLink = `/u/${encodeURIComponent(target.nickname)}`;
    }
  }
  for (const s of sanctions()) if (s.userId === source.id) s.userId = target.id;
  for (const meta of matchMetas()) {
    for (const c of meta.checkIns) if (c.userId === source.id) c.userId = target.id;
    for (const kills of Object.values(meta.playerKills)) {
      const value = kills[source.id];
      if (value === undefined) continue;
      kills[target.id] = (kills[target.id] ?? 0) + value;
      delete kills[source.id];
    }
  }

  // A origem fica sem login e sem papéis (os papéis não são transferidos). O apelido continua reservado.
  const sourceRoles = [...source.roles];
  const wasOrganizer = source.roles.includes('ORGANIZER');
  source.status = 'MERGED';
  source.roles = ['PARTICIPANT'];
  source.verifiedOrganizer = false;
  source.organizerLimits = null;
  save();

  audit(actor, {
    action: 'USERS_MERGED',
    entityType: 'User',
    entityId: target.id,
    entityLabel: `${source.nickname} → ${target.nickname}`,
    before: { origem: source.nickname, origemId: source.id, origemStatus: 'ACTIVE', origemPapeis: sourceRoles },
    after: { destino: target.nickname, origemStatus: 'MERGED', inscricoesTransferidas: moved.registrations, squadsTransferidos: moved.teams, idsDeJogoTransferidos: moved.gameAccounts },
    reason,
  });
  publish(`user:${source.id}`, { type: 'session.revoked', reason: 'MERGED' });
  notify([target.id], 'SANCTION', 'Contas mescladas', `A conta ${source.nickname} foi mesclada na sua. Inscrições, squads e IDs de jogo agora estão aqui.`, '/minha-conta');
  if (wasOrganizer) releaseTournamentsOf(source, actor, `Conta de ${source.nickname} mesclada em ${target.nickname}`);
  return { target: toAdminUserDetail(target), moved };
}

export const handlers: HttpHandler[] = [
  http.get(
    url('/admin/users'),
    handle(({ request }) => {
      adminOnly();
      expireSuspensions();
      const q = query(request);
      const term = normalize((q.get('q') ?? '').trim());
      const role = Role.safeParse(q.get('role'));
      const status = UserStatus.safeParse(q.get('status'));
      const rows = db()
        .users.filter((u) => !role.success || u.roles.includes(role.data))
        .filter((u) => !status.success || u.status === status.data)
        .filter((u) => !term || normalize(u.nickname).includes(term) || u.email.toLowerCase().includes(term))
        .sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR'))
        .map(toAdminUser);
      return json(paginateNumbered(rows, q.get('page')));
    }),
  ),

  http.get(
    url('/admin/users/:id'),
    handle(({ params }) => {
      adminOnly();
      expireSuspensions();
      return json(toAdminUserDetail(findTargetUser(param(params, 'id'))));
    }),
  ),

  http.post(
    url('/admin/users/:id/sanctions'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      const input = await body(request, CreateSanctionInput);
      expireSuspensions();
      return json(applySanction(actor, target, input), 201);
    }),
  ),

  /** Remove a sanção antes do prazo: a conta volta a ficar ativa. */
  http.delete(
    url('/admin/sanctions/:id'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const record = sanctions().find((s) => s.id === param(params, 'id'));
      if (!record) throw notFound('Sanção');
      const target = findTargetUser(record.userId);
      assertCanModerate(actor, target, 'alterar as sanções de');
      if (record.liftedAt) throw conflict('Esta sanção já foi removida.', 'ALREADY_LIFTED');
      let reason: string | undefined;
      try {
        reason = RoleRevokeInput.parse(await request.json()).reason;
      } catch {
        reason = undefined;
      }
      const before = { status: target.status };
      record.liftedAt = nowIso();
      if (record.type !== 'WARNING') {
        const now = Date.now();
        const others = sanctions().filter((s) => s.userId === target.id && s.id !== record.id && isInForce(s, now));
        target.status = others.some((s) => s.type === 'BAN') ? 'BANNED' : others.some((s) => s.type === 'SUSPENSION') ? 'SUSPENDED' : 'ACTIVE';
      }
      save();
      audit(actor, { action: 'SANCTION_LIFTED', entityType: 'User', entityId: target.id, entityLabel: target.nickname, before: { ...before, sancao: record.type }, after: { status: target.status }, reason: reason ?? null });
      notify([target.id], 'SANCTION', 'Sanção removida', record.type === 'WARNING' ? 'A administração removeu uma advertência da sua conta.' : 'A administração removeu a sanção e a sua conta voltou a ficar ativa.', null);
      return json(toAdminUserDetail(target));
    }),
  ),

  /**
   * Gera o link de redefinição de senha. No protótipo o link volta na resposta (como no "esqueci a senha");
   * na API real ele vai por e-mail para o usuário e nunca aparece para o Admin.
   */
  http.post(
    url('/admin/users/:id/reset-password'),
    handle(({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      // Redefinir a senha de um Admin daria acesso à conta dele: mesma proteção das sanções.
      assertCanModerate(actor, target, 'redefinir a senha de');
      const token = uid('reset');
      db().emailTokens.push({ token, userId: target.id, type: 'RESET', usedAt: null });
      save();
      audit(actor, { action: 'USER_PASSWORD_RESET', entityType: 'User', entityId: target.id, entityLabel: target.nickname, after: { linkEnviadoPara: target.email } });
      notify([target.id], 'SANCTION', 'Redefinição de senha', 'A administração gerou um link para você criar uma senha nova. Se não foi você quem pediu, fale com o suporte.', null);
      return json({ link: `${new URL(request.url).origin}/redefinir-senha?token=${encodeURIComponent(token)}` });
    }),
  ),

  /** `:id` é a conta de destino (a que fica); `sourceUserId` é a duplicada, que vira `MERGED`. Irreversível. */
  http.post(
    url('/admin/users/:id/merge'),
    handle(async ({ request, params }) => {
      const actor = adminOnly();
      const target = findTargetUser(param(params, 'id'));
      const input = await body(request, MergeUsersInput);
      const source = db().users.find((u) => u.id === input.sourceUserId);
      if (!source) throw badRequest('Conta de origem não encontrada.', 'VALIDATION', { sourceUserId: 'Conta não encontrada.' });
      return json(mergeUsers(actor, target, source, input.reason.trim()));
    }),
  ),
];
