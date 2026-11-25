/**
 * Convite por link para a equipe do campeonato e reabertura das inscrições (RN-16), contra um Postgres de verdade
 * (`TEST_DATABASE_URL`).
 *
 * Critérios: só o responsável cria, lista e revoga; o token não fica no banco nem na auditoria; expirado, revogado
 * ou esgotado = 410 sem mudar nada; o último uso vale para uma pessoa só sob concorrência; quem está inscrito não
 * entra; reabrir só antes de a chave ser confirmada.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { AcceptStaffInviteResponse, MyStaffTournament, OrganizerTournamentDetail, Problem, StaffInvitePreview, TournamentStaff, TournamentStaffInvite } from '@nova/schemas';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES, publishableDraft } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url, NEXT_PUBLIC_SITE_URL: 'https://novaarena.test' });
const DAY = 24 * 3600_000;

describe.skipIf(!url)('equipe por link e reabertura das inscrições (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let fixture = { gameId: '', modeId: '', modelId: '' };

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[], extra: { emailVerified?: boolean; status?: 'ACTIVE' | 'SUSPENDED' } = {}) {
    const nickname = `si${key}${stamp}`;
    const user = await db.user.create({
      data: { email: `si.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), emailVerified: extra.emailVerified ?? true, status: extra.status ?? 'ACTIVE', roles: { create: roles.map((role) => ({ role })) } },
    });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `si-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: true, roles }, new Date())}`);
    ids.set(key, user.id);
    return user;
  }

  const call = async (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(who ? { Cookie: cookies.get(who) ?? '' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    return { status: res.status, data: text ? (JSON.parse(text) as unknown) : null };
  };
  const code = (data: unknown) => Problem.parse(data).code;
  const tokenOf = (invite: TournamentStaffInvite) => (invite.link ?? '').split('/equipe/convite/')[1] ?? '';

  async function published(who = 'dono') {
    const res = await call(who, '/tournaments', { method: 'POST', body: { ...publishableDraft(fixture), name: `Copa ${randomUUID().slice(0, 6)}` } });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    const id = OrganizerTournamentDetail.parse(res.data).id;
    const pub = await call(who, `/tournaments/${id}/publish`, { method: 'POST' });
    expect(pub.status, JSON.stringify(pub.data)).toBe(200);
    return OrganizerTournamentDetail.parse(pub.data);
  }

  async function createInvite(tournamentId: string, body: { role: 'CO_ORGANIZER' | 'MODERATOR'; validity: '1h' | '24h' | '7d'; maxUses: number }, who = 'dono') {
    const res = await call(who, `/tournaments/${tournamentId}/staff-invites`, { method: 'POST', body });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    return TournamentStaffInvite.parse(res.data);
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 5 });
    app = createApp({ env, deps: { db: () => db } });
    const game = await db.game.create({
      data: {
        slug: `duelo-si-${stamp}`,
        name: `Duelo SI ${stamp}`,
        modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } },
        scoringModels: { create: { name: 'Vitória', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points', 'wins'], isDefault: true } },
      },
      include: { modes: true, scoringModels: true },
    });
    fixture = { gameId: game.id, modeId: game.modes[0]?.id ?? '', modelId: game.scoringModels[0]?.id ?? '' };
    const dono = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    // Muitos campeonatos ativos neste arquivo: limite alto para o responsável (RN-10 não é o assunto aqui).
    await db.organizerLimits.create({ data: { userId: dono.id, maxActiveTournaments: 100, allowedGameIds: [], verified: true } });
    await makeUser('coorg', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('jog', ['PARTICIPANT']);
    await makeUser('jog2', ['PARTICIPANT']);
    await makeUser('jog3', ['PARTICIPANT']);
    await makeUser('jog4', ['PARTICIPANT']);
    await makeUser('naoverif', ['PARTICIPANT'], { emailVerified: false });
    await makeUser('inscrito', ['PARTICIPANT']);
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('cria, lista, mostra a prévia e aceita: a pessoa entra na equipe com o papel do link e acha o campeonato', async () => {
    const t = await published();
    const invite = await createInvite(t.id, { role: 'MODERATOR', validity: '24h', maxUses: 2 });
    expect(invite).toMatchObject({ role: 'MODERATOR', maxUses: 2, uses: 0, state: 'VALID', tournamentId: t.id });
    expect(invite.link).toMatch(/^https:\/\/novaarena\.test\/equipe\/convite\/[0-9a-f]{48}$/);
    const token = tokenOf(invite);

    // O banco guarda só o hash; a auditoria não leva o token.
    const row = await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    const logs = await db.auditLog.findMany({ where: { entityId: invite.id } });
    expect(logs.map((l) => l.action)).toEqual(['INVITE_CREATED']);
    expect(JSON.stringify(logs.map((l) => ({ before: l.before, after: l.after, label: l.entityLabel })))).not.toContain(token);

    // A lista não devolve o link.
    const list = z.array(TournamentStaffInvite).parse((await call('dono', `/tournaments/${t.id}/staff-invites`)).data);
    expect(list).toEqual([expect.objectContaining({ id: invite.id, link: null, state: 'VALID' })]);

    // Prévia pública (sem login).
    const preview = StaffInvitePreview.parse((await call(null, `/staff-invites/${token}`)).data);
    expect(preview).toMatchObject({ role: 'MODERATOR', state: 'VALID', tournament: { id: t.id, slug: t.slug, name: t.name }, invitedBy: `sidono${stamp}` });
    expect((await call(null, `/staff-invites/naoexiste123456`)).status).toBe(404);

    // Aceitar exige login.
    expect((await call(null, `/staff-invites/${token}/accept`, { method: 'POST' })).status).toBe(401);
    const accepted = await call('jog', `/staff-invites/${token}/accept`, { method: 'POST' });
    expect(accepted.status, JSON.stringify(accepted.data)).toBe(200);
    expect(AcceptStaffInviteResponse.parse(accepted.data)).toEqual({ tournamentId: t.id, slug: t.slug, role: 'MODERATOR' });

    const staff = z.array(TournamentStaff).parse((await call('dono', `/tournaments/${t.id}/staff`)).data);
    expect(staff).toEqual([expect.objectContaining({ userId: ids.get('jog'), role: 'MODERATOR' })]);
    const entry = await db.tournamentStaff.findUniqueOrThrow({ where: { tournamentId_userId: { tournamentId: t.id, userId: ids.get('jog') as string } } });
    expect(entry.addedById).toBe(ids.get('dono'));
    expect((await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(1);
    const staffLog = await db.auditLog.findFirst({ where: { entityId: t.id, action: 'STAFF_CHANGED' }, orderBy: { id: 'desc' } });
    expect(staffLog?.actorId).toBe(ids.get('jog'));

    // Participante (sem papel de organizador) entra na gestão do campeonato e o acha em "ajudo a organizar".
    expect((await call('jog', `/organizer/tournaments/${t.id}`)).status).toBe(200);
    const mine = z.array(MyStaffTournament).parse((await call('jog', '/me/staff-tournaments')).data);
    expect(mine).toEqual([expect.objectContaining({ id: t.id, slug: t.slug, role: 'MODERATOR', status: 'REGISTRATION_OPEN' })]);
    expect(z.array(MyStaffTournament).parse((await call('jog2', '/me/staff-tournaments')).data)).toEqual([]);
    expect((await call(null, '/me/staff-tournaments')).status).toBe(401);

    // De novo: já é da equipe (e o uso não é contado).
    expect(code((await call('jog', `/staff-invites/${token}/accept`, { method: 'POST' })).data)).toBe('ALREADY_STAFF');
    expect((await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(1);
    // O responsável não entra na própria equipe.
    expect(code((await call('dono', `/staff-invites/${token}/accept`, { method: 'POST' })).data)).toBe('ALREADY_OWNER');
  });

  it('só o responsável (ou o Admin) cria, lista e revoga; co-organizador e moderador não', async () => {
    const t = await published();
    await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `sicoorg${stamp}`, role: 'CO_ORGANIZER' } });
    const body = { role: 'CO_ORGANIZER', validity: '1h', maxUses: 1 };
    expect((await call('coorg', `/tournaments/${t.id}/staff-invites`, { method: 'POST', body })).status).toBe(403);
    expect((await call('coorg', `/tournaments/${t.id}/staff-invites`)).status).toBe(403);
    expect((await call('jog2', `/tournaments/${t.id}/staff-invites`, { method: 'POST', body })).status).toBe(403);
    expect((await call(null, `/tournaments/${t.id}/staff-invites`, { method: 'POST', body })).status).toBe(401);
    expect((await call('adm', `/tournaments/${t.id}/staff-invites`, { method: 'POST', body })).status).toBe(201);
    // Validação do corpo.
    const bad = await call('dono', `/tournaments/${t.id}/staff-invites`, { method: 'POST', body: { role: 'DONO', validity: '2h', maxUses: 11 } });
    expect(bad.status).toBe(400);
    expect(Object.keys(Problem.parse(bad.data).errors ?? {}).sort()).toEqual(['maxUses', 'role', 'validity']);
  });

  it('expirado, revogado ou esgotado = 410 sem mudar nada', async () => {
    const t = await published();
    // Revogado.
    const revoked = await createInvite(t.id, { role: 'MODERATOR', validity: '7d', maxUses: 3 });
    const del = await call('dono', `/tournaments/${t.id}/staff-invites/${revoked.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(TournamentStaffInvite.parse(del.data).state).toBe('REVOKED');
    expect(code((await call('dono', `/tournaments/${t.id}/staff-invites/${revoked.id}`, { method: 'DELETE' })).data)).toBe('INVITE_REVOKED');
    expect(StaffInvitePreview.parse((await call(null, `/staff-invites/${tokenOf(revoked)}`)).data).state).toBe('REVOKED');
    const r1 = await call('jog2', `/staff-invites/${tokenOf(revoked)}/accept`, { method: 'POST' });
    expect([r1.status, code(r1.data)]).toEqual([410, 'INVITE_REVOKED']);
    // Convite de outro campeonato não se revoga por este.
    const other = await published();
    const foreign = await createInvite(other.id, { role: 'MODERATOR', validity: '1h', maxUses: 1 });
    expect((await call('dono', `/tournaments/${t.id}/staff-invites/${foreign.id}`, { method: 'DELETE' })).status).toBe(404);

    // Expirado.
    const expired = await createInvite(t.id, { role: 'MODERATOR', validity: '1h', maxUses: 1 });
    await db.tournamentStaffInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const r2 = await call('jog2', `/staff-invites/${tokenOf(expired)}/accept`, { method: 'POST' });
    expect([r2.status, code(r2.data)]).toEqual([410, 'INVITE_EXPIRED']);

    // Esgotado.
    const once = await createInvite(t.id, { role: 'MODERATOR', validity: '1h', maxUses: 1 });
    expect((await call('jog2', `/staff-invites/${tokenOf(once)}/accept`, { method: 'POST' })).status).toBe(200);
    const r3 = await call('jog3', `/staff-invites/${tokenOf(once)}/accept`, { method: 'POST' });
    expect([r3.status, code(r3.data)]).toEqual([410, 'INVITE_EXHAUSTED']);

    expect(await db.tournamentStaff.count({ where: { tournamentId: t.id } })).toBe(1);
    expect((await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: revoked.id } })).uses).toBe(0);
  });

  it('o último uso vale para uma pessoa só, mesmo com aceites ao mesmo tempo', async () => {
    const t = await published();
    const invite = await createInvite(t.id, { role: 'CO_ORGANIZER', validity: '1h', maxUses: 1 });
    const results = await Promise.all(['jog2', 'jog3', 'jog4'].map((who) => call(who, `/staff-invites/${tokenOf(invite)}/accept`, { method: 'POST' })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410).map((r) => code(r.data))).toEqual(['INVITE_EXHAUSTED', 'INVITE_EXHAUSTED']);
    expect(await db.tournamentStaff.count({ where: { tournamentId: t.id } })).toBe(1);
    expect((await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(1);
  });

  it('quem está inscrito, sem e-mail confirmado ou com o campeonato cancelado não entra', async () => {
    const t = await published();
    const invite = await createInvite(t.id, { role: 'MODERATOR', validity: '24h', maxUses: 5 });
    await db.registration.create({ data: { tournamentId: t.id, userId: ids.get('inscrito') as string, status: 'CONFIRMED' } });
    expect(code((await call('inscrito', `/staff-invites/${tokenOf(invite)}/accept`, { method: 'POST' })).data)).toBe('STAFF_IS_REGISTERED');
    expect(code((await call('naoverif', `/staff-invites/${tokenOf(invite)}/accept`, { method: 'POST' })).data)).toBe('EMAIL_NOT_VERIFIED');
    expect((await db.tournamentStaffInvite.findUniqueOrThrow({ where: { id: invite.id } })).uses).toBe(0);

    await call('dono', `/tournaments/${t.id}/cancel`, { method: 'POST', body: { reason: 'Falta de inscritos' } });
    expect(code((await call('jog3', `/staff-invites/${tokenOf(invite)}/accept`, { method: 'POST' })).data)).toBe('TOURNAMENT_READ_ONLY');
    expect(code((await call('dono', `/tournaments/${t.id}/staff-invites`, { method: 'POST', body: { role: 'MODERATOR', validity: '1h', maxUses: 1 } })).data)).toBe('TOURNAMENT_READ_ONLY');
  });

  it('a regra é a mesma por apelido: inscrito não entra na equipe', async () => {
    const t = await published();
    await db.registration.create({ data: { tournamentId: t.id, userId: ids.get('jog4') as string, status: 'WAITLIST' } });
    expect(code((await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `sijog4${stamp}`, role: 'MODERATOR' } })).data)).toBe('STAFF_IS_REGISTERED');
  });

  describe('reabrir as inscrições (RN-16)', () => {
    it('com a data nova no futuro reabre; sem ela, pede a data; depois de confirmar a chave, não reabre', async () => {
      const t = await published();
      const closed = OrganizerTournamentDetail.parse((await call('dono', `/tournaments/${t.id}/close-registration`, { method: 'POST' })).data);
      expect(closed.status).toBe('REGISTRATION_CLOSED');

      // O fechamento antecipado gravou a data de agora: sem data nova, não reabre.
      const noDate = await call('dono', `/tournaments/${t.id}/open-registration`, { method: 'POST' });
      expect([noDate.status, code(noDate.data)]).toEqual([409, 'REGISTRATION_DEADLINE_PASSED']);
      expect(Problem.parse(noDate.data).title).toContain('nova data de fechamento');

      const past = await call('dono', `/tournaments/${t.id}/open-registration`, { method: 'POST', body: { registrationClosesAt: new Date(Date.now() - DAY).toISOString() } });
      expect(past.status).toBe(400);
      expect(Problem.parse(past.data).errors?.registrationClosesAt).toBeTruthy();
      const afterStart = await call('dono', `/tournaments/${t.id}/open-registration`, { method: 'POST', body: { registrationClosesAt: new Date(Date.now() + 30 * DAY).toISOString() } });
      expect(afterStart.status).toBe(400);

      // Moderador não reabre; responsável e co-organizador sim.
      await call('dono', `/tournaments/${t.id}/staff`, { method: 'POST', body: { nickname: `sijog${stamp}`, role: 'MODERATOR' } });
      const newClose = new Date(Date.now() + 2 * DAY).toISOString();
      expect((await call('jog', `/tournaments/${t.id}/open-registration`, { method: 'POST', body: { registrationClosesAt: newClose } })).status).toBe(403);
      const reopened = await call('dono', `/tournaments/${t.id}/open-registration`, { method: 'POST', body: { registrationClosesAt: newClose } });
      expect(reopened.status, JSON.stringify(reopened.data)).toBe(200);
      const view = OrganizerTournamentDetail.parse(reopened.data);
      expect(view.status).toBe('REGISTRATION_OPEN');
      expect(view.registrationClosesAt).toBe(newClose);
      // A data de abertura original fica.
      expect(view.registrationOpensAt).toBe(closed.registrationOpensAt);
      const log = await db.auditLog.findFirst({ where: { entityId: t.id, action: 'TOURNAMENT_STATUS_CHANGED' }, orderBy: { id: 'desc' } });
      expect(log).toMatchObject({ reason: 'Inscrições reabertas', after: { status: 'REGISTRATION_OPEN' } });

      // Inscrição volta a funcionar.
      expect((await call('jog3', `/tournaments/${t.id}/registrations`, { method: 'POST', body: { acceptRules: true } })).status).toBe(201);

      // Fecha de novo e confirma a chave: não reabre mais (o campeonato também já estaria em andamento).
      await call('dono', `/tournaments/${t.id}/close-registration`, { method: 'POST' });
      const stage = await db.stage.findFirstOrThrow({ where: { tournamentId: t.id } });
      await db.stage.update({ where: { id: stage.id }, data: { confirmedAt: new Date() } });
      const blocked = await call('dono', `/tournaments/${t.id}/open-registration`, { method: 'POST', body: { registrationClosesAt: newClose } });
      expect([blocked.status, code(blocked.data)]).toEqual([409, 'BRACKET_CONFIRMED']);
    });

    it('abrir um campeonato só publicado continua igual (sem corpo)', async () => {
      const res = await call('dono', '/tournaments', { method: 'POST', body: { ...publishableDraft(fixture), registrationOpensAt: new Date(Date.now() + DAY).toISOString(), name: `Copa ${randomUUID().slice(0, 6)}` } });
      const id = OrganizerTournamentDetail.parse(res.data).id;
      expect(OrganizerTournamentDetail.parse((await call('dono', `/tournaments/${id}/publish`, { method: 'POST' })).data).status).toBe('PUBLISHED');
      const opened = await call('dono', `/tournaments/${id}/open-registration`, { method: 'POST' });
      expect(opened.status).toBe(200);
      expect(OrganizerTournamentDetail.parse(opened.data).status).toBe('REGISTRATION_OPEN');
      // Em andamento não "reabre".
      expect(code((await call('dono', `/tournaments/${id}/open-registration`, { method: 'POST' })).data)).toBe('INVALID_TRANSITION');
    });
  });
});
