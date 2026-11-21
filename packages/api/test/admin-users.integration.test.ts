/**
 * Usuários, sanções (CT-09), mescla (RN-13), convites (CT-03), papéis (RN-11) e organizadores (RN-09, RN-10) contra o
 * Postgres. Porta dos cenários de `apps/web/mocks/handlers/admin.test.ts`, com a auditoria conferida no banco.
 */
import { createDb, type PrismaClient } from '@nova/db';
import {
  AcceptRoleInviteResponse,
  AdminMember,
  AdminOrganizer,
  AdminOrganizerRequest,
  AdminRemovalRequest,
  AdminTournament,
  AdminUser,
  AdminUserDetail,
  MergeUsersResult,
  numberedPage,
  PasswordResetLink,
  RoleInvite,
  RoleInvitePreview,
  RoleRevokeResult,
  SanctionResult,
} from '@nova/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashPassword } from '../src/auth/crypto';
import { auditCount, createHarness, lastAudit, type Harness } from './fixtures/admin';

const url = process.env.TEST_DATABASE_URL;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe.skipIf(!url)('painel Admin: usuários, sanções, convites e papéis (Postgres)', () => {
  let db: PrismaClient;
  let h: Harness;
  let gameId = '';
  let modeId = '';
  const id = (key: string) => h.people.get(key)?.id ?? '';

  async function tournament(owner: string, status: 'DRAFT' | 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED' | 'PUBLISHED', name: string) {
    return db.tournament.create({ data: { slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${h.stamp}`, name, gameId, gameModeId: modeId, ownerId: id(owner), status, participantType: 'SOLO', maxParticipants: 16 } });
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 6 });
    h = createHarness(db, 'au', { CRON_SECRET: 'segredo-do-cron-de-teste' });
    const old = new Date(Date.now() - 365 * DAY);
    await h.makeUser('rafael', ['SUPER_ADMIN', 'ADMIN'], { createdAt: new Date(Date.now() - 400 * DAY) });
    await h.makeUser('ana', ['ADMIN'], { createdAt: old });
    await h.makeUser('bianca', []);
    await h.makeUser('camila', ['ORGANIZER']);
    await h.makeUser('diego', ['ORGANIZER']);
    for (const key of ['p01', 'p04', 'p05', 'p06', 'p07', 'p08', 'p10', 'p11', 'p12', 'p13', 'p14', 'p15', 'p44', 'p45']) await h.makeUser(key, []);
    const game = await db.game.create({ data: { slug: `au-${h.stamp}`, name: `Jogo AU ${h.stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    gameId = game.id;
    modeId = game.modes[0]?.id ?? '';
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  // ── Usuários ───────────────────────────────────────────────────────
  describe('usuários: busca, perfil e sanções', () => {
    it('lista paginada com busca por apelido ou e-mail e filtros de papel e status', async () => {
      const Page = numberedPage(AdminUser);
      const mine = Page.parse((await h.call('ana', 'GET', `/admin/users?q=${h.stamp}`)).data);
      for (const key of ['x1', 'x2', 'x3']) await h.makeUser(key, []);
      const all = Page.parse((await h.call('ana', 'GET', `/admin/users?q=${h.stamp}`)).data);
      expect(mine.total + 3).toBe(all.total);
      expect(all.total).toBe(h.people.size);
      expect(all.items).toHaveLength(20);
      expect(all.pageCount).toBe(2);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/users?q=${h.stamp}&page=2`)).data).items).toHaveLength(h.people.size - 20);
      const bianca = h.people.get('bianca');
      expect(Page.parse((await h.call('ana', 'GET', `/admin/users?q=${bianca?.nickname.toUpperCase()}`)).data).items.map((u) => u.id)).toEqual([id('bianca')]);
      expect(Page.parse((await h.call('ana', 'GET', `/admin/users?q=${encodeURIComponent(bianca?.email ?? '')}`)).data).items.map((u) => u.id)).toEqual([id('bianca')]);
      const organizers = Page.parse((await h.call('ana', 'GET', `/admin/users?q=${h.stamp}&role=ORGANIZER`)).data);
      expect(organizers.items.map((u) => u.id).sort()).toEqual([id('camila'), id('diego')].sort());
      expect(Page.parse((await h.call('ana', 'GET', `/admin/users?q=${h.stamp}&status=BANNED`)).data).total).toBe(0);
    });

    it('perfil completo: IDs de jogo, squads, histórico e denúncias recebidas; id inválido = 404', async () => {
      await db.gameAccount.create({ data: { userId: id('p01'), gameId, fields: { playerId: '123' } } });
      const team = await db.team.create({ data: { name: 'Squad AU', tag: `AU${h.stamp}`.slice(0, 10), captainId: id('p01'), members: { create: { userId: id('p01'), role: 'CAPTAIN' } } } });
      const t = await tournament('camila', 'FINISHED', 'Copa Perfil');
      await db.registration.create({ data: { tournamentId: t.id, userId: id('p01'), status: 'CONFIRMED' } });
      await db.report.create({ data: { reporterId: id('bianca'), targetType: 'USER', targetId: id('p01'), reason: 'HARASSMENT', description: 'Ofensas no chat.', targetOwnerUserId: id('p01') } });
      const detail = AdminUserDetail.parse((await h.call('ana', 'GET', `/admin/users/${id('p01')}`)).data);
      expect(detail.gameAccounts.map((g) => g.gameName)).toEqual([`Jogo AU ${h.stamp}`]);
      expect(detail.teams).toEqual([{ id: team.id, name: 'Squad AU', tag: team.tag, isCaptain: true }]);
      expect(detail).toMatchObject({ tournamentsPlayed: 1, reportsAgainst: 1, sanctions: [], organizerLimits: null });
      const camila = AdminUserDetail.parse((await h.call('ana', 'GET', `/admin/users/${id('camila')}`)).data);
      expect(camila.tournamentsOrganized).toBe(1);
      expect(camila.organizerLimits).toEqual({ maxActiveTournaments: 3, allowedGameIds: [] });
      expect((await h.call('ana', 'GET', '/admin/users/nao-existe')).status).toBe(404);
    });

    it('CT-09: banir derruba a sessão aberta na hora — GET /me vira null, session.revoked sai e o login é recusado', async () => {
      await db.user.update({ where: { id: id('p04') }, data: { passwordHash: await hashPassword('senhaForte#2026') } });
      expect(((await h.call('p04', 'GET', '/me')).data as { id: string }).id).toBe(id('p04'));
      const res = await h.call('ana', 'POST', `/admin/users/${id('p04')}/sanctions`, { type: 'BAN', reason: 'Uso de hack comprovado em três partidas' });
      expect(res.status).toBe(201);
      const result = SanctionResult.parse(res.data);
      expect(result.user.status).toBe('BANNED');
      expect(result.sanction).toMatchObject({ type: 'BAN', endsAt: null, issuedByNickname: h.people.get('ana')?.nickname });

      // A sessão continua "aberta" no navegador, mas a API não a reconhece mais.
      expect((await h.call('p04', 'GET', '/me')).data).toBeNull();
      expect((await h.call('p04', 'GET', '/me/reports')).status).toBe(401);
      const login = await h.call(null, 'POST', '/auth/login', { email: h.people.get('p04')?.email, password: 'senhaForte#2026' });
      expect(login.code).toBe('ACCOUNT_BANNED');
      expect(await db.session.count({ where: { userId: id('p04'), revokedAt: null } })).toBe(0);

      expect(h.realtime.events).toContainEqual({ channel: `user:${id('p04')}`, event: { type: 'session.revoked', reason: 'BANNED' } });
      expect(await db.notification.count({ where: { userId: id('p04'), type: 'SANCTION', title: 'Sua conta foi banida' } })).toBe(1);
      expect(await lastAudit(db, 'USER_SANCTIONED', { entityId: id('p04') })).toMatchObject({ actorId: id('ana'), before: { status: 'ACTIVE' }, after: { status: 'BANNED', sancao: 'BAN' }, reason: 'Uso de hack comprovado em três partidas', ip: '203.0.113.10' });
      expect((await h.call('ana', 'POST', `/admin/users/${id('p04')}/sanctions`, { type: 'BAN', reason: 'De novo, sem efeito' })).code).toBe('ALREADY_BANNED');
    });

    it('remover a sanção devolve a conta para ativa e é auditado; remover de novo = 409', async () => {
      const banned = SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${id('p05')}/sanctions`, { type: 'BAN', reason: 'Engano na análise' })).data);
      const lifted = await h.call('ana', 'DELETE', `/admin/sanctions/${banned.sanction.id}`, { reason: 'Banimento aplicado por engano' });
      expect(lifted.status).toBe(200);
      const detail = AdminUserDetail.parse(lifted.data);
      expect(detail.status).toBe('ACTIVE');
      expect(detail.sanctions[0]?.liftedAt).not.toBeNull();
      expect(await lastAudit(db, 'SANCTION_LIFTED', { entityId: id('p05') })).toMatchObject({ actorId: id('ana'), before: { status: 'BANNED' }, after: { status: 'ACTIVE' }, reason: 'Banimento aplicado por engano' });
      // A sessão antiga continua derrubada (subiu a versão); entrar de novo funciona.
      await h.login('p05');
      expect(((await h.call('p05', 'GET', '/me')).data as { id: string }).id).toBe(id('p05'));
      expect((await h.call('ana', 'DELETE', `/admin/sanctions/${banned.sanction.id}`)).status).toBe(409);
      expect((await h.call('ana', 'DELETE', '/admin/sanctions/nao-existe')).status).toBe(404);
    });

    it('suspensão tem prazo, derruba a sessão e expira sozinha (leitura do painel e Cron)', async () => {
      expect((await h.call('ana', 'POST', `/admin/users/${id('p06')}/sanctions`, { type: 'SUSPENSION', reason: 'Ofensas repetidas' })).status).toBe(400);
      const start = Date.now();
      const result = SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${id('p06')}/sanctions`, { type: 'SUSPENSION', days: 3, reason: 'Ofensas repetidas' })).data);
      expect(result.user.status).toBe('SUSPENDED');
      const until = Date.parse(result.user.suspendedUntil ?? '');
      expect(until).toBeGreaterThanOrEqual(start + 3 * DAY);
      expect(until).toBeLessThan(start + 3 * DAY + 60_000);
      expect(h.realtime.events).toContainEqual({ channel: `user:${id('p06')}`, event: { type: 'session.revoked', reason: 'SUSPENDED' } });
      expect((await h.call('p06', 'GET', '/me')).data).toBeNull();

      // Dois dias depois ainda vale; no quarto dia a conta voltou sozinha.
      try {
        h.clock.now = new Date(start + 2 * DAY);
        await h.login('ana');
        expect(AdminUserDetail.parse((await h.call('ana', 'GET', `/admin/users/${id('p06')}`)).data).status).toBe('SUSPENDED');
        h.clock.now = new Date(start + 3 * DAY + HOUR);
        await h.login('ana');
        const after = AdminUserDetail.parse((await h.call('ana', 'GET', `/admin/users/${id('p06')}`)).data);
        expect(after.status).toBe('ACTIVE');
        expect(after.suspendedUntil).toBeNull();
        expect(after.sanctions).toHaveLength(1);
      } finally {
        h.clock.now = null;
        await h.login('ana');
      }

      // O Cron faz o mesmo sem ninguém abrir o painel.
      const s = SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${id('p07')}/sanctions`, { type: 'SUSPENSION', days: 1, reason: 'Ofensas repetidas' })).data);
      expect(s.user.status).toBe('SUSPENDED');
      expect((await h.app.request('/api/v1/cron/sanctions')).status).toBe(401);
      h.clock.now = new Date(Date.now() + 2 * DAY);
      const cron = await Promise.resolve(h.app.request('/api/v1/cron/sanctions', { headers: { Authorization: 'Bearer segredo-do-cron-de-teste' } })).finally(() => {
        h.clock.now = null;
      });
      expect(cron.status).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { id: id('p07') } })).status).toBe('ACTIVE');
    });

    it('advertência não muda o status nem derruba a sessão', async () => {
      const before = h.realtime.events.length;
      const result = SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${id('p08')}/sanctions`, { type: 'WARNING', reason: 'Nick ofensivo' })).data);
      expect(result.user.status).toBe('ACTIVE');
      expect(h.realtime.events.slice(before).filter((e) => e.event.type === 'session.revoked')).toEqual([]);
      expect(((await h.call('p08', 'GET', '/me')).data as { id: string }).id).toBe(id('p08'));
      expect(await db.notification.count({ where: { userId: id('p08'), type: 'SANCTION' } })).toBe(1);
    });

    it('Admin não sanciona o Super Admin, nem a si mesmo, nem outro Admin; o Super Admin sanciona um Admin', async () => {
      await h.makeUser('adm2', ['ADMIN']);
      const ban = { type: 'BAN', reason: 'Tentativa indevida' };
      const before = await auditCount(db, 'USER_SANCTIONED', { actorId: id('ana') });
      expect((await h.call('ana', 'POST', `/admin/users/${id('rafael')}/sanctions`, ban)).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('ana')}/sanctions`, ban)).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('rafael')}/reset-password`)).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('adm2')}/sanctions`, ban)).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('adm2')}/reset-password`)).status).toBe(403);
      expect(await auditCount(db, 'USER_SANCTIONED', { actorId: id('ana') })).toBe(before);
      expect((await h.call('rafael', 'POST', `/admin/users/${id('adm2')}/sanctions`, ban)).status).toBe(201);
      expect((await h.call('rafael', 'POST', `/admin/users/${id('rafael')}/sanctions`, ban)).status).toBe(403);
    });

    it('redefinir senha: link de uso único por e-mail (e na resposta fora de produção), sem token na auditoria', async () => {
      const res = await h.call('ana', 'POST', `/admin/users/${id('p10')}/reset-password`);
      const { link } = PasswordResetLink.parse(res.data);
      expect(link).toContain('/redefinir-senha?token=');
      const token = new URL(link).searchParams.get('token') ?? '';
      expect(h.mails.at(-1)).toMatchObject({ to: h.people.get('p10')?.email, template: 'RESET_PASSWORD', data: { link } });
      expect((await h.call(null, 'POST', '/auth/reset-password', { token, password: 'novaSenha#2026x' })).status).toBe(200);
      expect((await h.call(null, 'POST', '/auth/reset-password', { token, password: 'outraSenha#2026x' })).status).toBe(400);
      const log = await lastAudit(db, 'USER_PASSWORD_RESET', { entityId: id('p10') });
      expect(log).toMatchObject({ actorId: id('ana'), after: { linkEnviadoPara: h.people.get('p10')?.email } });
      expect(JSON.stringify(log, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(token);
      expect(JSON.stringify(log, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain('novaSenha');

      // Em produção o link só vai por e-mail.
      const prod = createHarness(db, 'aup', { VERCEL_ENV: 'production', NEXT_PUBLIC_SITE_URL: 'https://novaarena.gg', KV_REST_API_URL: 'http://localhost:8079', KV_REST_API_TOKEN: 'x', QSTASH_TOKEN: 'x', RESEND_API_KEY: 'x', EMAIL_FROM: 'Nova <a@b.gg>' });
      prod.people.set('ana', h.people.get('ana') as never);
      const silent = await prod.call('ana', 'POST', `/admin/users/${id('p11')}/reset-password`);
      expect(PasswordResetLink.parse(silent.data).link).toBe('');
      expect(prod.mails.at(-1)?.data.link).toMatch(/^https:\/\/novaarena\.gg\/redefinir-senha\?token=/);
    });
  });

  // ── Mescla (RN-13) ─────────────────────────────────────────────────
  describe('mescla de contas (RN-13)', () => {
    it('bloqueia quando as duas contas estão no mesmo campeonato ativo (sozinhas ou em squads diferentes)', async () => {
      const t = await tournament('camila', 'IN_PROGRESS', 'Liga Mescla');
      await db.registration.create({ data: { tournamentId: t.id, userId: id('p12'), status: 'CONFIRMED' } });
      const squad = await db.registration.create({ data: { tournamentId: t.id, displayName: 'Squad X', status: 'CONFIRMED' } });
      await db.registrationMember.create({ data: { registrationId: squad.id, tournamentId: t.id, userId: id('p13') } });
      const res = await h.call('ana', 'POST', `/admin/users/${id('p12')}/merge`, { sourceUserId: id('p13'), reason: 'Mesma pessoa, duas contas' });
      expect(res.status).toBe(409);
      expect(res.code).toBe('MERGE_CONFLICT');
      expect((res.data as { title: string }).title).toContain('Liga Mescla');
      expect((await db.user.findUniqueOrThrow({ where: { id: id('p13') } })).status).toBe('ACTIVE');
      expect(await auditCount(db, 'USERS_MERGED', { entityId: id('p12') })).toBe(0);
    });

    it('sem conflito: transfere inscrições, squads, capitania e IDs de jogo; papéis não vão junto; irreversível', async () => {
      await db.userRole.create({ data: { userId: id('p44'), role: 'ORGANIZER' } });
      const team = await db.team.create({ data: { name: 'Squad Lobo', tag: `LB${h.stamp}`.slice(0, 10), captainId: id('p44'), members: { create: [{ userId: id('p44'), role: 'CAPTAIN' }, { userId: id('p14') }] } } });
      const copa = await tournament('camila', 'REGISTRATION_OPEN', 'Copa Lobo');
      const reg = await db.registration.create({ data: { tournamentId: copa.id, teamId: team.id, status: 'CONFIRMED' } });
      await db.registrationMember.create({ data: { registrationId: reg.id, tournamentId: copa.id, userId: id('p44'), isCaptain: true } });
      const other = await db.game.create({ data: { slug: `au2-${h.stamp}`, name: `Outro ${h.stamp}` } });
      await db.gameAccount.create({ data: { userId: id('p44'), gameId: other.id, fields: { playerId: '999' } } });
      await db.gameAccount.create({ data: { userId: id('p44'), gameId, fields: { playerId: 'origem' } } });
      await db.gameAccount.create({ data: { userId: id('p15'), gameId, fields: { playerId: 'destino' } } });

      expect((await h.call('ana', 'POST', `/admin/users/${id('p15')}/merge`, { sourceUserId: id('p44') })).status).toBe(400);
      const res = await h.call('ana', 'POST', `/admin/users/${id('p15')}/merge`, { sourceUserId: id('p44'), reason: 'Conta antiga' });
      expect(res.status).toBe(200);
      expect(MergeUsersResult.parse(res.data).moved).toEqual({ registrations: 1, teams: 1, gameAccounts: 1 });

      const squad = await db.team.findUniqueOrThrow({ where: { id: team.id }, include: { members: true } });
      expect(squad.captainId).toBe(id('p15'));
      expect(squad.members.find((m) => m.userId === id('p15'))?.role).toBe('CAPTAIN');
      expect(squad.members.some((m) => m.userId === id('p44'))).toBe(false);
      expect(await db.registrationMember.count({ where: { registrationId: reg.id, userId: id('p15') } })).toBe(1);
      const accounts = await db.gameAccount.findMany({ where: { userId: id('p15') } });
      expect(accounts.map((a) => (a.fields as { playerId: string }).playerId).sort()).toEqual(['999', 'destino']);

      const source = await db.user.findUniqueOrThrow({ where: { id: id('p44') }, include: { roles: true } });
      expect(source.status).toBe('MERGED');
      expect(source.mergedIntoId).toBe(id('p15'));
      expect(source.roles.map((r) => r.role)).toEqual(['PARTICIPANT']);
      expect((await db.userRole.findMany({ where: { userId: id('p15') } })).map((r) => r.role)).toEqual(['PARTICIPANT']);
      expect((await h.call('p44', 'GET', '/me')).data).toBeNull();
      expect(h.realtime.events).toContainEqual({ channel: `user:${id('p44')}`, event: { type: 'session.revoked', reason: 'MERGED' } });
      expect(await lastAudit(db, 'USERS_MERGED', { entityId: id('p15') })).toMatchObject({ actorId: id('ana'), reason: 'Conta antiga', after: { origemStatus: 'MERGED', inscricoesTransferidas: 1, squadsTransferidos: 1 } });

      expect((await h.call('ana', 'POST', `/admin/users/${id('p15')}/merge`, { sourceUserId: id('p44'), reason: 'De novo' })).status).toBe(409);
      expect((await h.call('ana', 'POST', `/admin/users/${id('p44')}/merge`, { sourceUserId: id('p45'), reason: 'Tentativa de desfazer' })).status).toBe(409);
    });

    it('não mescla a conta em si mesma, nem conta de administrador como origem', async () => {
      expect((await h.call('ana', 'POST', `/admin/users/${id('bianca')}/merge`, { sourceUserId: id('bianca'), reason: 'Mesma conta' })).status).toBe(400);
      expect((await h.call('ana', 'POST', `/admin/users/${id('bianca')}/merge`, { sourceUserId: id('rafael'), reason: 'Tentativa indevida' })).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('bianca')}/merge`, { sourceUserId: id('ana'), reason: 'Tentativa indevida' })).status).toBe(403);
      expect((await h.call('ana', 'POST', `/admin/users/${id('bianca')}/merge`, { sourceUserId: 'nao-existe', reason: 'Conta errada' })).status).toBe(400);
    });
  });

  // ── Convites (CT-03) ───────────────────────────────────────────────
  describe('convites de papel (CT-03)', () => {
    async function createInvite(input: Record<string, unknown> = {}) {
      const res = await h.call('ana', 'POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 1, ...input });
      expect(res.status).toBe(201);
      const invite = RoleInvite.parse(res.data);
      return { invite, token: invite.link?.split('/convite/')[1] ?? '' };
    }

    it('1 hora e 1 uso: aceito uma vez concede o papel; a 2ª tentativa recebe 410 e não concede', async () => {
      await h.makeUser('c1', []);
      await h.makeUser('c2', []);
      const before = Date.now();
      const { invite, token } = await createInvite();
      expect(invite.state).toBe('VALID');
      expect(invite.link).toMatch(/^http:\/\/localhost\/convite\/[0-9a-f]{48}$/);
      expect(Date.parse(invite.expiresAt)).toBeGreaterThanOrEqual(before + HOUR);
      // O link completo só aparece na criação; o banco guarda só o hash.
      const list = z.array(RoleInvite).parse((await h.call('ana', 'GET', '/admin/invites')).data);
      expect(list.find((i) => i.id === invite.id)?.link).toBeNull();
      expect(JSON.stringify(list)).not.toContain(token);
      expect(JSON.stringify(await db.roleInvite.findUniqueOrThrow({ where: { id: invite.id } }))).not.toContain(token);
      expect(RoleInvitePreview.parse((await h.call(null, 'GET', `/role-invites/${token}`)).data)).toMatchObject({ role: 'ADMIN', state: 'VALID', invitedBy: h.people.get('ana')?.nickname });

      const first = await h.call('c1', 'POST', `/role-invites/${token}/accept`);
      expect(first.status).toBe(200);
      expect(AcceptRoleInviteResponse.parse(first.data).user.roles).toContain('ADMIN');
      const second = await h.call('c2', 'POST', `/role-invites/${token}/accept`);
      expect(second.status).toBe(410);
      expect(second.code).toBe('INVITE_EXHAUSTED');
      expect((await db.userRole.findMany({ where: { userId: id('c2') } })).map((r) => r.role)).toEqual(['PARTICIPANT']);
      expect(z.array(RoleInvite).parse((await h.call('ana', 'GET', '/admin/invites')).data).find((i) => i.id === invite.id)).toMatchObject({ state: 'EXHAUSTED', uses: 1, maxUses: 1 });
      // Quem virou Admin pelo convite fica bloqueado no painel até fazer o 2FA.
      await h.login('c1', { tfa: false });
      expect((await h.call('c1', 'GET', '/admin/stats')).code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('expirado não concede papel', async () => {
      await h.makeUser('c3', []);
      const { invite, token } = await createInvite();
      try {
        h.clock.now = new Date(Date.now() + HOUR + 1000);
        await h.login('c3');
        await h.login('ana');
        const res = await h.call('c3', 'POST', `/role-invites/${token}/accept`);
        expect(res.status).toBe(410);
        expect(res.code).toBe('INVITE_EXPIRED');
        expect(z.array(RoleInvite).parse((await h.call('ana', 'GET', '/admin/invites')).data).find((i) => i.id === invite.id)?.state).toBe('EXPIRED');
      } finally {
        h.clock.now = null;
        await h.login('ana');
      }
      expect((await db.userRole.findMany({ where: { userId: id('c3') } })).map((r) => r.role)).toEqual(['PARTICIPANT']);
    });

    it('revogado não concede papel; revogar de novo = 409', async () => {
      await h.makeUser('c4', []);
      const { invite, token } = await createInvite({ validity: '7d', maxUses: 5 });
      expect(RoleInvite.parse((await h.call('ana', 'DELETE', `/admin/invites/${invite.id}`)).data).state).toBe('REVOKED');
      expect((await h.call('ana', 'DELETE', `/admin/invites/${invite.id}`)).status).toBe(409);
      const res = await h.call('c4', 'POST', `/role-invites/${token}/accept`);
      expect(res.status).toBe(410);
      expect(res.code).toBe('INVITE_REVOKED');
      expect((await db.userRole.findMany({ where: { userId: id('c4') } })).map((r) => r.role)).toEqual(['PARTICIPANT']);
      expect(await lastAudit(db, 'INVITE_REVOKED', { entityId: invite.id })).toMatchObject({ actorId: id('ana'), before: { estado: 'VALID', usos: '0/5' }, after: { estado: 'REVOKED' } });
    });

    it('limite de usos respeitado sob concorrência: 8 aceites ao mesmo tempo num convite de 3 usos → 3 organizadores', async () => {
      const keys = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
      for (const key of keys) await h.makeUser(key, []);
      const { invite, token } = await createInvite({ role: 'ORGANIZER', validity: '24h', maxUses: 3 });
      const results = await Promise.all(keys.map((key) => h.call(key, 'POST', `/role-invites/${token}/accept`)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 410).every((r) => r.code === 'INVITE_EXHAUSTED')).toBe(true);
      expect(results.filter((r) => r.status === 410)).toHaveLength(5);
      expect((await db.roleInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(3);
      const organizers = await db.userRole.findMany({ where: { role: 'ORGANIZER', userId: { in: keys.map(id) } } });
      expect(organizers).toHaveLength(3);
      // RN-10: organizador novo começa com o limite padrão.
      const limits = await db.organizerLimits.findMany({ where: { userId: { in: organizers.map((o) => o.userId) } } });
      expect(limits.map((l) => [l.maxActiveTournaments, l.allowedGameIds.length, l.verified])).toEqual([
        [3, 0, false],
        [3, 0, false],
        [3, 0, false],
      ]);
    });

    it('valida validade, usos (1 a 10) e papel', async () => {
      expect((await h.call('ana', 'POST', '/admin/invites', { role: 'ADMIN', validity: '30d', maxUses: 1 })).status).toBe(400);
      expect((await h.call('ana', 'POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 0 })).status).toBe(400);
      expect((await h.call('ana', 'POST', '/admin/invites', { role: 'ADMIN', validity: '1h', maxUses: 11 })).status).toBe(400);
      expect((await h.call('ana', 'POST', '/admin/invites', { role: 'SUPER_ADMIN', validity: '1h', maxUses: 1 })).status).toBe(400);
    });

    it('por e-mail: um uso, só para aquele e-mail, enviado por e-mail; aceite exige e-mail confirmado', async () => {
      await h.makeUser('e1', []);
      await h.makeUser('e2', []);
      await h.makeUser('e3', [], { emailVerified: false });
      const { invite, token } = await createInvite({ email: h.people.get('e1')?.email.toUpperCase(), maxUses: 5, validity: '24h' });
      expect(invite).toMatchObject({ email: h.people.get('e1')?.email, maxUses: 1 });
      expect(h.mails.at(-1)).toMatchObject({ to: h.people.get('e1')?.email, template: 'ROLE_INVITE', data: { link: invite.link } });
      expect((await h.call('e3', 'POST', `/role-invites/${token}/accept`)).code).toBe('EMAIL_NOT_VERIFIED');
      expect((await h.call('e2', 'POST', `/role-invites/${token}/accept`)).status).toBe(403);
      expect((await h.call('e1', 'POST', `/role-invites/${token}/accept`)).status).toBe(200);
      expect((await h.call(null, 'POST', `/role-invites/${token}/accept`)).status).toBe(401);
      expect((await h.call(null, 'GET', '/role-invites/token-que-nao-existe-de-jeito-nenhum')).status).toBe(404);
    });

    it('criar, revogar e aceitar ficam na auditoria, sem o token; o papel concedido também (gatilho)', async () => {
      await h.makeUser('c5', []);
      const { invite, token } = await createInvite({ validity: '24h', maxUses: 2 });
      expect(await lastAudit(db, 'INVITE_CREATED', { entityId: invite.id })).toMatchObject({ actorId: id('ana'), after: { papel: 'ADMIN', validade: '24h', usos: 2 } });
      await h.call('c5', 'POST', `/role-invites/${token}/accept`);
      expect(await lastAudit(db, 'INVITE_ACCEPTED', { entityId: id('c5') })).toMatchObject({ actorId: id('c5'), after: { papel: 'ADMIN', convite: invite.id } });
      expect(await lastAudit(db, 'ROLE_GRANTED', { entityId: id('c5') })).toMatchObject({ actorId: id('c5'), after: { role: 'ADMIN' }, reason: 'Convite de papel aceito' });
      const all = await db.auditLog.findMany({ where: { OR: [{ entityId: invite.id }, { entityId: id('c5') }] } });
      expect(JSON.stringify(all, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(token);
    });
  });

  // ── Administradores (RN-11) ────────────────────────────────────────
  describe('administradores (RN-11)', () => {
    it('ninguém remove o Super Admin', async () => {
      for (const actor of ['ana', 'rafael']) expect((await h.call(actor, 'DELETE', `/admin/users/${id('rafael')}/roles/ADMIN`)).status).toBe(403);
      expect((await db.userRole.findMany({ where: { userId: id('rafael') } })).map((r) => r.role).sort()).toEqual(['ADMIN', 'PARTICIPANT', 'SUPER_ADMIN']);
    });

    it('lista os administradores com o Super Admin primeiro e desde quando', async () => {
      const admins = z.array(AdminMember).parse((await h.call('ana', 'GET', '/admin/admins')).data);
      const mine = admins.filter((a) => a.id === id('rafael') || a.id === id('ana'));
      expect(mine.map((a) => [a.id, a.isSuperAdmin])).toEqual([
        [id('rafael'), true],
        [id('ana'), false],
      ]);
      expect(admins[0]?.isSuperAdmin).toBe(true);
    });

    it('conceder papel exige conta ativa com e-mail confirmado e não duplica; o gatilho audita com o motivo', async () => {
      await h.makeUser('g1', []);
      await h.makeUser('g2', [], { emailVerified: false });
      expect((await h.call('ana', 'POST', `/admin/users/${id('camila')}/roles`, { role: 'ORGANIZER' })).code).toBe('ROLE_ALREADY_GRANTED');
      expect((await h.call('ana', 'POST', `/admin/users/${id('g2')}/roles`, { role: 'ADMIN' })).code).toBe('EMAIL_NOT_VERIFIED');
      expect((await h.call('ana', 'POST', `/admin/users/${id('p04')}/roles`, { role: 'ADMIN' })).code).toBe('ACCOUNT_NOT_ACTIVE');
      const granted = await h.call('ana', 'POST', `/admin/users/${id('g1')}/roles`, { role: 'ADMIN', reason: 'Novo moderador' });
      expect(AdminUserDetail.parse(granted.data).roles).toContain('ADMIN');
      expect(await lastAudit(db, 'ROLE_GRANTED', { entityId: id('g1') })).toMatchObject({ actorId: id('ana'), after: { role: 'ADMIN' }, reason: 'Novo moderador' });
      expect(await db.notification.count({ where: { userId: id('g1'), title: 'Você agora é administrador' } })).toBe(1);
    });

    it('Admin remove um Admin mais novo na hora e ele perde o acesso', async () => {
      await h.makeUser('n1', ['ADMIN']);
      const res = await h.call('ana', 'DELETE', `/admin/users/${id('n1')}/roles/ADMIN`, { reason: 'Saiu da equipe' });
      expect(res.status).toBe(200);
      expect(RoleRevokeResult.parse(res.data).outcome).toBe('REVOKED');
      expect(await lastAudit(db, 'ROLE_REVOKED', { entityId: id('n1') })).toMatchObject({ actorId: id('ana'), before: { role: 'ADMIN' }, reason: 'Saiu da equipe' });
      expect((await h.call('n1', 'GET', '/admin/stats')).status).toBe(403);
    });

    it('remover um Admin mais antigo vira pedido pendente; só o Super Admin aprova', async () => {
      await h.makeUser('n2', ['ADMIN']);
      const res = await h.call('n2', 'DELETE', `/admin/users/${id('ana')}/roles/ADMIN`, { reason: 'Inativa há meses' });
      expect(res.status).toBe(202);
      const pending = RoleRevokeResult.parse(res.data);
      expect(pending.outcome).toBe('PENDING_APPROVAL');
      expect((await h.call('ana', 'GET', '/admin/stats')).status).toBe(200);
      expect((await h.call('n2', 'DELETE', `/admin/users/${id('ana')}/roles/ADMIN`)).code).toBe('REMOVAL_ALREADY_REQUESTED');
      const requests = z.array(AdminRemovalRequest).parse((await h.call('n2', 'GET', '/admin/admin-removal-requests')).data);
      expect(requests.find((r) => r.id === pending.requestId)).toMatchObject({ targetUserId: id('ana'), requestedById: id('n2'), status: 'PENDING', reason: 'Inativa há meses' });
      expect(await lastAudit(db, 'ADMIN_REMOVAL_REQUESTED', { entityId: id('ana') })).toMatchObject({ actorId: id('n2') });
      expect(await db.notification.count({ where: { userId: id('rafael'), title: 'Pedido de remoção de administrador' } })).toBeGreaterThanOrEqual(1);
      expect((await h.call('n2', 'POST', `/admin/admin-removal-requests/${pending.requestId}/approve`)).status).toBe(403);

      // Recusado: a Ana continua.
      const rejected = await h.call('rafael', 'POST', `/admin/admin-removal-requests/${pending.requestId}/reject`);
      expect(AdminRemovalRequest.parse(rejected.data)).toMatchObject({ status: 'REJECTED', reviewedByNickname: h.people.get('rafael')?.nickname });
      expect(await db.userRole.count({ where: { userId: id('ana'), role: 'ADMIN' } })).toBe(1);
      expect((await h.call('rafael', 'POST', `/admin/admin-removal-requests/${pending.requestId}/approve`)).status).toBe(409);

      // Novo pedido, aprovado: o papel sai e o registro ROLE_REVOKED é do Super Admin.
      await h.makeUser('old', ['ADMIN'], { createdAt: new Date(Date.now() - 200 * DAY) });
      const again = RoleRevokeResult.parse((await h.call('n2', 'DELETE', `/admin/users/${id('old')}/roles/ADMIN`, { reason: 'Saiu do projeto' })).data);
      const approved = await h.call('rafael', 'POST', `/admin/admin-removal-requests/${again.requestId}/approve`);
      expect(AdminRemovalRequest.parse(approved.data)).toMatchObject({ status: 'APPROVED' });
      expect(await db.userRole.count({ where: { userId: id('old'), role: 'ADMIN' } })).toBe(0);
      expect(await lastAudit(db, 'ROLE_REVOKED', { entityId: id('old') })).toMatchObject({ actorId: id('rafael') });
      expect(await lastAudit(db, 'ADMIN_REMOVAL_REVIEWED', { entityId: id('old') })).toMatchObject({ actorId: id('rafael'), after: { situacao: 'APPROVED' } });
    });

    it('o Super Admin remove qualquer Admin direto; ninguém remove o próprio papel', async () => {
      await h.makeUser('n3', ['ADMIN'], { createdAt: new Date(Date.now() - 500 * DAY) });
      expect((await h.call('ana', 'DELETE', `/admin/users/${id('ana')}/roles/ADMIN`)).status).toBe(403);
      expect((await h.call('rafael', 'DELETE', `/admin/users/${id('n3')}/roles/ADMIN`)).status).toBe(200);
      expect(await db.userRole.count({ where: { userId: id('n3'), role: 'ADMIN' } })).toBe(0);
      expect((await h.call('rafael', 'DELETE', `/admin/users/${id('bianca')}/roles/MODERATOR`)).status).toBe(404);
    });
  });

  // ── Organizadores (RN-09, RN-10) e pedidos ─────────────────────────
  describe('organizadores e pedidos', () => {
    it('lista com selo, limites e campeonatos ativos; altera limites com antes e depois na auditoria', async () => {
      await h.makeUser('o1', ['ORGANIZER']);
      await db.organizerLimits.create({ data: { userId: id('o1'), maxActiveTournaments: 10, verified: true } });
      await tournament('o1', 'REGISTRATION_OPEN', 'Org Um A');
      await tournament('o1', 'FINISHED', 'Org Um B');
      const page = numberedPage(AdminOrganizer).parse((await h.call('ana', 'GET', `/admin/organizers?q=${h.people.get('o1')?.nickname}`)).data);
      expect(page.items[0]).toMatchObject({ id: id('o1'), verifiedOrganizer: true, activeTournaments: 1, totalTournaments: 2, organizerLimits: { maxActiveTournaments: 10 } });

      const other = await db.game.create({ data: { slug: `au3-${h.stamp}`, name: `Bilhar ${h.stamp}` } });
      const res = await h.call('ana', 'PATCH', `/admin/users/${id('diego')}/organizer-limits`, { maxActiveTournaments: 6, allowedGameIds: [gameId, other.id], verified: true });
      expect(AdminOrganizer.parse(res.data)).toMatchObject({ verifiedOrganizer: true, organizerLimits: { maxActiveTournaments: 6, allowedGameIds: [gameId, other.id] } });
      expect(await lastAudit(db, 'ORGANIZER_LIMITS_CHANGED', { entityId: id('diego') })).toMatchObject({
        actorId: id('ana'),
        before: { simultaneos: 3, jogos: 'todos', verificado: false },
        after: { simultaneos: 6, jogos: [`Jogo AU ${h.stamp}`, `Bilhar ${h.stamp}`], verificado: true },
      });
      // Repetir o mesmo valor não gera ruído na auditoria.
      const count = await auditCount(db, 'ORGANIZER_LIMITS_CHANGED', { entityId: id('diego') });
      await h.call('ana', 'PATCH', `/admin/users/${id('diego')}/organizer-limits`, { maxActiveTournaments: 6, allowedGameIds: [gameId, other.id], verified: true });
      expect(await auditCount(db, 'ORGANIZER_LIMITS_CHANGED', { entityId: id('diego') })).toBe(count);
      expect((await h.call('ana', 'PATCH', `/admin/users/${id('diego')}/organizer-limits`, { maxActiveTournaments: 6, allowedGameIds: ['g_inexistente'], verified: true })).status).toBe(400);
      expect((await h.call('ana', 'PATCH', `/admin/users/${id('bianca')}/organizer-limits`, { maxActiveTournaments: 1, allowedGameIds: [], verified: false })).status).toBe(409);
    });

    it('revogar organizador aplica a RN-09: co-organizador mais antigo assume; sem ele, pausa e vai para "Sem responsável"', async () => {
      await h.makeUser('o2', ['ORGANIZER']);
      await h.makeUser('co1', []);
      await h.makeUser('co2', []);
      await h.makeUser('mod', []);
      const copa = await tournament('o2', 'REGISTRATION_OPEN', 'Copa RN09');
      const liga = await tournament('o2', 'IN_PROGRESS', 'Liga RN09');
      const draft = await tournament('o2', 'DRAFT', 'Rascunho RN09');
      await db.tournamentStaff.createMany({
        data: [
          { tournamentId: copa.id, userId: id('co2'), role: 'CO_ORGANIZER', addedById: id('o2'), createdAt: new Date(Date.now() - DAY) },
          { tournamentId: copa.id, userId: id('co1'), role: 'CO_ORGANIZER', addedById: id('o2'), createdAt: new Date(Date.now() - 5 * DAY) },
          { tournamentId: copa.id, userId: id('mod'), role: 'MODERATOR', addedById: id('o2'), createdAt: new Date(Date.now() - 9 * DAY) },
        ],
      });
      const res = await h.call('ana', 'DELETE', `/admin/users/${id('o2')}/roles/ORGANIZER`, { reason: 'Descumpriu as regras da plataforma' });
      expect(res.status).toBe(200);
      const result = RoleRevokeResult.parse(res.data);
      expect(Object.fromEntries(result.affectedTournaments.map((t) => [t.id, t.outcome]))).toEqual({ [copa.id]: 'TRANSFERRED', [liga.id]: 'PAUSED' });

      expect(await db.tournament.findUniqueOrThrow({ where: { id: copa.id } })).toMatchObject({ ownerId: id('co1'), status: 'REGISTRATION_OPEN' });
      expect((await db.tournamentStaff.findMany({ where: { tournamentId: copa.id } })).map((s) => s.userId).sort()).toEqual([id('co2'), id('mod')].sort());
      expect(await db.tournament.findUniqueOrThrow({ where: { id: liga.id } })).toMatchObject({ ownerId: id('o2'), status: 'PAUSED' });
      expect(await db.tournament.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ ownerId: id('o2'), status: 'DRAFT' });
      expect(await db.orphanTournament.findUnique({ where: { tournamentId: liga.id } })).toMatchObject({ previousStatus: 'IN_PROGRESS', previousOwnerId: id('o2') });

      expect(await lastAudit(db, 'ROLE_REVOKED', { entityId: id('o2') })).toMatchObject({ actorId: id('ana'), reason: 'Descumpriu as regras da plataforma' });
      expect(await lastAudit(db, 'TOURNAMENT_OWNER_CHANGED', { tournamentId: copa.id })).toMatchObject({ before: { responsavel: h.people.get('o2')?.nickname }, after: { ownerId: id('co1') } });
      expect(await lastAudit(db, 'TOURNAMENT_STATUS_CHANGED', { tournamentId: liga.id })).toMatchObject({ after: { status: 'PAUSED', semResponsavel: true } });
      expect(await db.notification.count({ where: { userId: id('rafael'), title: { contains: 'sem responsável' } } })).toBeGreaterThanOrEqual(1);
      expect(h.realtime.events).toContainEqual({ channel: `tournament:${liga.id}`, event: { type: 'tournament.updated', tournamentId: liga.id } });
      expect(await db.organizerLimits.count({ where: { userId: id('o2') } })).toBe(0);

      const orphans = numberedPage(AdminTournament).parse((await h.call('ana', 'GET', '/admin/tournaments?orphan=true&q=RN09')).data);
      expect(orphans.items.map((x) => x.id)).toEqual([liga.id]);
      expect(orphans.items.every((x) => !x.hasOwner)).toBe(true);
      // Dar um responsável tira o campeonato da fila (continua pausado: quem retoma é o novo dono).
      const fixed = await h.call('ana', 'POST', `/admin/tournaments/${liga.id}/owner`, { ownerId: id('diego'), reason: 'Diego assume a liga' });
      expect(AdminTournament.parse(fixed.data)).toMatchObject({ ownerId: id('diego'), hasOwner: true, status: 'PAUSED' });
      expect(numberedPage(AdminTournament).parse((await h.call('ana', 'GET', '/admin/tournaments?orphan=true&q=RN09')).data).items).toEqual([]);
    });

    it('banir um organizador também aplica a RN-09; finalizado e cancelado ficam como estão', async () => {
      await h.makeUser('o3', ['ORGANIZER']);
      const a = await tournament('o3', 'REGISTRATION_OPEN', 'Banido A');
      const b = await tournament('o3', 'PUBLISHED', 'Banido B');
      const done = await tournament('o3', 'FINISHED', 'Banido C');
      const off = await tournament('o3', 'CANCELLED', 'Banido D');
      const res = SanctionResult.parse((await h.call('ana', 'POST', `/admin/users/${id('o3')}/sanctions`, { type: 'BAN', reason: 'Fraude em premiação' })).data);
      expect(res.affectedTournaments.map((t) => [t.id, t.outcome]).sort()).toEqual(
        [
          [a.id, 'PAUSED'],
          [b.id, 'PAUSED'],
        ].sort(),
      );
      expect((await db.tournament.findUniqueOrThrow({ where: { id: done.id } })).status).toBe('FINISHED');
      expect((await db.tournament.findUniqueOrThrow({ where: { id: off.id } })).status).toBe('CANCELLED');
    });

    it('fila de pedidos: recusar sem motivo é 400; recusar com motivo notifica e não concede; aprovar concede com o limite padrão', async () => {
      await h.makeUser('r1', []);
      await h.makeUser('r2', []);
      const one = await db.organizerRequest.create({ data: { userId: id('r1'), justification: 'Organizo campeonatos de Free Fire na minha cidade.' } });
      const two = await db.organizerRequest.create({ data: { userId: id('r2'), justification: 'Quero organizar ligas semanais.' } });
      const queue = z.array(AdminOrganizerRequest).parse((await h.call('ana', 'GET', '/admin/organizer-requests?status=PENDING')).data);
      expect(queue.find((r) => r.id === one.id)).toMatchObject({ userId: id('r1'), status: 'PENDING', tournamentsPlayed: 0, sanctions: 0 });

      expect((await h.call('ana', 'PATCH', `/admin/organizer-requests/${one.id}`, { action: 'reject' })).status).toBe(400);
      expect((await h.call('ana', 'PATCH', `/admin/organizer-requests/${one.id}`, { action: 'reject', reason: 'x' })).status).toBe(400);
      const res = await h.call('ana', 'PATCH', `/admin/organizer-requests/${one.id}`, { action: 'reject', reason: 'Conta muito nova, tente de novo em 30 dias' });
      expect(AdminOrganizerRequest.parse(res.data)).toMatchObject({ status: 'REJECTED', reviewReason: 'Conta muito nova, tente de novo em 30 dias' });
      expect(await db.userRole.count({ where: { userId: id('r1'), role: 'ORGANIZER' } })).toBe(0);
      expect(await db.notification.count({ where: { userId: id('r1'), type: 'ORGANIZER_REQUEST_RESULT', title: 'Pedido de organizador recusado' } })).toBe(1);
      expect(await lastAudit(db, 'ORGANIZER_REQUEST_REVIEWED', { entityId: one.id })).toMatchObject({ actorId: id('ana'), after: { situacao: 'REJECTED' }, reason: 'Conta muito nova, tente de novo em 30 dias' });
      expect((await h.call('ana', 'PATCH', `/admin/organizer-requests/${one.id}`, { action: 'approve' })).status).toBe(409);

      expect((await h.call('ana', 'PATCH', `/admin/organizer-requests/${two.id}`, { action: 'approve' })).status).toBe(200);
      expect(await db.organizerLimits.findUnique({ where: { userId: id('r2') } })).toMatchObject({ maxActiveTournaments: 3, allowedGameIds: [] });
      expect(await db.notification.count({ where: { userId: id('r2'), title: 'Pedido de organizador aprovado', link: '/organizador' } })).toBe(1);
      expect(await lastAudit(db, 'ROLE_GRANTED', { entityId: id('r2') })).toMatchObject({ actorId: id('ana'), after: { role: 'ORGANIZER' } });
      // O novo organizador entra na área dele.
      expect((await h.call('r2', 'GET', '/organizer/tournaments')).status).toBe(200);
    });
  });

  it('ação recusada (sem permissão ou inválida) não deixa registro', async () => {
    await h.makeUser('z1', []);
    const before = await db.auditLog.count({ where: { OR: [{ actorId: id('bianca') }, { entityId: id('z1') }] } });
    await h.call('bianca', 'POST', `/admin/users/${id('z1')}/sanctions`, { type: 'BAN', reason: 'Sem permissão' });
    await h.call('ana', 'POST', `/admin/users/${id('rafael')}/sanctions`, { type: 'BAN', reason: 'Sem permissão' });
    await h.call('ana', 'POST', `/admin/users/${id('z1')}/roles`, { role: 'NADA' });
    expect(await db.auditLog.count({ where: { OR: [{ actorId: id('bianca') }, { entityId: id('z1') }] } })).toBe(before);
    expect(await auditCount(db, 'USER_SANCTIONED', { entityId: id('rafael') })).toBe(0);
  });
});
