/**
 * Regras do painel do Administrador, de ponta a ponta sobre a API simulada (sem navegador).
 * São os mesmos cenários que a API real terá de passar em B2 (plano, tabela de testes: linhas Admin e Moderação).
 */
import {
  AdminMember,
  AdminOrganizer,
  AdminOrganizerRequest,
  AdminRemovalRequest,
  AdminReport,
  AdminStats,
  AdminTournament,
  AdminUser,
  AdminUserDetail,
  AuditLog,
  AuditMeta,
  Dispute,
  FeatureFlag,
  FeatureFlags,
  GlobalAnnouncement,
  LockedStage,
  MergeUsersResult,
  numberedPage,
  PublicSiteSettings,
  RoleInvite,
  RoleRevokeResult,
  SanctionResult,
  SiteBannerItem,
  SiteSettings,
  SystemHealth,
  TwoFactorEnabled,
  TwoFactorSetup,
  TwoFactorStatus,
  type Me,
} from '@nova/schemas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { totp } from '../../features/profile/security/totp';
import { auditLogs, type DbAuditLog } from '../audit';
import { subscribeBus, type BusMessage } from '../bus';
import { db } from '../db';
import { notifications } from '../notify';
import { as, call, mutate, setupMockApi } from '../testing';
import { enabledHandlers } from './index';
import { reports } from './reports';
import { disputes, type DbDispute } from './submissions';

setupMockApi();
afterEach(() => vi.useRealTimers());

const RAFAEL = 'u_rafael'; // super admin
const ANA = 'u_ana'; // admin
const CAMILA = 'u_camila'; // organizadora verificada
const DIEGO = 'u_diego'; // organizador
const BIANCA = 'u_bianca'; // participante
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const user = (id: string) => {
  const found = db().users.find((u) => u.id === id);
  if (!found) throw new Error(`Usuário ${id} não existe no seed`);
  return found;
};
const lastAudit = (action: string): DbAuditLog | undefined => [...auditLogs()].reverse().find((l) => l.action === action);
const auditCount = (action: string) => auditLogs().filter((l) => l.action === action).length;
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Transforma uma conta em Admin com 2FA (como ficaria depois do convite + configuração do 2FA). */
async function makeAdmin(id: string): Promise<void> {
  as(ANA);
  const res = await call('POST', `/admin/users/${id}/roles`, { role: 'ADMIN', reason: 'Reforço na moderação' });
  expect(res.status, res.detail).toBe(200);
  mutate(() => {
    user(id).twoFactorEnabled = true;
  });
}

async function createInvite(input: { role?: 'ADMIN' | 'ORGANIZER'; validity?: '1h' | '24h' | '7d'; maxUses?: number; email?: string } = {}): Promise<{ invite: RoleInvite; token: string }> {
  const res = await call('POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 1, ...input });
  expect(res.status, res.detail).toBe(201);
  const invite = RoleInvite.parse(res.data);
  const token = invite.link?.split('/convite/')[1] ?? '';
  expect(token.length).toBeGreaterThan(20);
  return { invite, token };
}

// ── Permissões: cada rota × papel ────────────────────────────────────
interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string | (() => Promise<string>);
  body?: unknown;
  /** Status esperado para a Admin (Ana). Padrão: 200. */
  admin?: number;
  /** Resposta que não é JSON (CSV). */
  raw?: boolean;
}

const banner = { title: 'Novidade na Arena', body: 'Ranking por jogo no ar.', kind: 'BANNER', audience: 'ALL', gameId: null, startsAt: null, endsAt: null };

const ROUTES: Route[] = [
  { method: 'GET', path: '/admin/stats' },
  { method: 'GET', path: '/admin/users' },
  { method: 'GET', path: `/admin/users/${BIANCA}` },
  { method: 'POST', path: '/admin/users/u_p20/sanctions', body: { type: 'WARNING', reason: 'Linguagem ofensiva no chat' }, admin: 201 },
  {
    method: 'DELETE',
    path: async () => {
      as(ANA);
      const res = await call('POST', '/admin/users/u_p21/sanctions', { type: 'WARNING', reason: 'Linguagem ofensiva no chat' });
      return `/admin/sanctions/${SanctionResult.parse(res.data).sanction.id}`;
    },
  },
  { method: 'POST', path: '/admin/users/u_p22/reset-password' },
  { method: 'POST', path: '/admin/users/u_p23/merge', body: { sourceUserId: 'u_p52', reason: 'Mesma pessoa, duas contas' } },
  { method: 'GET', path: '/admin/admins' },
  { method: 'GET', path: '/admin/invites' },
  { method: 'POST', path: '/admin/invites', body: { role: 'ADMIN', validity: '24h', maxUses: 2 }, admin: 201 },
  { method: 'DELETE', path: '/admin/invites/ri_1' },
  { method: 'POST', path: '/admin/users/u_p41/roles', body: { role: 'ORGANIZER' } },
  { method: 'DELETE', path: `/admin/users/${DIEGO}/roles/ORGANIZER` },
  { method: 'GET', path: '/admin/admin-removal-requests' },
  // Só o Super Admin decide o pedido de remoção (RN-11).
  { method: 'POST', path: '/admin/admin-removal-requests/qualquer/approve', admin: 403 },
  { method: 'POST', path: '/admin/admin-removal-requests/qualquer/reject', admin: 403 },
  { method: 'GET', path: '/admin/organizers' },
  { method: 'PATCH', path: `/admin/users/${CAMILA}/organizer-limits`, body: { maxActiveTournaments: 5, allowedGameIds: [], verified: true } },
  { method: 'GET', path: '/admin/organizer-requests' },
  { method: 'PATCH', path: '/admin/organizer-requests/or_1', body: { action: 'approve' } },
  { method: 'GET', path: '/admin/tournaments' },
  { method: 'PATCH', path: '/admin/tournaments/tn_efootball', body: { featured: true } },
  { method: 'POST', path: '/admin/tournaments/tn_efootball/owner', body: { ownerId: CAMILA, reason: 'Diego pediu para sair' } },
  { method: 'POST', path: '/admin/tournaments/tn_ff_solo/cancel', body: { reason: 'Evento duplicado' } },
  { method: 'POST', path: '/admin/tournaments/tn_open_8ball/archive' },
  { method: 'GET', path: '/admin/tournaments/tn_liga_cr/locked-stages' },
  { method: 'GET', path: '/admin/announcements' },
  { method: 'POST', path: '/admin/announcements', body: banner, admin: 201 },
  {
    method: 'PATCH',
    path: async () => {
      as(ANA);
      const res = await call('POST', '/admin/announcements', banner);
      return `/admin/announcements/${GlobalAnnouncement.parse(res.data).id}`;
    },
    body: { active: false },
  },
  { method: 'GET', path: '/admin/audit-logs' },
  { method: 'GET', path: '/admin/audit-logs/meta' },
  { method: 'GET', path: '/admin/audit-logs.csv', raw: true },
  { method: 'GET', path: '/admin/reports' },
  { method: 'PATCH', path: '/admin/reports/rp_demo_2', body: { status: 'IN_REVIEW' } },
  { method: 'GET', path: '/admin/disputes' },
  { method: 'GET', path: '/admin/settings' },
  // Matriz do PRD §6: configurações globais são do Super Admin; o Admin só lê.
  { method: 'PUT', path: '/admin/settings', body: {}, admin: 403 },
  { method: 'GET', path: '/admin/flags' },
  { method: 'PUT', path: '/admin/flags/ranking', body: { enabled: false }, admin: 403 },
  { method: 'GET', path: '/admin/health' },
  { method: 'POST', path: `/admin/users/${BIANCA}/2fa/reset`, body: { reason: 'Perdeu o celular' }, admin: 403 },
];

async function statusOf(route: Route, path: string): Promise<number> {
  if (route.raw) {
    const res = await fetch(`http://localhost:3000/api/v1${path}`, { method: route.method });
    return res.status;
  }
  return (await call(route.method, path, route.body)).status;
}

describe('permissões: toda rota /admin/* exige Admin ou Super Admin', () => {
  it.each(ROUTES.map((r) => [`${r.method} ${typeof r.path === 'string' ? r.path : '(recurso criado no teste)'}`, r] as const))('%s', async (_name, route) => {
    const path = typeof route.path === 'string' ? route.path : await route.path();

    as(null);
    expect(await statusOf(route, path), 'visitante').toBe(401);
    as(BIANCA);
    expect(await statusOf(route, path), 'participante').toBe(403);
    as(CAMILA);
    expect(await statusOf(route, path), 'organizador').toBe(403);
    as(ANA);
    expect(await statusOf(route, path), 'admin').toBe(route.admin ?? 200);
  });

  it('a lista de rotas do teste cobre todas as rotas /admin/* registradas por este painel', () => {
    const mine = ['admin-users', 'admin-roles', 'admin-tournaments', 'admin-audit', 'admin-moderation', 'admin-settings'];
    expect(mine).toHaveLength(6);
    const registered = enabledHandlers(mine.join(','))
      .map((h) => (h.info as { method: string; path: string }) ?? { method: '', path: '' })
      .filter((info) => String(info.path).includes('/admin/'))
      .map((info) => `${info.method} ${String(info.path).replace('/api/v1', '')}`);
    const shape = (path: string) =>
      path
        .replace(/\/(u_[a-z0-9]+|tn_[a-z0-9_]+|or_1|ri_1|rp_demo_2|qualquer)(?=\/|$)/g, '/:id')
        .replace(/roles\/ORGANIZER$/, 'roles/:role')
        .replace(/flags\/ranking$/, 'flags/:key')
        .replace(/removal-requests\/:id\/(approve|reject)$/, 'removal-requests/:id/:decision');
    const tested = new Set(ROUTES.filter((r) => typeof r.path === 'string').map((r) => `${r.method} ${shape(r.path as string)}`));
    tested.add('DELETE /admin/sanctions/:id');
    tested.add('PATCH /admin/announcements/:id');
    expect(registered.length).toBeGreaterThan(35);
    expect(registered.filter((r) => !tested.has(r))).toEqual([]);
  });

  it('Admin sem verificação em duas etapas recebe 403 (RNF-08)', async () => {
    mutate(() => {
      user(ANA).twoFactorEnabled = false;
    });
    as(ANA);
    const res = await call('GET', '/admin/stats');
    expect(res.status).toBe(403);
    expect(res.code).toBe('TWO_FACTOR_REQUIRED');
  });
});

// ── Dashboard ────────────────────────────────────────────────────────
describe('dashboard: indicadores calculados do banco', () => {
  it('conta usuários, campeonatos, partidas validadas da semana (North Star) e filas abertas', async () => {
    as(ANA);
    const res = await call('GET', '/admin/stats');
    const stats = AdminStats.parse(res.data);
    expect(stats.totalUsers).toBe(66);
    expect(stats.activeUsers).toBe(66);
    expect(stats.activeTournaments).toBe(5);
    expect(stats.finishedTournaments).toBe(1);
    // Liga CR: 8 oitavas ontem + 2 quartas hoje. As partidas do Open 8 Ball foram há 21 dias.
    expect(stats.validatedMatchesThisWeek).toBe(10);
    expect(stats.matchesThisWeek).toBe(10);
    expect(stats.pendingOrganizerRequests).toBe(1);
    expect(stats.openReports).toBe(reports().filter((r) => r.status === 'OPEN' || r.status === 'IN_REVIEW').length);
    expect(stats.openDisputes).toBe(0);
    expect(stats.signups).toHaveLength(30);
    expect(stats.validatedMatches.reduce((sum, d) => sum + d.count, 0)).toBe(22);
    expect(Object.fromEntries(stats.tournamentsByGame.map((g) => [g.gameName, g.count]))).toEqual({ 'Free Fire': 3, '8 Ball Pool': 2, 'Clash Royale': 1, eFootball: 1 });
    expect(stats.walkoverRate).toBe(0);
    expect(stats.disputeRate).toBe(0);
  });

  it('o intervalo muda as séries: 7 dias tem 7 pontos; 90 dias alcança os cadastros do seed', async () => {
    as(ANA);
    const day = (offset: number) => new Date(Date.now() - offset * DAY).toISOString().slice(0, 10);
    const week = AdminStats.parse((await call('GET', `/admin/stats?from=${day(6)}&to=${day(0)}`)).data);
    expect(week.signups).toHaveLength(7);
    // O seed espalha os cadastros nos últimos 60 dias: a semana pega só os mais recentes.
    const weekSignups = week.signups.reduce((sum, d) => sum + d.count, 0);
    expect(weekSignups).toBeGreaterThanOrEqual(5);
    expect(weekSignups).toBeLessThanOrEqual(7);
    expect(week.validatedMatches.reduce((sum, d) => sum + d.count, 0)).toBe(10);
    const quarter = AdminStats.parse((await call('GET', `/admin/stats?from=${day(89)}&to=${day(0)}`)).data);
    expect(quarter.signups).toHaveLength(90);
    expect(quarter.signups.reduce((sum, d) => sum + d.count, 0)).toBe(66);
  });

  it('W.O. entra na taxa de W.O. e não conta como partida validada', async () => {
    as(ANA);
    const before = AdminStats.parse((await call('GET', '/admin/stats')).data);
    mutate((d) => {
      const run = (d.extra.stageRuns as Array<{ stageId: string; state: { results: Record<string, { walkover: boolean }> } }>).find((r) => r.stageId === 'tn_liga_cr_s1');
      const first = Object.values(run?.state.results ?? {})[0];
      if (first) first.walkover = true;
    });
    const after = AdminStats.parse((await call('GET', '/admin/stats')).data);
    expect(after.validatedMatchesThisWeek).toBe(before.validatedMatchesThisWeek - 1);
    expect(after.matchesThisWeek).toBe(before.matchesThisWeek);
    expect(after.walkoverRate).toBeCloseTo(1 / 22, 5);
  });
});

// ── Usuários e sanções ───────────────────────────────────────────────
describe('usuários: busca, perfil e sanções', () => {
  it('lista paginada com busca por apelido ou e-mail e filtros de papel e status', async () => {
    as(ANA);
    const Page = numberedPage(AdminUser);
    const all = Page.parse((await call('GET', '/admin/users')).data);
    expect(all.total).toBe(66);
    expect(all.items).toHaveLength(20);
    expect(all.pageCount).toBe(4);
    const last = Page.parse((await call('GET', '/admin/users?page=4')).data);
    expect(last.items).toHaveLength(6);

    expect(Page.parse((await call('GET', '/admin/users?q=bian')).data).items.map((u) => u.id)).toEqual([BIANCA]);
    expect(Page.parse((await call('GET', '/admin/users?q=jogador12@exemplo.com')).data).items.map((u) => u.id)).toEqual(['u_p12']);
    expect(
      Page.parse((await call('GET', '/admin/users?role=ORGANIZER')).data)
        .items.map((u) => u.id)
        .sort(),
    ).toEqual([CAMILA, DIEGO]);
    expect(Page.parse((await call('GET', '/admin/users?status=BANNED')).data).total).toBe(0);
  });

  it('perfil completo: IDs de jogo, squads, histórico e denúncias recebidas', async () => {
    as(ANA);
    const detail = AdminUserDetail.parse((await call('GET', '/admin/users/u_lucas')).data);
    expect(detail.email).toBe('lucas@novaarena.gg');
    expect(detail.gameAccounts.map((g) => g.gameName)).toContain('Free Fire');
    expect(detail.teams).toEqual([{ id: 't_alfa', name: 'Squad Alfa', tag: 'ALFA', isCaptain: true }]);
    expect(detail.tournamentsPlayed).toBe(1);
    expect(detail.sanctions).toEqual([]);
    expect(detail.organizerLimits).toBeNull();
    const camila = AdminUserDetail.parse((await call('GET', `/admin/users/${CAMILA}`)).data);
    expect(camila.tournamentsOrganized).toBe(4);
    expect(camila.organizerLimits).toEqual({ maxActiveTournaments: 10, allowedGameIds: [] });
    expect((await call('GET', '/admin/users/nao-existe')).status).toBe(404);
  });

  it('CT-09: banir derruba a sessão aberta — GET /me passa a devolver null e session.revoked é publicado', async () => {
    const events: BusMessage[] = [];
    const stop = subscribeBus((m) => events.push(m));

    as(BIANCA);
    expect(((await call<Me | null>('GET', '/me')).data as Me).id).toBe(BIANCA);

    as(ANA);
    const res = await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'BAN', reason: 'Uso de hack comprovado em três partidas' });
    expect(res.status, res.detail).toBe(201);
    const result = SanctionResult.parse(res.data);
    expect(result.user.status).toBe('BANNED');
    expect(result.sanction).toMatchObject({ type: 'BAN', endsAt: null, issuedByNickname: 'Ana' });

    // A sessão da Bianca continua "aberta" no navegador dela, mas a API não a reconhece mais.
    as(BIANCA);
    expect((await call('GET', '/me')).data).toBeNull();
    expect((await call('GET', '/me/reports')).status).toBe(401);
    const login = await call('POST', '/auth/dev-login', { userId: BIANCA });
    expect(login.status).toBe(403);
    expect(login.code).toBe('ACCOUNT_BANNED');

    await tick();
    stop();
    expect(events).toContainEqual({ channel: `user:${BIANCA}`, event: { type: 'session.revoked', reason: 'BANNED' } });
    expect(notifications().some((n) => n.userId === BIANCA && n.type === 'SANCTION' && n.title === 'Sua conta foi banida')).toBe(true);
    expect(lastAudit('USER_SANCTIONED')).toMatchObject({ actorId: ANA, entityId: BIANCA, before: { status: 'ACTIVE' }, after: { status: 'BANNED', sancao: 'BAN' }, reason: 'Uso de hack comprovado em três partidas' });
  });

  it('remover a sanção devolve a conta para ativa e é auditado', async () => {
    as(ANA);
    const banned = SanctionResult.parse((await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'BAN', reason: 'Engano na análise' })).data);
    const lifted = await call('DELETE', `/admin/sanctions/${banned.sanction.id}`, { reason: 'Banimento aplicado por engano' });
    expect(lifted.status, lifted.detail).toBe(200);
    const detail = AdminUserDetail.parse(lifted.data);
    expect(detail.status).toBe('ACTIVE');
    expect(detail.sanctions[0]?.liftedAt).not.toBeNull();
    expect(lastAudit('SANCTION_LIFTED')).toMatchObject({ actorId: ANA, entityId: BIANCA, before: { status: 'BANNED' }, after: { status: 'ACTIVE' }, reason: 'Banimento aplicado por engano' });
    as(BIANCA);
    expect(((await call('GET', '/me')).data as Me).id).toBe(BIANCA);
    as(ANA);
    expect((await call('DELETE', `/admin/sanctions/${banned.sanction.id}`)).status).toBe(409);
  });

  it('suspensão tem prazo, derruba a sessão e expira sozinha', async () => {
    const events: BusMessage[] = [];
    const stop = subscribeBus((m) => events.push(m));
    as(ANA);
    expect((await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'SUSPENSION', reason: 'Ofensas repetidas' })).status).toBe(400);

    const start = Date.now();
    const res = await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'SUSPENSION', days: 3, reason: 'Ofensas repetidas' });
    const result = SanctionResult.parse(res.data);
    expect(result.user.status).toBe('SUSPENDED');
    const until = new Date(result.user.suspendedUntil ?? '').getTime();
    expect(until).toBeGreaterThanOrEqual(start + 3 * DAY);
    expect(until).toBeLessThan(start + 3 * DAY + 60_000);
    await tick();
    stop();
    expect(events).toContainEqual({ channel: `user:${BIANCA}`, event: { type: 'session.revoked', reason: 'SUSPENDED' } });
    const blocked = await call('POST', '/auth/dev-login', { userId: BIANCA });
    expect(blocked.code).toBe('ACCOUNT_SUSPENDED');

    // Dois dias depois ainda vale; no quarto dia a conta voltou sozinha.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start + 2 * DAY);
    as(ANA);
    expect(AdminUserDetail.parse((await call('GET', `/admin/users/${BIANCA}`)).data).status).toBe('SUSPENDED');
    vi.setSystemTime(start + 3 * DAY + HOUR);
    const after = AdminUserDetail.parse((await call('GET', `/admin/users/${BIANCA}`)).data);
    expect(after.status).toBe('ACTIVE');
    expect(after.suspendedUntil).toBeNull();
    expect(after.sanctions).toHaveLength(1);
    expect((await call('POST', '/auth/dev-login', { userId: BIANCA })).status).toBe(200);
  });

  it('advertência não muda o status nem derruba a sessão', async () => {
    const events: BusMessage[] = [];
    const stop = subscribeBus((m) => events.push(m));
    as(ANA);
    const result = SanctionResult.parse((await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'WARNING', reason: 'Nick ofensivo' })).data);
    expect(result.user.status).toBe('ACTIVE');
    await tick();
    stop();
    expect(events.filter((e) => e.event.type === 'session.revoked')).toEqual([]);
    expect(notifications().some((n) => n.userId === BIANCA && n.type === 'SANCTION')).toBe(true);
  });

  it('Admin não sanciona o Super Admin, nem a si mesmo, nem outro Admin', async () => {
    as(ANA);
    const ban = { type: 'BAN', reason: 'Tentativa indevida' };
    expect((await call('POST', `/admin/users/${RAFAEL}/sanctions`, ban)).status).toBe(403);
    expect((await call('POST', `/admin/users/${ANA}/sanctions`, ban)).status).toBe(403);
    expect((await call('POST', `/admin/users/${RAFAEL}/reset-password`)).status).toBe(403);
    await makeAdmin('u_p10');
    as(ANA);
    expect((await call('POST', '/admin/users/u_p10/sanctions', ban)).status).toBe(403);
    expect(user(RAFAEL).status).toBe('ACTIVE');
    expect(user('u_p10').status).toBe('ACTIVE');
    expect(auditCount('USER_SANCTIONED')).toBe(0);

    // O Super Admin pode sancionar um Admin, mas ninguém sanciona o Super Admin (nem ele mesmo).
    as(RAFAEL);
    expect((await call('POST', '/admin/users/u_p10/sanctions', ban)).status).toBe(201);
    expect((await call('POST', `/admin/users/${RAFAEL}/sanctions`, ban)).status).toBe(403);
  });

  it('redefinir senha gera um link de uso único que funciona no fluxo de redefinição', async () => {
    as(ANA);
    const res = await call<{ link: string }>('POST', `/admin/users/${BIANCA}/reset-password`);
    expect(res.status).toBe(200);
    const token = new URL(res.data.link).searchParams.get('token');
    expect(res.data.link).toContain('/redefinir-senha?token=');
    as(null);
    expect((await call('POST', '/auth/reset-password', { token, password: 'novaSenha123' })).status).toBe(200);
    expect((await call('POST', '/auth/login', { email: 'bianca@novaarena.gg', password: 'novaSenha123' })).status).toBe(200);
    expect((await call('POST', '/auth/reset-password', { token, password: 'outraSenha123' })).status).toBe(400);
    expect(lastAudit('USER_PASSWORD_RESET')).toMatchObject({ actorId: ANA, entityId: BIANCA });
    // A senha nunca entra na auditoria.
    expect(JSON.stringify(auditLogs())).not.toContain('novaSenha123');
  });
});

// ── Mescla de contas (RN-13) ─────────────────────────────────────────
describe('mescla de contas (RN-13)', () => {
  it('bloqueia quando as duas contas estão no mesmo campeonato ativo', async () => {
    as(ANA);
    // Bianca e u_p01 jogam a Liga CR, que está em andamento.
    const res = await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: 'u_p01', reason: 'Mesma pessoa, duas contas' });
    expect(res.status).toBe(409);
    expect(res.code).toBe('MERGE_CONFLICT');
    expect(res.detail).toContain('Liga Semanal Clash Royale 1v1');
    expect(user('u_p01').status).toBe('ACTIVE');
    expect(db().registrations.some((r) => r.tournamentId === 'tn_liga_cr' && r.userId === 'u_p01')).toBe(true);
    expect(auditCount('USERS_MERGED')).toBe(0);
  });

  it('bloqueia também quando estão em squads diferentes no mesmo campeonato ativo', async () => {
    as(ANA);
    // u_p04 (Squad Bravo) e u_p08 (Squad Charlie) estão na Copa Nova FF.
    const res = await call('POST', '/admin/users/u_p04/merge', { sourceUserId: 'u_p08', reason: 'Mesma pessoa, duas contas' });
    expect(res.code).toBe('MERGE_CONFLICT');
  });

  it('sem conflito: transfere inscrições, squads, capitania e IDs de jogo; papéis não são transferidos', async () => {
    // u_p44 é capitão do Squad Lobo (inscrito na Copa Nova FF) e vira a conta de origem.
    mutate(() => {
      user('u_p44').roles = ['ORGANIZER', 'PARTICIPANT'];
    });
    const team = () => db().teams.find((t) => t.captainId === 'u_p44' || t.members.some((m) => m.userId === 'u_p44' || m.userId === BIANCA));
    const teamId = team()?.id ?? '';
    expect(teamId).not.toBe('');
    const freeFireBefore = user(BIANCA).gameAccounts.some((a) => a.gameId === 'g_freefire');
    const clashTagBefore = user(BIANCA).gameAccounts.find((a) => a.gameId === 'g_clashroyale')?.fields.playerTag;
    expect(freeFireBefore).toBe(false);

    as(ANA);
    expect((await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: 'u_p44' })).status).toBe(400);
    const res = await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: 'u_p44', reason: 'Conta antiga da Bianca' });
    expect(res.status, res.detail).toBe(200);
    const result = MergeUsersResult.parse(res.data);
    expect(result.moved).toEqual({ registrations: 1, teams: 1, gameAccounts: 1 });

    const d = db();
    const squad = d.teams.find((t) => t.id === teamId);
    expect(squad?.captainId).toBe(BIANCA);
    expect(squad?.members.some((m) => m.userId === BIANCA && m.role === 'CAPTAIN')).toBe(true);
    expect(squad?.members.some((m) => m.userId === 'u_p44')).toBe(false);
    const copa = d.registrations.find((r) => r.tournamentId === 'tn_copa_ff' && r.teamId === teamId);
    expect(copa?.members.some((m) => m.userId === BIANCA)).toBe(true);
    expect(copa?.members.some((m) => m.userId === 'u_p44')).toBe(false);

    // IDs de jogo: o Free Fire veio da origem; no Clash Royale havia conflito e vale o do destino.
    expect(user(BIANCA).gameAccounts.some((a) => a.gameId === 'g_freefire')).toBe(true);
    expect(user(BIANCA).gameAccounts.find((a) => a.gameId === 'g_clashroyale')?.fields.playerTag).toBe(clashTagBefore);

    // Origem: MERGED, sem login e sem papéis; o destino não herda o papel de organizador.
    expect(user('u_p44').status).toBe('MERGED');
    expect(user('u_p44').roles).toEqual(['PARTICIPANT']);
    expect(user(BIANCA).roles).toEqual(['PARTICIPANT']);
    as('u_p44');
    expect((await call('GET', '/me')).data).toBeNull();

    expect(lastAudit('USERS_MERGED')).toMatchObject({ actorId: ANA, entityId: BIANCA, reason: 'Conta antiga da Bianca', after: { origemStatus: 'MERGED', inscricoesTransferidas: 1, squadsTransferidos: 1 } });

    // Irreversível: a conta mesclada não pode ser usada de novo, em nenhum dos lados.
    as(ANA);
    expect((await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: 'u_p44', reason: 'De novo' })).status).toBe(409);
    expect((await call('POST', '/admin/users/u_p44/merge', { sourceUserId: 'u_p45', reason: 'Tentativa de desfazer' })).status).toBe(409);
  });

  it('não mescla a conta em si mesma, nem conta de administrador como origem', async () => {
    as(ANA);
    expect((await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: BIANCA, reason: 'Mesma conta' })).status).toBe(400);
    expect((await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: RAFAEL, reason: 'Tentativa indevida' })).status).toBe(403);
    expect((await call('POST', `/admin/users/${BIANCA}/merge`, { sourceUserId: ANA, reason: 'Tentativa indevida' })).status).toBe(403);
  });
});

// ── Convites (CT-03) ─────────────────────────────────────────────────
describe('convites de papel (CT-03, US-ADM-02)', () => {
  it('convite de 1 hora e 1 uso: aceito uma vez concede o papel; a segunda tentativa não concede', async () => {
    as(ANA);
    const before = Date.now();
    const { invite, token } = await createInvite({ validity: '1h', maxUses: 1 });
    expect(invite.state).toBe('VALID');
    expect(invite.link).toMatch(/^http:\/\/localhost:3000\/convite\/[0-9a-f]{48}$/);
    const expires = new Date(invite.expiresAt).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + HOUR);
    expect(expires).toBeLessThan(before + HOUR + 60_000);

    // O link completo só aparece na criação: a lista nunca devolve o token.
    const list = z.array(RoleInvite).parse((await call('GET', '/admin/invites')).data);
    expect(list.find((i) => i.id === invite.id)?.link).toBeNull();
    expect(JSON.stringify(list)).not.toContain(token);

    as('u_p10');
    const first = await call('POST', `/role-invites/${token}/accept`);
    expect(first.status, first.detail).toBe(200);
    expect(user('u_p10').roles).toContain('ADMIN');

    as('u_p11');
    const second = await call('POST', `/role-invites/${token}/accept`);
    expect(second.status).toBe(410);
    expect(second.code).toBe('INVITE_EXHAUSTED');
    expect(user('u_p11').roles).toEqual(['PARTICIPANT']);

    as(ANA);
    const after = z.array(RoleInvite).parse((await call('GET', '/admin/invites')).data).find((i) => i.id === invite.id);
    expect(after).toMatchObject({ state: 'EXHAUSTED', uses: 1, maxUses: 1 });
  });

  it('convite expirado não concede papel', async () => {
    as(ANA);
    const { invite, token } = await createInvite();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + HOUR + 1000);
    as('u_p10');
    const res = await call('POST', `/role-invites/${token}/accept`);
    expect(res.status).toBe(410);
    expect(res.code).toBe('INVITE_EXPIRED');
    expect(user('u_p10').roles).toEqual(['PARTICIPANT']);
    as(ANA);
    expect(z.array(RoleInvite).parse((await call('GET', '/admin/invites')).data).find((i) => i.id === invite.id)?.state).toBe('EXPIRED');
  });

  it('convite revogado não concede papel', async () => {
    as(ANA);
    const { invite, token } = await createInvite({ validity: '7d', maxUses: 5 });
    const revoked = await call('DELETE', `/admin/invites/${invite.id}`);
    expect(RoleInvite.parse(revoked.data).state).toBe('REVOKED');
    expect((await call('DELETE', `/admin/invites/${invite.id}`)).status).toBe(409);
    as('u_p10');
    const res = await call('POST', `/role-invites/${token}/accept`);
    expect(res.status).toBe(410);
    expect(res.code).toBe('INVITE_REVOKED');
    expect(user('u_p10').roles).toEqual(['PARTICIPANT']);
  });

  it('o limite de usos é respeitado', async () => {
    as(ANA);
    const { token } = await createInvite({ role: 'ORGANIZER', validity: '24h', maxUses: 2 });
    for (const id of ['u_p10', 'u_p11']) {
      as(id);
      expect((await call('POST', `/role-invites/${token}/accept`)).status).toBe(200);
    }
    as('u_p12');
    expect((await call('POST', `/role-invites/${token}/accept`)).code).toBe('INVITE_EXHAUSTED');
    expect(user('u_p10').roles).toContain('ORGANIZER');
    expect(user('u_p11').roles).toContain('ORGANIZER');
    expect(user('u_p12').roles).toEqual(['PARTICIPANT']);
    // RN-10: organizador novo começa com o limite padrão.
    expect(user('u_p10').organizerLimits).toEqual({ maxActiveTournaments: 3, allowedGameIds: [] });
  });

  it('valida validade e limite de usos (1 a 10)', async () => {
    as(ANA);
    expect((await call('POST', '/admin/invites', { role: 'ADMIN', validity: '30d', maxUses: 1 })).status).toBe(400);
    expect((await call('POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 0 })).status).toBe(400);
    expect((await call('POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 11 })).status).toBe(400);
    expect((await call('POST', '/admin/invites', { role: 'SUPER_ADMIN', validity: '1h', maxUses: 1 })).status).toBe(400);
  });

  it('convite por e-mail vale para um uso e só para aquele e-mail', async () => {
    as(ANA);
    const { invite, token } = await createInvite({ email: 'jogador10@exemplo.com', maxUses: 5, validity: '24h' });
    expect(invite).toMatchObject({ email: 'jogador10@exemplo.com', maxUses: 1 });
    as('u_p11');
    expect((await call('POST', `/role-invites/${token}/accept`)).status).toBe(403);
    as('u_p10');
    expect((await call('POST', `/role-invites/${token}/accept`)).status).toBe(200);
  });

  it('criar, revogar e aceitar ficam na auditoria, sem o token', async () => {
    as(ANA);
    const { invite, token } = await createInvite({ validity: '24h', maxUses: 2 });
    expect(lastAudit('INVITE_CREATED')).toMatchObject({ actorId: ANA, entityId: invite.id, after: { papel: 'ADMIN', validade: '24h', usos: 2 } });
    as('u_p10');
    await call('POST', `/role-invites/${token}/accept`);
    as(ANA);
    // O aceite é de outro módulo: o painel registra na primeira leitura depois dele.
    const logs = numberedPage(AuditLog).parse((await call('GET', '/admin/audit-logs?action=INVITE_ACCEPTED')).data);
    expect(logs.items).toHaveLength(1);
    expect(logs.items[0]).toMatchObject({ actorId: 'u_p10', entityId: 'u_p10', after: { papel: 'ADMIN' }, actionLabel: 'Convite aceito' });
    await call('GET', '/admin/audit-logs');
    expect(auditCount('INVITE_ACCEPTED')).toBe(1);
    await call('DELETE', `/admin/invites/${invite.id}`);
    expect(lastAudit('INVITE_REVOKED')).toMatchObject({ actorId: ANA, entityId: invite.id, after: { estado: 'REVOKED' } });
    expect(JSON.stringify(auditLogs())).not.toContain(token);
  });
});

// ── Administradores (RN-11) ──────────────────────────────────────────
describe('administradores (RN-11)', () => {
  it('ninguém remove o Super Admin', async () => {
    for (const actor of [ANA, RAFAEL]) {
      as(actor);
      const res = await call('DELETE', `/admin/users/${RAFAEL}/roles/ADMIN`);
      expect(res.status).toBe(403);
    }
    expect(user(RAFAEL).roles).toEqual(['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT']);
    expect(auditCount('ROLE_REVOKED')).toBe(0);
  });

  it('lista os administradores com o Super Admin primeiro, último acesso e desde quando', async () => {
    as(ANA);
    const admins = z.array(AdminMember).parse((await call('GET', '/admin/admins')).data);
    expect(admins.map((a) => [a.id, a.isSuperAdmin])).toEqual([
      [RAFAEL, true],
      [ANA, false],
    ]);
    expect(admins[0]?.lastSeenAt).toBe(user(RAFAEL).lastSeenAt);
  });

  it('Admin remove um Admin mais novo na hora', async () => {
    await makeAdmin('u_p10');
    as(ANA);
    const res = await call('DELETE', '/admin/users/u_p10/roles/ADMIN', { reason: 'Saiu da equipe' });
    expect(res.status, res.detail).toBe(200);
    expect(RoleRevokeResult.parse(res.data).outcome).toBe('REVOKED');
    expect(user('u_p10').roles).toEqual(['PARTICIPANT']);
    expect(lastAudit('ROLE_REVOKED')).toMatchObject({ actorId: ANA, entityId: 'u_p10', reason: 'Saiu da equipe', after: { papelRemovido: 'ADMIN' } });
    as('u_p10');
    expect((await call('GET', '/admin/stats')).status).toBe(403);
  });

  it('remover um Admin mais antigo vira pedido pendente; só o Super Admin aprova', async () => {
    await makeAdmin('u_p10');
    as('u_p10');
    const res = await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`, { reason: 'Inativa há meses' });
    expect(res.status).toBe(202);
    const pending = RoleRevokeResult.parse(res.data);
    expect(pending.outcome).toBe('PENDING_APPROVAL');
    // Enquanto o pedido não é aprovado, a Ana continua com acesso.
    expect(user(ANA).roles).toContain('ADMIN');
    as(ANA);
    expect((await call('GET', '/admin/stats')).status).toBe(200);

    as('u_p10');
    expect((await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`)).code).toBe('REMOVAL_ALREADY_REQUESTED');
    const requests = z.array(AdminRemovalRequest).parse((await call('GET', '/admin/admin-removal-requests')).data);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: pending.requestId, targetUserId: ANA, requestedById: 'u_p10', status: 'PENDING', reason: 'Inativa há meses' });
    expect(lastAudit('ADMIN_REMOVAL_REQUESTED')).toMatchObject({ actorId: 'u_p10', entityId: ANA });
    expect((await call('POST', `/admin/admin-removal-requests/${pending.requestId}/approve`)).status).toBe(403);

    as(RAFAEL);
    const approved = await call('POST', `/admin/admin-removal-requests/${pending.requestId}/approve`);
    expect(approved.status, approved.detail).toBe(200);
    expect(AdminRemovalRequest.parse(approved.data)).toMatchObject({ status: 'APPROVED', reviewedByNickname: 'Rafael' });
    expect(user(ANA).roles).toEqual(['PARTICIPANT']);
    expect(lastAudit('ROLE_REVOKED')).toMatchObject({ actorId: RAFAEL, entityId: ANA });
    expect(lastAudit('ADMIN_REMOVAL_REVIEWED')).toMatchObject({ actorId: RAFAEL, after: { situacao: 'APPROVED' } });
    expect((await call('POST', `/admin/admin-removal-requests/${pending.requestId}/approve`)).status).toBe(409);
  });

  it('pedido recusado: o Admin continua no papel', async () => {
    await makeAdmin('u_p10');
    as('u_p10');
    const pending = RoleRevokeResult.parse((await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`)).data);
    as(RAFAEL);
    const rejected = await call('POST', `/admin/admin-removal-requests/${pending.requestId}/reject`);
    expect(AdminRemovalRequest.parse(rejected.data).status).toBe('REJECTED');
    expect(user(ANA).roles).toContain('ADMIN');
    expect(auditCount('ROLE_REVOKED')).toBe(0);
  });

  it('com a regra desligada nas configurações, o Admin remove o mais antigo sem aprovação', async () => {
    await makeAdmin('u_p10');
    as(RAFAEL);
    const settings = SiteSettings.parse((await call('GET', '/admin/settings')).data);
    expect((await call('PUT', '/admin/settings', { ...settings, requireApprovalForSeniorAdminRemoval: false })).status).toBe(200);
    as('u_p10');
    const res = await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`);
    expect(res.status).toBe(200);
    expect(user(ANA).roles).not.toContain('ADMIN');
    // Mesmo com a regra desligada, o Super Admin continua protegido.
    expect((await call('DELETE', `/admin/users/${RAFAEL}/roles/ADMIN`)).status).toBe(403);
  });

  it('o Super Admin remove qualquer Admin direto; ninguém remove o próprio papel', async () => {
    as(ANA);
    expect((await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`)).status).toBe(403);
    as(RAFAEL);
    expect((await call('DELETE', `/admin/users/${ANA}/roles/ADMIN`)).status).toBe(200);
    expect(user(ANA).roles).not.toContain('ADMIN');
  });

  it('conceder papel exige conta ativa com e-mail confirmado e não duplica', async () => {
    as(ANA);
    expect((await call('POST', `/admin/users/${CAMILA}/roles`, { role: 'ORGANIZER' })).code).toBe('ROLE_ALREADY_GRANTED');
    mutate(() => {
      user('u_p10').emailVerified = false;
    });
    expect((await call('POST', '/admin/users/u_p10/roles', { role: 'ADMIN' })).code).toBe('EMAIL_NOT_VERIFIED');
    const granted = await call('POST', '/admin/users/u_p11/roles', { role: 'ADMIN', reason: 'Novo moderador' });
    expect(AdminUserDetail.parse(granted.data).roles).toContain('ADMIN');
    expect(lastAudit('ROLE_GRANTED')).toMatchObject({ actorId: ANA, entityId: 'u_p11', after: { papel: 'ADMIN' }, reason: 'Novo moderador' });
  });
});

// ── Organizadores (RN-09, RN-10) e pedidos ───────────────────────────
describe('organizadores e pedidos', () => {
  it('lista com selo, limites e número de campeonatos ativos', async () => {
    as(ANA);
    const page = numberedPage(AdminOrganizer).parse((await call('GET', '/admin/organizers')).data);
    const camila = page.items.find((o) => o.id === CAMILA);
    const diego = page.items.find((o) => o.id === DIEGO);
    expect(camila).toMatchObject({ verifiedOrganizer: true, activeTournaments: 3, totalTournaments: 4, organizerLimits: { maxActiveTournaments: 10 } });
    expect(diego).toMatchObject({ verifiedOrganizer: false, activeTournaments: 2, organizerLimits: { maxActiveTournaments: 3 } });
  });

  it('altera limite, jogos permitidos e selo verificado, com antes e depois na auditoria', async () => {
    as(ANA);
    const res = await call('PATCH', `/admin/users/${DIEGO}/organizer-limits`, { maxActiveTournaments: 6, allowedGameIds: ['g_8ball', 'g_efootball'], verified: true });
    expect(AdminOrganizer.parse(res.data)).toMatchObject({ verifiedOrganizer: true, organizerLimits: { maxActiveTournaments: 6, allowedGameIds: ['g_8ball', 'g_efootball'] } });
    expect(lastAudit('ORGANIZER_LIMITS_CHANGED')).toMatchObject({
      actorId: ANA,
      entityId: DIEGO,
      before: { simultaneos: 3, jogos: 'todos', verificado: false },
      after: { simultaneos: 6, jogos: ['8 Ball Pool', 'eFootball'], verificado: true },
    });
    expect((await call('PATCH', `/admin/users/${DIEGO}/organizer-limits`, { maxActiveTournaments: 6, allowedGameIds: ['g_inexistente'], verified: true })).status).toBe(400);
    expect((await call('PATCH', `/admin/users/${BIANCA}/organizer-limits`, { maxActiveTournaments: 1, allowedGameIds: [], verified: false })).status).toBe(409);
  });

  it('revogar organizador aplica a RN-09: co-organizador mais antigo assume; sem co-organizador, pausa e vai para "Sem responsável"', async () => {
    mutate((d) => {
      d.staff.push({ tournamentId: 'tn_copa_ff', userId: 'u_p08', role: 'CO_ORGANIZER', addedAt: new Date(Date.now() - DAY).toISOString() });
      d.staff.push({ tournamentId: 'tn_copa_ff', userId: 'u_p07', role: 'CO_ORGANIZER', addedAt: new Date(Date.now() - 5 * DAY).toISOString() });
    });
    as(ANA);
    const res = await call('DELETE', `/admin/users/${CAMILA}/roles/ORGANIZER`, { reason: 'Descumpriu as regras da plataforma' });
    expect(res.status, res.detail).toBe(200);
    const result = RoleRevokeResult.parse(res.data);
    expect(result.outcome).toBe('REVOKED');
    expect(Object.fromEntries(result.affectedTournaments.map((t) => [t.id, t.outcome]))).toEqual({ tn_copa_ff: 'TRANSFERRED', tn_liga_cr: 'PAUSED', tn_ff_solo: 'PAUSED' });

    const t = (id: string) => db().tournaments.find((x) => x.id === id);
    // Co-organizador mais antigo (u_p07) assume e sai da lista de staff; o moderador não assume nada.
    expect(t('tn_copa_ff')).toMatchObject({ ownerId: 'u_p07', status: 'REGISTRATION_OPEN' });
    expect(db().staff.filter((s) => s.tournamentId === 'tn_copa_ff').map((s) => s.userId).sort()).toEqual(['u_p06', 'u_p08']);
    // Sem co-organizador: pausado e na fila.
    expect(t('tn_liga_cr')).toMatchObject({ ownerId: CAMILA, status: 'PAUSED' });
    expect(t('tn_ff_solo')).toMatchObject({ ownerId: CAMILA, status: 'PAUSED' });
    // Rascunho fica com a dona; campeonatos de outro organizador não mudam.
    expect(t('tn_cr_2v2')).toMatchObject({ ownerId: CAMILA, status: 'DRAFT' });
    expect(t('tn_efootball')).toMatchObject({ ownerId: DIEGO, status: 'REGISTRATION_OPEN' });

    expect(user(CAMILA).roles).toEqual(['PARTICIPANT']);
    expect(user(CAMILA).verifiedOrganizer).toBe(false);
    expect(lastAudit('ROLE_REVOKED')).toMatchObject({ actorId: ANA, entityId: CAMILA, reason: 'Descumpriu as regras da plataforma' });
    expect(lastAudit('TOURNAMENT_OWNER_CHANGED')).toMatchObject({ tournamentId: 'tn_copa_ff', before: { responsavel: 'Camila' }, after: { ownerId: 'u_p07' } });
    expect(auditLogs().filter((l) => l.action === 'TOURNAMENT_STATUS_CHANGED' && l.after?.semResponsavel === true).map((l) => l.tournamentId).sort()).toEqual(['tn_ff_solo', 'tn_liga_cr']);
    // O Admin é notificado.
    expect(notifications().some((n) => n.userId === RAFAEL && n.title.includes('sem responsável'))).toBe(true);

    const orphans = numberedPage(AdminTournament).parse((await call('GET', '/admin/tournaments?orphan=true')).data);
    expect(orphans.items.map((x) => x.id).sort()).toEqual(['tn_ff_solo', 'tn_liga_cr']);
    expect(orphans.items.every((x) => !x.hasOwner)).toBe(true);

    // Dar um responsável tira o campeonato da fila.
    const fixed = await call('POST', '/admin/tournaments/tn_liga_cr/owner', { ownerId: DIEGO, reason: 'Diego assume a liga' });
    expect(AdminTournament.parse(fixed.data)).toMatchObject({ ownerId: DIEGO, hasOwner: true });
    expect(numberedPage(AdminTournament).parse((await call('GET', '/admin/tournaments?orphan=true')).data).items.map((x) => x.id)).toEqual(['tn_ff_solo']);
  });

  it('banir um organizador também aplica a RN-09', async () => {
    as(ANA);
    const res = SanctionResult.parse((await call('POST', `/admin/users/${DIEGO}/sanctions`, { type: 'BAN', reason: 'Fraude em premiação' })).data);
    expect(res.affectedTournaments.map((t) => [t.id, t.outcome]).sort()).toEqual([
      ['tn_contra_squad', 'PAUSED'],
      ['tn_efootball', 'PAUSED'],
    ]);
    // Finalizado e cancelado continuam como estavam.
    expect(db().tournaments.find((t) => t.id === 'tn_open_8ball')?.status).toBe('FINISHED');
    expect(db().tournaments.find((t) => t.id === 'tn_8ball_verao')?.status).toBe('CANCELLED');
  });

  it('fila de pedidos: recusar sem motivo é 400; recusar com motivo notifica e não concede papel', async () => {
    as(ANA);
    const queue = z.array(AdminOrganizerRequest).parse((await call('GET', '/admin/organizer-requests?status=PENDING')).data);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ id: 'or_1', userId: 'u_p05', status: 'PENDING', tournamentsPlayed: 2, sanctions: 0 });
    expect(queue[0]?.justification).toContain('Free Fire');

    expect((await call('PATCH', '/admin/organizer-requests/or_1', { action: 'reject' })).status).toBe(400);
    expect((await call('PATCH', '/admin/organizer-requests/or_1', { action: 'reject', reason: 'x' })).status).toBe(400);
    expect(db().organizerRequests[0]?.status).toBe('PENDING');

    const res = await call('PATCH', '/admin/organizer-requests/or_1', { action: 'reject', reason: 'Conta muito nova, tente de novo em 30 dias' });
    expect(AdminOrganizerRequest.parse(res.data)).toMatchObject({ status: 'REJECTED', reviewReason: 'Conta muito nova, tente de novo em 30 dias' });
    expect(user('u_p05').roles).toEqual(['PARTICIPANT']);
    expect(notifications().some((n) => n.userId === 'u_p05' && n.type === 'ORGANIZER_REQUEST_RESULT' && n.title === 'Pedido de organizador recusado')).toBe(true);
    expect(lastAudit('ORGANIZER_REQUEST_REVIEWED')).toMatchObject({ actorId: ANA, after: { situacao: 'REJECTED' }, reason: 'Conta muito nova, tente de novo em 30 dias' });
    expect((await call('PATCH', '/admin/organizer-requests/or_1', { action: 'approve' })).status).toBe(409);
  });

  it('aprovar (motivo opcional) concede ORGANIZER com o limite padrão e notifica', async () => {
    as(ANA);
    const res = await call('PATCH', '/admin/organizer-requests/or_1', { action: 'approve' });
    expect(res.status, res.detail).toBe(200);
    expect(user('u_p05').roles).toContain('ORGANIZER');
    expect(user('u_p05').organizerLimits).toEqual({ maxActiveTournaments: 3, allowedGameIds: [] });
    expect(notifications().some((n) => n.userId === 'u_p05' && n.type === 'ORGANIZER_REQUEST_RESULT' && n.title === 'Pedido de organizador aprovado' && n.link === '/organizador')).toBe(true);
    expect(lastAudit('ORGANIZER_REQUEST_REVIEWED')).toMatchObject({ after: { situacao: 'APPROVED' } });
    expect(lastAudit('ROLE_GRANTED')).toMatchObject({ entityId: 'u_p05', after: { papel: 'ORGANIZER', limite: 3 } });
    // O novo organizador entra na área dele.
    as('u_p05');
    expect((await call('GET', '/organizer/tournaments')).status).toBe(200);
  });
});

// ── Campeonatos e comunicados ────────────────────────────────────────
describe('campeonatos: visão global', () => {
  it('lista todos, inclusive rascunhos e cancelados, com busca e filtro de status', async () => {
    as(ANA);
    const Page = numberedPage(AdminTournament);
    const all = Page.parse((await call('GET', '/admin/tournaments')).data);
    expect(all.total).toBe(8);
    expect(all.items.find((t) => t.id === 'tn_cr_2v2')?.status).toBe('DRAFT');
    expect(Page.parse((await call('GET', '/admin/tournaments?status=CANCELLED')).data).items.map((t) => t.id)).toEqual(['tn_8ball_verao']);
    expect(Page.parse((await call('GET', '/admin/tournaments?q=clash')).data).items.map((t) => t.id).sort()).toEqual(['tn_cr_2v2', 'tn_liga_cr']);
    expect(Page.parse((await call('GET', '/admin/tournaments?q=diego')).data).total).toBe(4);
  });

  it('destacar na home: só campeonato público', async () => {
    as(ANA);
    expect((await call('PATCH', '/admin/tournaments/tn_cr_2v2', { featured: true })).status).toBe(409);
    const res = await call('PATCH', '/admin/tournaments/tn_efootball', { featured: true });
    expect(AdminTournament.parse(res.data).featured).toBe(true);
    expect(lastAudit('TOURNAMENT_FEATURED')).toMatchObject({ actorId: ANA, tournamentId: 'tn_efootball', before: { featured: false }, after: { featured: true } });
    // Repetir o mesmo valor não gera ruído na auditoria.
    await call('PATCH', '/admin/tournaments/tn_efootball', { featured: true });
    expect(auditCount('TOURNAMENT_FEATURED')).toBe(1);
  });

  it('trocar o responsável: o novo dono precisa ser organizador; fica na auditoria com antes e depois', async () => {
    as(ANA);
    expect((await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: BIANCA, reason: 'Tentativa com participante' })).code).toBe('NOT_ORGANIZER');
    expect((await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: CAMILA, reason: 'Mesma dona de antes' })).code).toBe('SAME_OWNER');
    expect((await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: DIEGO })).status).toBe(400);
    const res = await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: DIEGO, reason: 'Camila pediu para sair da organização' });
    expect(AdminTournament.parse(res.data)).toMatchObject({ ownerId: DIEGO, ownerNickname: 'Diego' });
    expect(lastAudit('TOURNAMENT_OWNER_CHANGED')).toMatchObject({
      actorId: ANA,
      tournamentId: 'tn_copa_ff',
      before: { ownerId: CAMILA, responsavel: 'Camila' },
      after: { ownerId: DIEGO, responsavel: 'Diego' },
      reason: 'Camila pediu para sair da organização',
    });
    // O novo dono passa a gerenciar; a antiga dona perde o acesso.
    as(DIEGO);
    expect((await call('GET', '/tournaments/tn_copa_ff/audit-logs')).status).toBe(200);
    as(CAMILA);
    expect((await call('GET', '/tournaments/tn_copa_ff/audit-logs')).status).toBe(403);
  });

  it('cancelar exige motivo; arquivar só finalizado ou cancelado', async () => {
    as(ANA);
    expect((await call('POST', '/admin/tournaments/tn_liga_cr/cancel', {})).status).toBe(400);
    expect((await call('POST', '/admin/tournaments/tn_liga_cr/archive')).status).toBe(409);
    const cancelled = await call('POST', '/admin/tournaments/tn_liga_cr/cancel', { reason: 'Organização abandonou o evento' });
    expect(AdminTournament.parse(cancelled.data).status).toBe('CANCELLED');
    expect(lastAudit('TOURNAMENT_STATUS_CHANGED')).toMatchObject({ before: { status: 'IN_PROGRESS' }, after: { status: 'CANCELLED' }, reason: 'Organização abandonou o evento' });
    expect((await call('POST', '/admin/tournaments/tn_liga_cr/cancel', { reason: 'De novo, sem efeito' })).status).toBe(409);
    expect((await call('POST', '/admin/tournaments/tn_open_8ball/cancel', { reason: 'Já terminou, não cancela' })).status).toBe(409);

    const archived = await call('POST', '/admin/tournaments/tn_liga_cr/archive');
    expect(AdminTournament.parse(archived.data).status).toBe('ARCHIVED');
    expect(lastAudit('TOURNAMENT_STATUS_CHANGED')).toMatchObject({ before: { status: 'CANCELLED' }, after: { status: 'ARCHIVED' } });
    // Quem acompanha a página pública fica sabendo o motivo do cancelamento.
    expect(db().announcements.some((a) => a.tournamentId === 'tn_liga_cr' && a.title === 'Campeonato cancelado')).toBe(true);
  });

  it('lista as fases travadas e destravar (com motivo) tira da lista', async () => {
    as(ANA);
    const locked = z.array(LockedStage).parse((await call('GET', '/admin/tournaments/tn_liga_cr/locked-stages')).data);
    expect(locked).toEqual([{ stageId: 'tn_liga_cr_s1', stageName: 'Mata-mata', tournamentId: 'tn_liga_cr', tournamentName: 'Liga Semanal Clash Royale 1v1', completedMatches: 10 }]);
    expect(z.array(LockedStage).parse((await call('GET', '/admin/tournaments/tn_copa_ff/locked-stages')).data)).toEqual([]);
    expect((await call('POST', '/stages/tn_liga_cr_s1/unlock', {})).status).toBe(400);
    expect((await call('POST', '/stages/tn_liga_cr_s1/unlock', { reason: 'Erro de inscrição descoberto' })).status).toBe(200);
    expect(lastAudit('BRACKET_UNLOCKED')).toMatchObject({ actorId: ANA, reason: 'Erro de inscrição descoberto' });
    expect((await call('GET', '/admin/tournaments/tn_liga_cr/locked-stages')).data).toEqual([]);
  });
});

describe('comunicados globais e aviso no topo do site', () => {
  const Banners = z.array(SiteBannerItem);
  const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
  const publicBanners = async () => {
    as(null);
    return Banners.parse((await call('GET', '/site/banner')).data);
  };

  it('banner aparece para todos e some quando é desativado', async () => {
    expect(await publicBanners()).toEqual([]);
    as(ANA);
    const created = GlobalAnnouncement.parse((await call('POST', '/admin/announcements', banner)).data);
    expect(created).toMatchObject({ active: true, authorNickname: 'Ana', kind: 'BANNER' });
    expect(lastAudit('ANNOUNCEMENT_SENT')).toMatchObject({ actorId: ANA, entityId: created.id, after: { tipo: 'BANNER', publico: 'Todos' } });
    expect(await publicBanners()).toEqual([{ id: created.id, kind: 'BANNER', title: 'Novidade na Arena', body: 'Ranking por jogo no ar.', startsAt: null, endsAt: null, ongoing: false, dismissible: true }]);

    as(ANA);
    expect(GlobalAnnouncement.parse((await call('PATCH', `/admin/announcements/${created.id}`, { active: false })).data).active).toBe(false);
    expect(lastAudit('ANNOUNCEMENT_TOGGLED')).toMatchObject({ before: { active: true }, after: { active: false } });
    expect(await publicBanners()).toEqual([]);
  });

  it('manutenção exige início e fim, aparece 48 h antes e não pode ser dispensada enquanto acontece', async () => {
    as(ANA);
    const maintenance = { title: 'Manutenção programada', body: 'O site fica fora do ar por 1 hora.', kind: 'MAINTENANCE', audience: 'ALL', gameId: null };
    expect((await call('POST', '/admin/announcements', { ...maintenance, startsAt: null, endsAt: null })).status).toBe(400);
    expect((await call('POST', '/admin/announcements', { ...maintenance, startsAt: iso(2 * HOUR), endsAt: iso(HOUR) })).status).toBe(400);

    const far = GlobalAnnouncement.parse((await call('POST', '/admin/announcements', { ...maintenance, title: 'Manutenção distante', startsAt: iso(72 * HOUR), endsAt: iso(73 * HOUR) })).data);
    const soon = GlobalAnnouncement.parse((await call('POST', '/admin/announcements', { ...maintenance, startsAt: iso(24 * HOUR), endsAt: iso(25 * HOUR) })).data);
    let shown = await publicBanners();
    // Só a que começa em menos de 48 h aparece, e ainda dá para dispensar.
    expect(shown.map((b) => b.id)).toEqual([soon.id]);
    expect(shown[0]).toMatchObject({ kind: 'MAINTENANCE', ongoing: false, dismissible: true });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * HOUR + 10 * 60_000);
    shown = await publicBanners();
    expect(shown.find((b) => b.id === soon.id)).toMatchObject({ ongoing: true, dismissible: false });
    expect(shown.find((b) => b.id === far.id)).toMatchObject({ ongoing: false, dismissible: true });

    vi.setSystemTime(Date.now() + 2 * HOUR);
    expect((await publicBanners()).map((b) => b.id)).toEqual([far.id]);
  });

  it('notificação vai só para o público-alvo e não vira banner', async () => {
    as(ANA);
    const before = notifications().length;
    const res = await call('POST', '/admin/announcements', { title: 'Novo limite de campeonatos', body: 'Organizadores verificados agora podem ter 10 campeonatos.', kind: 'NOTIFICATION', audience: 'ORGANIZERS', gameId: null, startsAt: null, endsAt: null });
    expect(GlobalAnnouncement.parse(res.data).active).toBe(false);
    const sent = notifications().slice(before);
    expect(sent.map((n) => n.userId).sort()).toEqual([CAMILA, DIEGO]);
    expect(sent.every((n) => n.type === 'ANNOUNCEMENT' && n.title === 'Novo limite de campeonatos')).toBe(true);
    expect(lastAudit('ANNOUNCEMENT_SENT')).toMatchObject({ after: { tipo: 'NOTIFICATION', publico: 'Organizadores', destinatarios: 2 } });
    expect(await publicBanners()).toEqual([]);
    as(ANA);
    expect((await call('PATCH', `/admin/announcements/${GlobalAnnouncement.parse(res.data).id}`, { active: true })).status).toBe(409);
  });

  it('público "inscritos de um jogo": só quem joga ou segue o jogo vê o banner', async () => {
    as(ANA);
    expect((await call('POST', '/admin/announcements', { ...banner, audience: 'GAME', gameId: null })).status).toBe(400);
    const created = await call('POST', '/admin/announcements', { ...banner, title: 'Temporada de eFootball', audience: 'GAME', gameId: 'g_efootball' });
    expect(created.status).toBe(201);
    expect(await publicBanners()).toEqual([]);
    as('u_p30'); // inscrito na Copa eFootball
    expect(Banners.parse((await call('GET', '/site/banner')).data)).toHaveLength(1);
    as('u_lucas'); // não joga eFootball
    expect(Banners.parse((await call('GET', '/site/banner')).data)).toEqual([]);
  });
});

// ── Auditoria ────────────────────────────────────────────────────────
describe('auditoria: consulta, filtros, CSV e somente leitura', () => {
  async function seedLogs(): Promise<void> {
    as(ANA);
    await call('POST', `/admin/users/${BIANCA}/sanctions`, { type: 'WARNING', reason: 'Nick ofensivo' });
    await call('PATCH', '/admin/tournaments/tn_efootball', { featured: true });
    as(RAFAEL);
    await call('PUT', '/admin/flags/ranking', { enabled: false });
    await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: DIEGO, reason: '=CMD("calc") tentativa de fórmula' });
  }

  it('lista do mais recente para o mais antigo, com rótulo da ação e filtros', async () => {
    await seedLogs();
    as(ANA);
    const Page = numberedPage(AuditLog);
    const all = Page.parse((await call('GET', '/admin/audit-logs')).data);
    expect(all.total).toBe(4);
    expect(all.items.map((l) => l.action)).toEqual(['TOURNAMENT_OWNER_CHANGED', 'FLAG_CHANGED', 'TOURNAMENT_FEATURED', 'USER_SANCTIONED']);
    expect(all.items[0]).toMatchObject({ actorNickname: 'Rafael', actionLabel: 'Responsável do campeonato trocado', entityLabel: 'Copa Nova FF — Squad', ip: '203.0.113.10' });

    expect(Page.parse((await call('GET', '/admin/audit-logs?action=FLAG_CHANGED')).data).items.map((l) => l.entityId)).toEqual(['ranking']);
    expect(Page.parse((await call('GET', '/admin/audit-logs?actor=ana')).data).total).toBe(2);
    expect(Page.parse((await call('GET', `/admin/audit-logs?actor=${RAFAEL}`)).data).total).toBe(2);
    expect(Page.parse((await call('GET', '/admin/audit-logs?entityType=Tournament')).data).total).toBe(2);
    expect(Page.parse((await call('GET', '/admin/audit-logs?tournamentId=tn_copa_ff')).data).total).toBe(1);
    expect(Page.parse((await call('GET', `/admin/audit-logs?entityId=${BIANCA}`)).data).total).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    expect(Page.parse((await call('GET', `/admin/audit-logs?from=${today}&to=${today}`)).data).total).toBe(4);
    expect(Page.parse((await call('GET', `/admin/audit-logs?to=${yesterday}`)).data).total).toBe(0);

    const meta = AuditMeta.parse((await call('GET', '/admin/audit-logs/meta')).data);
    expect(meta.actions).toContainEqual({ value: 'USER_SANCTIONED', label: 'Usuário sancionado' });
    expect(meta.entityTypes).toContain('Tournament');
  });

  it('exporta CSV com os filtros, BOM UTF-8 e ponto e vírgula, sem virar fórmula na planilha', async () => {
    await seedLogs();
    as(ANA);
    const res = await fetch('http://localhost:3000/api/v1/admin/audit-logs.csv?entityType=Tournament');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="auditoria-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Data (UTC);Quem;Ação;Recurso;Tipo;ID do recurso;Campeonato;Motivo;Antes;Depois;IP');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(';Rafael;Responsável do campeonato trocado;Copa Nova FF — Squad;Campeonato;tn_copa_ff;tn_copa_ff;');
    // Motivo que começa com "=" ganha apóstrofo; aspas internas são duplicadas.
    expect(lines[1]).toContain(`"'=CMD(""calc"") tentativa de fórmula"`);
    expect(lines[2]).toContain(';Ana;Destaque na home alterado;');
  });

  it('é somente leitura: não existe rota para alterar ou apagar um registro', async () => {
    await seedLogs();
    const id = auditLogs()[0]?.id ?? 'x';
    const snapshot = JSON.stringify(auditLogs());

    // 1) Nenhum handler registrado em caminho de auditoria aceita outro método além de GET.
    const auditRoutes = enabledHandlers('all')
      .map((h) => h.info as { method: string; path: string })
      .filter((info) => String(info.path).includes('audit'));
    expect(auditRoutes.length).toBeGreaterThanOrEqual(4);
    expect(auditRoutes.filter((info) => String(info.method).toUpperCase() !== 'GET')).toEqual([]);

    // 2) Tentar mesmo assim não encontra rota nenhuma (a requisição nem é atendida) e nada muda.
    as(RAFAEL);
    for (const [method, path] of [
      ['DELETE', `/admin/audit-logs/${id}`],
      ['PATCH', `/admin/audit-logs/${id}`],
      ['PUT', `/admin/audit-logs/${id}`],
      ['DELETE', '/admin/audit-logs'],
      ['POST', '/admin/audit-logs'],
      ['DELETE', '/tournaments/tn_copa_ff/audit-logs'],
    ] as const) {
      await expect(call(method, path, method === 'DELETE' ? undefined : { reason: 'apagar rastro' }), `${method} ${path}`).rejects.toThrow();
    }
    expect(JSON.stringify(auditLogs())).toBe(snapshot);
  });

  it('organizador consulta só os logs dos próprios campeonatos (PRD §6, nota 2)', async () => {
    await seedLogs();
    as(CAMILA);
    await call('POST', '/tournaments/tn_ff_solo/open-registration');
    const Page = numberedPage(AuditLog);
    expect((await call('GET', '/admin/audit-logs')).status).toBe(403);
    const own = await call('GET', '/tournaments/tn_ff_solo/audit-logs');
    expect(own.status).toBe(200);
    expect(Page.parse(own.data).items.every((l) => l.tournamentId === 'tn_ff_solo')).toBe(true);
    // O filtro de campeonato não pode ser trocado pela query string.
    const forced = Page.parse((await call('GET', '/tournaments/tn_ff_solo/audit-logs?tournamentId=tn_efootball')).data);
    expect(forced.items.every((l) => l.tournamentId === 'tn_ff_solo')).toBe(true);
    // Campeonato de outro organizador: 403. Participante: 403. Visitante: 401. Admin: 200.
    expect((await call('GET', '/tournaments/tn_efootball/audit-logs')).status).toBe(403);
    as(BIANCA);
    expect((await call('GET', '/tournaments/tn_ff_solo/audit-logs')).status).toBe(403);
    as(null);
    expect((await call('GET', '/tournaments/tn_ff_solo/audit-logs')).status).toBe(401);
    as(ANA);
    const admin = Page.parse((await call('GET', '/tournaments/tn_efootball/audit-logs')).data);
    expect(admin.items.map((l) => l.action)).toEqual(['TOURNAMENT_FEATURED']);
    // Moderador do evento não vê a auditoria.
    as('u_p06');
    expect((await call('GET', '/tournaments/tn_copa_ff/audit-logs')).status).toBe(403);
  });
});

// ── Moderação ────────────────────────────────────────────────────────
describe('moderação: denúncias e disputas escaladas', () => {
  it('fila com as abertas primeiro e quem responde pelo alvo', async () => {
    as(ANA);
    const page = numberedPage(AdminReport).parse((await call('GET', '/admin/reports')).data);
    expect(page.total).toBe(reports().length);
    expect(page.items[0]?.status).toBe('OPEN');
    const open = numberedPage(AdminReport).parse((await call('GET', '/admin/reports?status=OPEN')).data);
    expect(open.items.every((r) => r.status === 'OPEN')).toBe(true);
    const squad = open.items.find((r) => r.id === 'rp_demo_2');
    // Denúncia de squad: quem responde é o capitão.
    expect(squad).toMatchObject({ targetType: 'TEAM', targetUserId: db().teams.find((t) => t.id === 't_2')?.captainId, targetUserStatus: 'ACTIVE' });
  });

  it('ação rápida: sancionar a partir da denúncia fecha a denúncia e audita as duas coisas', async () => {
    as(ANA);
    const report = reports().find((r) => r.id === 'rp_demo_2');
    const target = report?.targetOwnerUserId ?? '';
    const res = await call('POST', `/admin/users/${target}/sanctions`, { type: 'SUSPENSION', days: 7, reason: 'Uso de emulador confirmado', reportId: 'rp_demo_2' });
    expect(res.status, res.detail).toBe(201);
    expect(SanctionResult.parse(res.data).sanction.reportId).toBe('rp_demo_2');
    expect(report).toMatchObject({ status: 'ACTIONED', handledByNickname: 'Ana', resolution: 'Suspensão aplicada: Uso de emulador confirmado' });
    expect(user(target).status).toBe('SUSPENDED');
    expect(lastAudit('USER_SANCTIONED')).toMatchObject({ entityId: target, after: { denuncia: 'rp_demo_2' } });
    expect(lastAudit('REPORT_HANDLED')).toMatchObject({ entityId: 'rp_demo_2', before: { status: 'OPEN' }, after: { status: 'ACTIONED' } });
    expect((await call('POST', `/admin/users/${target}/sanctions`, { type: 'WARNING', reason: 'Denúncia inexistente', reportId: 'rp_nao_existe' })).status).toBe(400);
  });

  it('marcar como improcedente exige a explicação e avisa quem denunciou', async () => {
    as(ANA);
    expect((await call('PATCH', '/admin/reports/rp_demo_2', { status: 'DISMISSED' })).status).toBe(400);
    const review = await call('PATCH', '/admin/reports/rp_demo_2', { status: 'IN_REVIEW' });
    expect(AdminReport.parse(review.data).status).toBe('IN_REVIEW');
    const res = await call('PATCH', '/admin/reports/rp_demo_2', { status: 'DISMISSED', resolution: 'As gravações não mostram uso de emulador.' });
    expect(AdminReport.parse(res.data)).toMatchObject({ status: 'DISMISSED', handledByNickname: 'Ana', resolution: 'As gravações não mostram uso de emulador.' });
    expect(lastAudit('REPORT_HANDLED')).toMatchObject({ actorId: ANA, before: { status: 'IN_REVIEW' }, after: { status: 'DISMISSED' }, reason: 'As gravações não mostram uso de emulador.' });
    expect(notifications().some((n) => n.userId === 'u_lucas' && n.title === 'Sua denúncia foi considerada improcedente')).toBe(true);
    expect((await call('PATCH', '/admin/reports/nao-existe', { status: 'IN_REVIEW' })).status).toBe(404);
  });

  it('lista só as disputas escaladas', async () => {
    const base: DbDispute = {
      id: 'dp_1',
      matchId: 'tn_liga_cr_s1~x',
      submissionId: null,
      tournamentId: 'tn_liga_cr',
      tournamentName: 'Liga Semanal Clash Royale 1v1',
      matchLabel: 'Quartas: A x B',
      openedByNickname: 'Bianca',
      reason: 'O placar enviado está invertido.',
      status: 'ESCALATED',
      resolution: null,
      messages: [],
      createdAt: new Date(Date.now() - HOUR).toISOString(),
      resolvedAt: null,
      stageId: 'tn_liga_cr_s1',
      openedByUserId: BIANCA,
      openedByRegistrationId: 'r_13',
      registrationIds: ['r_13', 'r_14'],
      escalatedAt: new Date().toISOString(),
      escalatedByUserId: CAMILA,
      resolvedByUserId: null,
      resultApplied: false,
    };
    mutate(() => {
      disputes().push(base, { ...base, id: 'dp_2', status: 'OPEN' }, { ...base, id: 'dp_3', status: 'RESOLVED', resolution: 'Placar corrigido.' });
    });
    as(ANA);
    const escalated = z.array(Dispute).parse((await call('GET', '/admin/disputes')).data);
    expect(escalated.map((d) => d.id)).toEqual(['dp_1']);
    expect(z.array(Dispute).parse((await call('GET', '/admin/disputes?status=OPEN')).data).map((d) => d.id)).toEqual(['dp_2']);
    const stats = AdminStats.parse((await call('GET', '/admin/stats')).data);
    expect(stats.openDisputes).toBe(2);
  });
});

// ── Configurações, flags e saúde ─────────────────────────────────────
describe('configurações, flags e saúde do sistema', () => {
  it('PUT /admin/settings: Admin comum → 403; Super Admin → 200, com antes e depois na auditoria', async () => {
    as(ANA);
    const current = SiteSettings.parse((await call('GET', '/admin/settings')).data);
    expect(current).toMatchObject({ siteName: 'Nova Arena', minAge: 16, requireApprovalForSeniorAdminRemoval: true });
    const next = { ...current, siteName: 'Nova Arena Beta', supportEmail: 'ajuda@novaarena.gg', termsHtml: '<p>Termos novos.</p>' };
    expect((await call('PUT', '/admin/settings', next)).status).toBe(403);
    expect(SiteSettings.parse((await call('GET', '/admin/settings')).data).siteName).toBe('Nova Arena');
    expect(auditCount('SETTINGS_CHANGED')).toBe(0);

    as(RAFAEL);
    expect((await call('PUT', '/admin/settings', { ...next, minAge: 10 })).status).toBe(400);
    const saved = await call('PUT', '/admin/settings', next);
    expect(saved.status, saved.detail).toBe(200);
    expect(SiteSettings.parse(saved.data).siteName).toBe('Nova Arena Beta');
    const log = lastAudit('SETTINGS_CHANGED');
    expect(log).toMatchObject({ actorId: RAFAEL, before: { siteName: 'Nova Arena', supportEmail: 'suporte@novaarena.gg' }, after: { siteName: 'Nova Arena Beta', supportEmail: 'ajuda@novaarena.gg', termsHtml: 'texto com 20 caracteres' } });
    // Só o que mudou entra no registro.
    expect(Object.keys(log?.after ?? {}).sort()).toEqual(['siteName', 'supportEmail', 'termsHtml']);
    // Salvar sem mudar nada não gera registro.
    await call('PUT', '/admin/settings', next);
    expect(auditCount('SETTINGS_CHANGED')).toBe(1);
  });

  it('GET /site/settings é público e não expõe regras internas', async () => {
    as(null);
    const res = await call('GET', '/site/settings');
    expect(res.status).toBe(200);
    const settings = PublicSiteSettings.parse(res.data);
    expect(settings.termsHtml).toContain('Termos de Uso');
    expect(settings.privacyHtml).toContain('Política de Privacidade');
    expect(res.data).not.toHaveProperty('requireApprovalForSeniorAdminRemoval');
  });

  it('flag alterada no painel muda GET /site/flags', async () => {
    as(null);
    expect(FeatureFlags.parse((await call('GET', '/site/flags')).data)).toEqual({ ranking: true, publicSignup: true, resultSubmission: true, pushNotifications: false });

    as(ANA);
    const flags = z.array(FeatureFlag).parse((await call('GET', '/admin/flags')).data);
    expect(flags.map((f) => f.key)).toEqual(['ranking', 'publicSignup', 'resultSubmission', 'pushNotifications']);
    expect((await call('PUT', '/admin/flags/ranking', { enabled: false })).status).toBe(403);

    as(RAFAEL);
    expect((await call('PUT', '/admin/flags/nao-existe', { enabled: false })).status).toBe(404);
    expect((await call('PUT', '/admin/flags/ranking', { enabled: 'não' })).status).toBe(400);
    const res = await call('PUT', '/admin/flags/ranking', { enabled: false });
    expect(FeatureFlag.parse(res.data)).toMatchObject({ key: 'ranking', enabled: false });
    expect(lastAudit('FLAG_CHANGED')).toMatchObject({ actorId: RAFAEL, entityId: 'ranking', before: { enabled: true }, after: { enabled: false } });

    as(null);
    expect(FeatureFlags.parse((await call('GET', '/site/flags')).data)).toMatchObject({ ranking: false, publicSignup: true });
    as(RAFAEL);
    await call('PUT', '/admin/flags/ranking', { enabled: true });
    as(null);
    expect(FeatureFlags.parse((await call('GET', '/site/flags')).data).ranking).toBe(true);
  });

  it('saúde do sistema: seis serviços, versão publicada e taxa de erro', async () => {
    as(ANA);
    const health = SystemHealth.parse((await call('GET', '/admin/health')).data);
    expect(health.services.map((s) => s.key)).toEqual(['database', 'cache', 'queues', 'realtime', 'storage', 'email']);
    expect(health.version).toBe('protótipo');
    expect(health.failedJobs).toBe(0);
    expect(health.errorRate).toBeGreaterThanOrEqual(0);
    expect(health.storageUsedMb).toBeGreaterThan(0);
  });
});

// ── 2FA ──────────────────────────────────────────────────────────────
describe('verificação em duas etapas (RNF-08)', () => {
  async function enable(id: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    as(id);
    const setup = TwoFactorSetup.parse((await call('POST', '/me/2fa/setup')).data);
    const res = await call('POST', '/me/2fa/enable', { code: await totp(setup.secret) });
    expect(res.status, res.detail).toBe(200);
    return { secret: setup.secret, recoveryCodes: TwoFactorEnabled.parse(res.data).recoveryCodes };
  }

  it('configura com segredo, endereço otpauth e QR code; só ativa com o código certo', async () => {
    as(BIANCA);
    expect(TwoFactorStatus.parse((await call('GET', '/me/2fa')).data)).toEqual({ enabled: false, required: false, recoveryCodesLeft: 0 });
    const setup = TwoFactorSetup.parse((await call('POST', '/me/2fa/setup')).data);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toBe(`otpauth://totp/Nova%20Arena:bianca%40novaarena.gg?secret=${setup.secret}&issuer=Nova%20Arena&algorithm=SHA1&digits=6&period=30`);
    expect(setup.qrSvg.startsWith('<svg')).toBe(true);

    const wrong = await call('POST', '/me/2fa/enable', { code: '000000' });
    // Chance de 3 em um milhão de "000000" ser o código do momento: tratamos como erro esperado.
    expect(wrong.status).toBe(400);
    expect(wrong.code).toBe('INVALID_CODE');
    expect(user(BIANCA).twoFactorEnabled).toBe(false);
    expect((await call('POST', '/me/2fa/enable', { code: '12345' })).status).toBe(400);

    const ok = await call('POST', '/me/2fa/enable', { code: await totp(setup.secret) });
    expect(ok.status, ok.detail).toBe(200);
    const { recoveryCodes } = TwoFactorEnabled.parse(ok.data);
    expect(recoveryCodes).toHaveLength(8);
    expect(new Set(recoveryCodes).size).toBe(8);
    expect(user(BIANCA).twoFactorEnabled).toBe(true);
    expect(((await call('GET', '/me')).data as Me).twoFactorEnabled).toBe(true);
    expect(TwoFactorStatus.parse((await call('GET', '/me/2fa')).data)).toEqual({ enabled: true, required: false, recoveryCodesLeft: 8 });
    expect(lastAudit('TWO_FACTOR_CHANGED')).toMatchObject({ actorId: BIANCA, entityId: BIANCA, after: { twoFactorEnabled: true } });
    // Segredo e códigos de recuperação nunca entram na auditoria.
    const logs = JSON.stringify(auditLogs());
    expect(logs).not.toContain(setup.secret);
    expect(logs).not.toContain(recoveryCodes[0]);
    expect((await call('POST', '/me/2fa/setup')).status).toBe(409);
  });

  it('aceita o código do passo anterior (janela de ±1) e recusa um código velho', async () => {
    as(BIANCA);
    const setup = TwoFactorSetup.parse((await call('POST', '/me/2fa/setup')).data);
    const old = await call('POST', '/me/2fa/enable', { code: await totp(setup.secret, { time: Date.now() - 5 * 60_000 }) });
    expect(old.status).toBe(400);
    const previous = await call('POST', '/me/2fa/enable', { code: await totp(setup.secret, { time: Date.now() - 30_000 }) });
    expect(previous.status).toBe(200);
  });

  it('participante desliga com o código do aplicativo ou com um código de recuperação', async () => {
    const first = await enable(BIANCA);
    expect((await call('POST', '/me/2fa/disable', { code: '000000' })).status).toBe(400);
    const off = await call('POST', '/me/2fa/disable', { code: await totp(first.secret) });
    expect(TwoFactorStatus.parse(off.data).enabled).toBe(false);
    expect(lastAudit('TWO_FACTOR_CHANGED')).toMatchObject({ actorId: BIANCA, after: { twoFactorEnabled: false } });

    const second = await enable(BIANCA);
    const recovery = second.recoveryCodes[0] ?? '';
    expect((await call('POST', '/me/2fa/disable', { code: recovery.toUpperCase() })).status).toBe(200);
    expect(user(BIANCA).twoFactorEnabled).toBe(false);
    expect((await call('POST', '/me/2fa/disable', { code: recovery })).status).toBe(409);
  });

  it('Admin não pode desligar: é obrigatória', async () => {
    as(ANA);
    expect(TwoFactorStatus.parse((await call('GET', '/me/2fa')).data)).toMatchObject({ enabled: true, required: true });
    const code = (await call<{ code: string }>('GET', '/me/2fa/dev-code')).data.code;
    expect(code).toMatch(/^\d{6}$/);
    const res = await call('POST', '/me/2fa/disable', { code });
    expect(res.status).toBe(403);
    expect(res.code).toBe('TWO_FACTOR_REQUIRED');
    expect(user(ANA).twoFactorEnabled).toBe(true);
  });

  it('quem vira Admin por convite fica bloqueado até configurar o 2FA', async () => {
    as(ANA);
    const { token } = await createInvite();
    as('u_p10');
    expect((await call('POST', `/role-invites/${token}/accept`)).status).toBe(200);
    const blocked = await call('GET', '/admin/stats');
    expect(blocked.status).toBe(403);
    expect(blocked.code).toBe('TWO_FACTOR_REQUIRED');
    await enable('u_p10');
    expect((await call('GET', '/admin/stats')).status).toBe(200);
  });

  it('redefinir o 2FA de alguém: só o Super Admin, com motivo, auditado', async () => {
    await enable(BIANCA);
    as(ANA);
    expect((await call('POST', `/admin/users/${BIANCA}/2fa/reset`, { reason: 'Perdeu o celular' })).status).toBe(403);
    as(RAFAEL);
    expect((await call('POST', `/admin/users/${BIANCA}/2fa/reset`, {})).status).toBe(400);
    expect((await call('POST', `/admin/users/${RAFAEL}/2fa/reset`, { reason: 'A própria conta' })).status).toBe(400);
    expect((await call('POST', '/admin/users/u_lucas/2fa/reset', { reason: 'Nunca ativou' })).status).toBe(409);
    const res = await call('POST', `/admin/users/${BIANCA}/2fa/reset`, { reason: 'Perdeu o celular e os códigos' });
    expect(TwoFactorStatus.parse(res.data).enabled).toBe(false);
    expect(user(BIANCA).twoFactorEnabled).toBe(false);
    expect(lastAudit('TWO_FACTOR_CHANGED')).toMatchObject({ actorId: RAFAEL, entityId: BIANCA, reason: 'Perdeu o celular e os códigos', before: { twoFactorEnabled: true }, after: { twoFactorEnabled: false } });
    expect(notifications().some((n) => n.userId === BIANCA && n.title === 'Verificação em duas etapas redefinida')).toBe(true);

    // Admin com 2FA redefinido perde o acesso ao painel até configurar de novo.
    expect((await call('POST', `/admin/users/${ANA}/2fa/reset`, { reason: 'Trocou de aparelho' })).status).toBe(200);
    as(ANA);
    expect((await call('GET', '/admin/stats')).code).toBe('TWO_FACTOR_REQUIRED');
  });
});

// ── Toda ação sensível gera auditoria ────────────────────────────────
describe('toda ação sensível grava auditoria (uma a uma)', () => {
  /** Roda a ação e confere que exatamente um registro novo daquela ação apareceu, com ator. */
  async function audited(action: string, actor: string, run: () => Promise<{ status: number; detail?: string }>): Promise<DbAuditLog> {
    const before = auditCount(action);
    as(actor);
    const res = await run();
    expect(res.status, `${action}: ${res.detail ?? ''}`).toBeLessThan(300);
    expect(auditCount(action), action).toBe(before + 1);
    const entry = lastAudit(action) as DbAuditLog;
    expect(entry.actorId, action).toBe(actor);
    expect(entry.entityId, action).not.toBe('');
    expect(entry.entityLabel, action).not.toBe('');
    return entry;
  }

  it('usuários, papéis, campeonatos, comunicados, moderação, configurações e 2FA', async () => {
    const warned = await audited('USER_SANCTIONED', ANA, () => call('POST', '/admin/users/u_p20/sanctions', { type: 'WARNING', reason: 'Nick ofensivo' }));
    expect(warned.reason).toBe('Nick ofensivo');
    const sanctionId = db().extra.sanctions?.length ? (db().extra.sanctions as Array<{ id: string }>)[0]?.id : '';
    await audited('SANCTION_LIFTED', ANA, () => call('DELETE', `/admin/sanctions/${sanctionId}`));
    await audited('USER_PASSWORD_RESET', ANA, () => call('POST', '/admin/users/u_p20/reset-password'));
    await audited('USERS_MERGED', ANA, () => call('POST', '/admin/users/u_p20/merge', { sourceUserId: 'u_p52', reason: 'Mesma pessoa, duas contas' }));

    const created = await audited('INVITE_CREATED', ANA, () => call('POST', '/admin/invites', { role: 'ORGANIZER', validity: '7d', maxUses: 3 }));
    await audited('INVITE_REVOKED', ANA, () => call('DELETE', `/admin/invites/${created.entityId}`));
    await audited('ROLE_GRANTED', ANA, () => call('POST', '/admin/users/u_p41/roles', { role: 'ORGANIZER' }));
    await audited('ORGANIZER_LIMITS_CHANGED', ANA, () => call('PATCH', '/admin/users/u_p41/organizer-limits', { maxActiveTournaments: 1, allowedGameIds: ['g_freefire'], verified: false }));
    await audited('ROLE_REVOKED', ANA, () => call('DELETE', '/admin/users/u_p41/roles/ORGANIZER', { reason: 'Pedido do próprio usuário' }));
    await audited('ORGANIZER_REQUEST_REVIEWED', ANA, () => call('PATCH', '/admin/organizer-requests/or_1', { action: 'reject', reason: 'Histórico insuficiente' }));

    await audited('TOURNAMENT_FEATURED', ANA, () => call('PATCH', '/admin/tournaments/tn_efootball', { featured: true }));
    await audited('TOURNAMENT_OWNER_CHANGED', ANA, () => call('POST', '/admin/tournaments/tn_efootball/owner', { ownerId: CAMILA, reason: 'Troca combinada' }));
    await audited('TOURNAMENT_STATUS_CHANGED', ANA, () => call('POST', '/admin/tournaments/tn_ff_solo/cancel', { reason: 'Evento duplicado' }));
    await audited('TOURNAMENT_STATUS_CHANGED', ANA, () => call('POST', '/admin/tournaments/tn_ff_solo/archive'));
    await audited('BRACKET_UNLOCKED', ANA, () => call('POST', '/stages/tn_liga_cr_s1/unlock', { reason: 'Erro de inscrição' }));

    const announcement = await audited('ANNOUNCEMENT_SENT', ANA, () => call('POST', '/admin/announcements', banner));
    await audited('ANNOUNCEMENT_TOGGLED', ANA, () => call('PATCH', `/admin/announcements/${announcement.entityId}`, { active: false }));
    await audited('REPORT_HANDLED', ANA, () => call('PATCH', '/admin/reports/rp_demo_2', { status: 'DISMISSED', resolution: 'Sem provas suficientes.' }));

    const settings = SiteSettings.parse((await call('GET', '/admin/settings')).data);
    await audited('SETTINGS_CHANGED', RAFAEL, () => call('PUT', '/admin/settings', { ...settings, minAge: 18 }));
    await audited('FLAG_CHANGED', RAFAEL, () => call('PUT', '/admin/flags/publicSignup', { enabled: false }));

    as(BIANCA);
    const setup = TwoFactorSetup.parse((await call('POST', '/me/2fa/setup')).data);
    await audited('TWO_FACTOR_CHANGED', BIANCA, async () => call('POST', '/me/2fa/enable', { code: await totp(setup.secret) }));
    await audited('TWO_FACTOR_CHANGED', RAFAEL, () => call('POST', `/admin/users/${BIANCA}/2fa/reset`, { reason: 'Perdeu o celular' }));

    // Todo registro tem ator, data e IP; nenhum guarda senha, token ou segredo.
    for (const log of auditLogs()) {
      expect(log.actorId).not.toBeNull();
      expect(Number.isNaN(new Date(log.createdAt).getTime())).toBe(false);
      expect(log.ip).not.toBe('');
    }
    const dump = JSON.stringify(auditLogs());
    expect(dump).not.toContain(setup.secret);
    expect(dump).not.toContain('arena1234');
  });

  it('ação recusada (sem permissão ou inválida) não deixa registro', async () => {
    as(BIANCA);
    await call('POST', '/admin/users/u_p20/sanctions', { type: 'BAN', reason: 'Sem permissão' });
    await call('PUT', '/admin/flags/ranking', { enabled: false });
    as(ANA);
    await call('POST', `/admin/users/${RAFAEL}/sanctions`, { type: 'BAN', reason: 'Sem permissão' });
    await call('PUT', '/admin/settings', {});
    await call('POST', '/admin/tournaments/tn_copa_ff/owner', { ownerId: BIANCA, reason: 'Não é organizadora' });
    await call('PATCH', '/admin/organizer-requests/or_1', { action: 'reject' });
    expect(auditLogs()).toEqual([]);
  });
});
