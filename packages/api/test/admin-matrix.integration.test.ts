/**
 * Matriz de permissões do painel Admin contra o Postgres (porta de `apps/web/mocks/handlers/admin.test.ts`,
 * "permissões: toda rota /admin/* exige Admin ou Super Admin"): cada rota × visitante, participante, organizador e
 * Admin → 401/403/403/2xx. Mais: Admin sem 2FA feito → 403 `TWO_FACTOR_REQUIRED`; Super Admin nas rotas só dele.
 *
 * Fora da matriz (de outra frente): `POST /admin/users/:id/2fa/reset` (#95).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { applyResult } from '@nova/engine';
import { GlobalAnnouncement, SanctionResult } from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readRun, snapshotOf } from '../src/competition/run';
import { createHarness, type Harness } from './fixtures/admin';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: () => string | Promise<string>;
  body?: unknown | (() => unknown);
  /** Status esperado para a Admin. Padrão: 200. */
  admin?: number;
  label: string;
}

describe.skipIf(!url)('matriz do painel Admin (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  const ids: Record<string, string> = {};
  const banner = { title: 'Novidade na Arena', body: 'Ranking por jogo no ar.', kind: 'BANNER', audience: 'ALL', gameId: null, startsAt: null, endsAt: null };

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 4 });
    h = createHarness(db, 'mx');
    for (const [key, roles] of [
      ['bianca', ['PARTICIPANT']],
      ['camila', ['ORGANIZER']],
      ['diego', ['ORGANIZER']],
      ['ana', ['ADMIN']],
      ['rafael', ['SUPER_ADMIN', 'ADMIN']],
      ['p20', []],
      ['p21', []],
      ['p22', []],
      ['p23', []],
      ['p52', []],
      ['p41', []],
      ['p05', []],
    ] as const) {
      ids[key] = (await h.makeUser(key, [...roles])).id;
    }
    await h.makeUser('ana2fa', ['ADMIN'], { tfa: false });

    const game = await db.game.create({
      data: { slug: `mx-${h.stamp}`, name: `Jogo MX ${h.stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    const base = { gameId: game.id, gameModeId: game.modes[0]?.id ?? '', participantType: 'SOLO' as const, maxParticipants: 8 };
    ids.efootball = (await db.tournament.create({ data: { ...base, slug: `mx-efoot-${h.stamp}`, name: 'Copa eFootball MX', ownerId: ids.diego as string, status: 'REGISTRATION_OPEN' } })).id;
    ids.ffSolo = (await db.tournament.create({ data: { ...base, slug: `mx-ffsolo-${h.stamp}`, name: 'FF Solo MX', ownerId: ids.camila as string, status: 'PUBLISHED' } })).id;
    ids.open8 = (await db.tournament.create({ data: { ...base, slug: `mx-open8-${h.stamp}`, name: 'Open 8 Ball MX', ownerId: ids.diego as string, status: 'FINISHED' } })).id;
    const liga = await db.tournament.create({ data: { ...base, slug: `mx-liga-${h.stamp}`, name: 'Liga MX', ownerId: ids.camila as string, status: 'REGISTRATION_CLOSED' } });
    ids.liga = liga.id;
    const stage = await db.stage.create({ data: { tournamentId: liga.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } });
    for (let i = 0; i < 4; i += 1) await db.registration.create({ data: { tournamentId: liga.id, displayName: `Time ${i + 1}`, status: 'CONFIRMED', createdAt: new Date(Date.now() + i) } });
    expect((await h.call('camila', 'POST', `/stages/${stage.id}/generate`, { seeding: 'RANDOM', seed: 'mx' })).status).toBe(200);
    expect((await h.call('camila', 'POST', `/stages/${stage.id}/confirm`)).status).toBe(200);
    const run = readRun(await db.stage.findUniqueOrThrow({ where: { id: stage.id } }));
    const first = run?.structure.matches.find((m) => m.round === 1 && m.slots.every((s) => s.entrantId));
    if (!run || !first) throw new Error('sem chave');
    const [x, y] = first.slots.map((s) => s.entrantId as string);
    const played = applyResult(run.structure, run.state, { matchId: first.id, entries: [{ entrantId: x as string, score: 2 }, { entrantId: y as string, score: 1 }] });
    await db.stage.update({ where: { id: stage.id }, data: { engineSnapshot: snapshotOf(played.structure, played.state) } });

    ids.invite = (await db.roleInvite.create({ data: { role: 'ADMIN', tokenHash: `mx-${h.stamp}`, maxUses: 2, expiresAt: new Date(Date.now() + 3600_000), createdById: ids.ana as string } })).id;
    ids.request = (await db.organizerRequest.create({ data: { userId: ids.p05 as string, justification: 'Organizo ligas de Free Fire há dois anos.' } })).id;
    ids.report = (await db.report.create({ data: { reporterId: ids.bianca as string, targetType: 'USER', targetId: ids.p20 as string, targetLabel: 'p20', reason: 'CHEATING', description: 'Usou emulador nas quedas.', targetOwnerUserId: ids.p20 as string } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const ROUTES: Route[] = [
    { label: 'GET /admin/stats', method: 'GET', path: () => '/admin/stats' },
    { label: 'GET /admin/metrics', method: 'GET', path: () => '/admin/metrics' },
    { label: 'GET /admin/users', method: 'GET', path: () => '/admin/users' },
    { label: 'GET /admin/users/:id', method: 'GET', path: () => `/admin/users/${ids.bianca}` },
    { label: 'POST /admin/users/:id/sanctions', method: 'POST', path: () => `/admin/users/${ids.p20}/sanctions`, body: { type: 'WARNING', reason: 'Linguagem ofensiva no chat' }, admin: 201 },
    {
      label: 'DELETE /admin/sanctions/:id',
      method: 'DELETE',
      path: async () => `/admin/sanctions/${SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${ids.p21}/sanctions`, { type: 'WARNING', reason: 'Linguagem ofensiva no chat' })).data).sanction.id}`,
    },
    { label: 'POST /admin/users/:id/reset-password', method: 'POST', path: () => `/admin/users/${ids.p22}/reset-password` },
    { label: 'POST /admin/users/:id/merge', method: 'POST', path: () => `/admin/users/${ids.p23}/merge`, body: () => ({ sourceUserId: ids.p52, reason: 'Mesma pessoa, duas contas' }) },
    { label: 'GET /admin/admins', method: 'GET', path: () => '/admin/admins' },
    { label: 'GET /admin/invites', method: 'GET', path: () => '/admin/invites' },
    { label: 'POST /admin/invites', method: 'POST', path: () => '/admin/invites', body: { role: 'ADMIN', validity: '24h', maxUses: 2 }, admin: 201 },
    { label: 'DELETE /admin/invites/:id', method: 'DELETE', path: () => `/admin/invites/${ids.invite}` },
    { label: 'POST /admin/users/:id/roles', method: 'POST', path: () => `/admin/users/${ids.p41}/roles`, body: { role: 'ORGANIZER' } },
    { label: 'DELETE /admin/users/:id/roles/:role', method: 'DELETE', path: () => `/admin/users/${ids.diego}/roles/ORGANIZER` },
    { label: 'GET /admin/admin-removal-requests', method: 'GET', path: () => '/admin/admin-removal-requests' },
    // Só o Super Admin decide o pedido de remoção (RN-11).
    { label: 'POST /admin/admin-removal-requests/:id/approve', method: 'POST', path: () => '/admin/admin-removal-requests/qualquer/approve', admin: 403 },
    { label: 'POST /admin/admin-removal-requests/:id/reject', method: 'POST', path: () => '/admin/admin-removal-requests/qualquer/reject', admin: 403 },
    { label: 'GET /admin/organizers', method: 'GET', path: () => '/admin/organizers' },
    { label: 'PATCH /admin/users/:id/organizer-limits', method: 'PATCH', path: () => `/admin/users/${ids.camila}/organizer-limits`, body: { maxActiveTournaments: 5, allowedGameIds: [], verified: true } },
    { label: 'GET /admin/organizer-requests', method: 'GET', path: () => '/admin/organizer-requests' },
    { label: 'PATCH /admin/organizer-requests/:id', method: 'PATCH', path: () => `/admin/organizer-requests/${ids.request}`, body: { action: 'approve' } },
    { label: 'GET /admin/tournaments', method: 'GET', path: () => '/admin/tournaments' },
    { label: 'PATCH /admin/tournaments/:id', method: 'PATCH', path: () => `/admin/tournaments/${ids.efootball}`, body: { featured: true } },
    { label: 'POST /admin/tournaments/:id/owner', method: 'POST', path: () => `/admin/tournaments/${ids.efootball}/owner`, body: () => ({ ownerId: ids.camila, reason: 'Diego pediu para sair' }) },
    { label: 'POST /admin/tournaments/:id/cancel', method: 'POST', path: () => `/admin/tournaments/${ids.ffSolo}/cancel`, body: { reason: 'Evento duplicado' } },
    { label: 'POST /admin/tournaments/:id/archive', method: 'POST', path: () => `/admin/tournaments/${ids.open8}/archive` },
    { label: 'GET /admin/tournaments/:id/locked-stages', method: 'GET', path: () => `/admin/tournaments/${ids.liga}/locked-stages` },
    { label: 'GET /admin/announcements', method: 'GET', path: () => '/admin/announcements' },
    { label: 'POST /admin/announcements', method: 'POST', path: () => '/admin/announcements', body: banner, admin: 201 },
    {
      label: 'PATCH /admin/announcements/:id',
      method: 'PATCH',
      path: async () => `/admin/announcements/${GlobalAnnouncement.parse((await h.call('ana', 'POST', '/admin/announcements', banner)).data).id}`,
      body: { active: false },
    },
    { label: 'GET /admin/audit-logs', method: 'GET', path: () => '/admin/audit-logs' },
    { label: 'GET /admin/audit-logs/meta', method: 'GET', path: () => '/admin/audit-logs/meta' },
    { label: 'GET /admin/audit-logs.csv', method: 'GET', path: () => `/admin/audit-logs.csv?tournamentId=${ids.liga}` },
    { label: 'GET /admin/reports', method: 'GET', path: () => '/admin/reports' },
    { label: 'PATCH /admin/reports/:id', method: 'PATCH', path: () => `/admin/reports/${ids.report}`, body: { status: 'IN_REVIEW' } },
    { label: 'GET /admin/disputes', method: 'GET', path: () => '/admin/disputes' },
    { label: 'GET /admin/settings', method: 'GET', path: () => '/admin/settings' },
    // Matriz do PRD §6: configurações globais são do Super Admin; o Admin só lê.
    { label: 'PUT /admin/settings', method: 'PUT', path: () => '/admin/settings', body: {}, admin: 403 },
    { label: 'GET /admin/flags', method: 'GET', path: () => '/admin/flags' },
    { label: 'PUT /admin/flags/:key', method: 'PUT', path: () => '/admin/flags/ranking', body: { enabled: false }, admin: 403 },
    { label: 'GET /admin/health', method: 'GET', path: () => '/admin/health' },
    { label: 'GET /admin/system/job-failures (outro módulo, mesma regra)', method: 'GET', path: () => '/admin/system/job-failures' },
  ];

  it('cobre todas as rotas /admin/* da especificação (menos o 2FA, de outra frente)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(42);
  });

  it.each(ROUTES.map((r) => [r.label, r] as const))('%s', async (_label, route) => {
    const path = await route.path();
    const payload = typeof route.body === 'function' ? (route.body as () => unknown)() : route.body;
    const status = async (who: string | null) => (await h.call(who, route.method, path, payload)).status;
    expect(await status(null), 'visitante').toBe(401);
    expect(await status('bianca'), 'participante').toBe(403);
    expect(await status('camila'), 'organizador').toBe(403);
    const admin = await h.call('ana', route.method, path, payload);
    expect(admin.status, `admin: ${JSON.stringify(admin.data).slice(0, 300)}`).toBe(route.admin ?? 200);
  });

  it('Admin sem a verificação em duas etapas feita na sessão recebe 403 TWO_FACTOR_REQUIRED', async () => {
    for (const path of ['/admin/stats', '/admin/users', '/admin/system/job-failures']) {
      const res = await h.call('ana2fa', 'GET', path);
      expect(res.status).toBe(403);
      expect(res.code).toBe('TWO_FACTOR_REQUIRED');
    }
    // Sem o papel, o 403 é o comum (não revela a regra do 2FA).
    expect((await h.call('bianca', 'GET', '/admin/stats')).code).toBe('FORBIDDEN');
  });

  it('o Super Admin passa nas rotas só dele (com corpo válido)', async () => {
    const settings = (await h.call('rafael', 'GET', '/admin/settings')).data as Record<string, unknown>;
    expect((await h.call('rafael', 'PUT', '/admin/settings', settings)).status).toBe(200);
    const flag = await h.call('rafael', 'PUT', '/admin/flags/ranking', { enabled: true });
    expect(flag.status).toBe(200);
    expect((await h.call('rafael', 'POST', '/admin/admin-removal-requests/qualquer/approve')).status).toBe(404);
    expect((await h.call('rafael', 'POST', '/admin/admin-removal-requests/qualquer/talvez')).status).toBe(404);
  });

  it('rota /admin/* inexistente não vaza para quem não é Admin', async () => {
    expect((await h.call(null, 'GET', '/admin/nao-existe')).status).toBe(401);
    expect((await h.call('bianca', 'GET', '/admin/nao-existe')).status).toBe(403);
    expect((await h.call('ana', 'GET', '/admin/nao-existe')).status).toBe(404);
  });
});
