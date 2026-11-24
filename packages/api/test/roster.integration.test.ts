/**
 * Elenco da inscrição de squad e avisos do fluxo de inscrição, contra um Postgres de verdade (`TEST_DATABASE_URL`).
 * - Quem recusa sai do elenco; quem entra no squad pelo link entra no elenco e o squad completa (bug da validação).
 * - Capitão escala e tira membros até a trava de elenco; depois só a organização.
 * - Organização escala, tira e remaneja entre squads (auditado); exclusividade por campeonato, limite do elenco e ID do jogo.
 * - Avisos: "Confirme sua participação", "Inscrição confirmada", convite por apelido e trocas feitas pela organização.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { AcceptTeamInviteResult, Problem, Registration, RosterChangeResult, TeamInvite } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('elenco e avisos da inscrição (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const nick = (k: string) => `ro${k}${stamp}`.slice(0, 20);
  let game = { id: '', modeId: '', modelId: '' };
  const suffix = () => Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0').toUpperCase();

  async function makeUsers(keys: string[]) {
    await db.user.createMany({ data: keys.map((k) => ({ email: `ro.${k}.${stamp}@exemplo.com`, nickname: nick(k), nicknameKey: nick(k).toLowerCase() })) });
    const users = await db.user.findMany({ where: { email: { in: keys.map((k) => `ro.${k}.${stamp}@exemplo.com`) } } });
    await db.userRole.createMany({ data: users.map((u) => ({ userId: u.id, role: 'PARTICIPANT' as const })) });
    for (const u of users) {
      const key = u.email.split('.')[1] ?? '';
      const session = await db.session.create({ data: { userId: u.id, familyId: randomUUID(), refreshTokenHash: `ro-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
      cookies.set(key, `na_at=${await signAccessToken(env, { sub: u.id, sid: session.id, sv: 0, tfa: false, roles: ['PARTICIPANT'] }, new Date())}`);
      ids.set(key, u.id);
    }
  }
  const id = (k: string) => ids.get(k) ?? '';

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
  const account = (k: string) => db.gameAccount.create({ data: { userId: id(k), gameId: game.id, fields: { playerId: `${k}-${stamp}` } } });
  const notes = (k: string, type?: string) => db.notification.findMany({ where: { userId: id(k), ...(type ? { type: type as never } : {}) }, orderBy: { createdAt: 'asc' } });

  async function tournament(opts: { rosterLockAt?: Date | null; status?: 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'FINISHED'; max?: number } = {}) {
    return db.tournament.create({
      data: {
        slug: `copa-ro-${stamp}-${randomUUID().slice(0, 6)}`,
        name: `Copa Elenco ${randomUUID().slice(0, 4)}`,
        gameId: game.id,
        gameModeId: game.modeId,
        ownerId: id('dono'),
        status: opts.status ?? 'REGISTRATION_OPEN',
        participantType: 'TEAM',
        maxParticipants: opts.max ?? 8,
        rosterLockAt: opts.rosterLockAt ?? null,
      },
    });
  }
  async function team(captain: string, members: string[]) {
    return db.team.create({ data: { name: `Squad ${captain} ${suffix()}`, tag: `${captain.slice(0, 1).toUpperCase()}${suffix()}`, captainId: id(captain), members: { create: [{ userId: id(captain), role: 'CAPTAIN' }, ...members.map((m) => ({ userId: id(m) }))] } } });
  }
  async function register(captain: string, tournamentId: string, teamId: string) {
    const res = await call(captain, `/tournaments/${tournamentId}/registrations`, { method: 'POST', body: { acceptRules: true, teamId } });
    expect(res.status, JSON.stringify(res.data)).toBe(201);
    return Registration.parse(res.data);
  }
  const mine = async (who: string, tournamentId: string) => Registration.parse((await call(who, `/tournaments/${tournamentId}/my-registration`)).data);

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 5 });
    app = createApp({ env, deps: { db: () => db } });
    const g = await db.game.create({
      data: {
        slug: `ro-${stamp}`,
        name: `Elenco ${stamp}`,
        requiredAccountFields: [{ key: 'playerId', label: 'ID' }],
        modes: { create: { name: '2x2', teamSize: 2, maxSubs: 1, matchType: 'TEAM_VS_TEAM' } },
        scoringModels: { create: { name: 'V', matchType: 'TEAM_VS_TEAM', rules: DUEL_RULES, tiebreakers: ['points'] } },
      },
      include: { modes: true, scoringModels: true },
    });
    game = { id: g.id, modeId: g.modes[0]?.id ?? '', modelId: g.scoringModels[0]?.id ?? '' };
    await makeUsers(['dono', 'coorg', 'mod', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'semid']);
    await db.userRole.create({ data: { userId: id('dono'), role: 'ORGANIZER' } });
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']) await account(k);
  }, 60_000);
  afterAll(async () => {
    await db.$disconnect();
  });

  it('membro recusa; quem entra no squad pelo link entra no elenco já confirmado e o squad completa (com avisos)', async () => {
    const t = await tournament();
    const sq = await team('a', ['b']);
    const reg = await register('a', t.id, sq.id);
    expect(reg.status).toBe('PENDING_MEMBERS');
    // PRD §12.2: o elenco recebe "Confirme sua participação".
    const toConfirm = await notes('b', 'TEAM_INVITE');
    expect(toConfirm.at(-1)).toMatchObject({ title: `Confirme sua participação em ${t.name}`, link: `/c/${t.slug}` });

    expect((await call('b', `/registrations/${reg.id}/decline`, { method: 'POST' })).status).toBe(204);
    const link = TeamInvite.parse((await call('a', `/teams/${sq.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    const joined = AcceptTeamInviteResult.parse((await call('c', `/team-invites/${link.code}/accept`, { method: 'POST' })).data);
    expect(joined.rosters).toEqual([{ registrationId: reg.id, tournamentId: t.id, tournamentName: t.name, tournamentSlug: t.slug, confirmed: true }]);
    const after = await mine('a', t.id);
    expect(after.status).toBe('CONFIRMED');
    expect(after.members.map((m) => m.userId).sort()).toEqual([id('a'), id('c')].sort());
    // "Inscrição confirmada" para o elenco e "novo jogador" para o capitão.
    expect((await notes('c', 'REGISTRATION_CONFIRMED')).map((n) => n.link)).toContain(`/c/${t.slug}`);
    expect((await notes('a', 'TEAM_INVITE')).some((n) => n.title.startsWith('Novo jogador'))).toBe(true);
  });

  it('sem o ID do jogo, entra no elenco pendente e recebe o aviso para confirmar; squad que não espera ninguém não muda', async () => {
    const t = await tournament();
    const sq = await team('d', []);
    // Squad de 1 num modo 2x2: o capitão não consegue inscrever. Monta a inscrição direto, como um squad que perdeu gente.
    const reg = await db.registration.create({ data: { tournamentId: t.id, teamId: sq.id, status: 'PENDING_MEMBERS', members: { create: { tournamentId: t.id, userId: id('d'), isCaptain: true, confirmedAt: new Date() } } } });
    const link = TeamInvite.parse((await call('d', `/teams/${sq.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    const joined = AcceptTeamInviteResult.parse((await call('semid', `/team-invites/${link.code}/accept`, { method: 'POST' })).data);
    expect(joined.rosters.map((r) => r.confirmed)).toEqual([false]);
    expect((await mine('d', t.id)).status).toBe('PENDING_MEMBERS');
    expect((await notes('semid', 'TEAM_INVITE')).some((n) => n.title === `Confirme sua participação em ${t.name}`)).toBe(true);

    // Com o elenco cheio (2 + 1 reserva), o próximo entra só no squad.
    await call('e', `/team-invites/${link.code}/accept`, { method: 'POST' });
    const third = AcceptTeamInviteResult.parse((await call('f', `/team-invites/${link.code}/accept`, { method: 'POST' })).data);
    expect(third.rosters).toEqual([]);
    expect((await db.registrationMember.count({ where: { registrationId: reg.id } }))).toBe(3);
  });

  it('capitão escala e tira membros do squad até a trava de elenco; depois só a organização', async () => {
    const lock = new Date(Date.now() + 3600_000);
    const t = await tournament({ rosterLockAt: lock });
    const sq = await team('g', ['h', 'i']);
    const reg = await register('g', t.id, sq.id);
    // Tira o reserva e escala de novo: entra pendente e recebe o aviso.
    expect(RosterChangeResult.parse((await call('g', `/registrations/${reg.id}/members/${id('i')}`, { method: 'DELETE' })).data).registrations[0]?.members).toHaveLength(2);
    const added = RosterChangeResult.parse((await call('g', `/registrations/${reg.id}/members`, { method: 'POST', body: { userId: id('i') } })).data);
    expect(added.registrations[0]?.members.find((m) => m.userId === id('i'))?.confirmedAt).toBeNull();
    expect(code((await call('g', `/registrations/${reg.id}/members`, { method: 'POST', body: { userId: id('j') } })).data)).toBe('NOT_A_MEMBER');
    expect(code((await call('g', `/registrations/${reg.id}/members/${id('g')}`, { method: 'DELETE' })).data)).toBe('CAPTAIN_IN_ROSTER');
    // Membro comum e moderador não mexem no elenco.
    expect(code((await call('h', `/registrations/${reg.id}/members/${id('i')}`, { method: 'DELETE' })).data)).toBe('NOT_ROSTER_MANAGER');
    await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: id('mod'), role: 'MODERATOR', addedById: id('dono') } });
    expect((await call('mod', `/registrations/${reg.id}/members/${id('i')}`, { method: 'DELETE' })).status).toBe(403);

    await db.tournament.update({ where: { id: t.id }, data: { rosterLockAt: new Date(Date.now() - 1000) } });
    expect(code((await call('g', `/registrations/${reg.id}/members/${id('i')}`, { method: 'DELETE' })).data)).toBe('ROSTER_LOCKED');
    expect((await call('dono', `/registrations/${reg.id}/members/${id('i')}`, { method: 'DELETE' })).status).toBe(200);
    expect((await notes('i', 'TEAM_INVITE')).at(-1)?.title).toMatch(/^Você saiu do elenco/);
    const audit = await db.auditLog.findFirst({ where: { entityId: reg.id, action: 'ROSTER_CHANGED' } });
    expect(audit).not.toBeNull();
  });

  it('organização escala e remaneja entre squads; exclusividade, limite do elenco, ID do jogo e status', async () => {
    const t = await tournament();
    const s1 = await team('a', ['b']);
    const s2 = await team('j', ['k']);
    const r1 = await register('a', t.id, s1.id);
    const r2 = await register('j', t.id, s2.id);
    for (const [who, r] of [['b', r1], ['k', r2]] as const) expect((await call(who, `/registrations/${r.id}/confirm`, { method: 'POST' })).status).toBe(200);
    expect((await mine('a', t.id)).status).toBe('CONFIRMED');
    // "Inscrição confirmada" quando o último confirma.
    expect((await notes('b', 'REGISTRATION_CONFIRMED')).some((n) => n.link === `/c/${t.slug}`)).toBe(true);

    // Escalar pelo apelido (entra confirmado) e a exclusividade por campeonato.
    const added = RosterChangeResult.parse((await call('dono', `/registrations/${r1.id}/members`, { method: 'POST', body: { nickname: `@${nick('e')}` } })).data);
    expect(added.registrations[0]?.members.find((m) => m.userId === id('e'))).toMatchObject({ isSub: true });
    expect(added.registrations[0]?.members.find((m) => m.userId === id('e'))?.confirmedAt).not.toBeNull();
    expect(code((await call('dono', `/registrations/${r2.id}/members`, { method: 'POST', body: { userId: id('e') } })).data)).toBe('PLAYER_IN_OTHER_TEAM');
    expect(code((await call('dono', `/registrations/${r1.id}/members`, { method: 'POST', body: { userId: id('f') } })).data)).toBe('ROSTER_FULL');
    expect(code((await call('dono', `/registrations/${r2.id}/members`, { method: 'POST', body: { userId: id('semid') } })).data)).toBe('GAME_ACCOUNT_REQUIRED');
    expect(code((await call('dono', `/registrations/${r2.id}/members`, { method: 'POST', body: { nickname: 'ninguem-existe' } })).data)).toBe('USER_NOT_FOUND');

    // Remanejar: B sai do squad 1 e entra no 2 (squad 1 fica com A e o reserva E: continua com 2 confirmados).
    const moved = RosterChangeResult.parse((await call('dono', `/registrations/${r1.id}/members/${id('b')}/move`, { method: 'POST', body: { toRegistrationId: r2.id } })).data);
    expect(moved.registrations.map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(moved.registrations[1]?.members.map((m) => m.userId)).toContain(id('b'));
    expect(moved.registrations.map((r) => r.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    expect((await notes('b', 'TEAM_INVITE')).at(-1)?.title).toBe(`Você foi remanejado para o ${s2.name}`);
    expect(code((await call('dono', `/registrations/${r2.id}/members/${id('j')}/move`, { method: 'POST', body: { toRegistrationId: r1.id } })).data)).toBe('CAPTAIN_IN_ROSTER');
    expect((await call('a', `/registrations/${r2.id}/members/${id('b')}/move`, { method: 'POST', body: { toRegistrationId: r1.id } })).status).toBe(403);

    // Tirar alguém antes do início derruba o mínimo: a inscrição volta a aguardar membros e completa de novo.
    await call('dono', `/registrations/${r1.id}/members/${id('e')}`, { method: 'DELETE' });
    expect((await mine('a', t.id)).status).toBe('PENDING_MEMBERS');
    await call('dono', `/registrations/${r1.id}/members`, { method: 'POST', body: { userId: id('f') } });
    expect((await mine('a', t.id)).status).toBe('CONFIRMED');
  });

  it('com o campeonato em andamento a organização troca sem mexer no status; encerrado, ninguém troca', async () => {
    const t = await tournament();
    const sq = await team('c', ['d']);
    const reg = await register('c', t.id, sq.id);
    await call('d', `/registrations/${reg.id}/confirm`, { method: 'POST' });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    expect(code((await call('c', `/registrations/${reg.id}/members/${id('d')}`, { method: 'DELETE' })).data)).toBe('ROSTER_LOCKED');
    expect((await call('dono', `/registrations/${reg.id}/members/${id('d')}`, { method: 'DELETE' })).status).toBe(200);
    expect((await mine('c', t.id)).status).toBe('CONFIRMED');
    await db.tournament.update({ where: { id: t.id }, data: { status: 'FINISHED' } });
    expect(code((await call('dono', `/registrations/${reg.id}/members`, { method: 'POST', body: { userId: id('d') } })).data)).toBe('ROSTER_CLOSED');
  });

  it('convite por apelido avisa o convidado; inscrição solo confirmada avisa o inscrito', async () => {
    const sq = await team('h', []);
    const invite = TeamInvite.parse((await call('h', `/teams/${sq.id}/invites`, { method: 'POST', body: { kind: 'nickname', nickname: nick('k') } })).data);
    expect((await notes('k', 'TEAM_INVITE')).at(-1)).toMatchObject({ title: `Convite para o ${sq.name}`, link: `/squads/convite/${invite.code}` });

    const solo = await db.game.create({ data: { slug: `ro-solo-${stamp}`, name: `Solo ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    const t = await db.tournament.create({ data: { slug: `copa-ro-solo-${stamp}`, name: 'Copa Solo Elenco', gameId: solo.id, gameModeId: solo.modes[0]?.id ?? '', ownerId: id('dono'), status: 'REGISTRATION_OPEN', participantType: 'SOLO', maxParticipants: 4 } });
    expect((await call('i', `/tournaments/${t.id}/registrations`, { method: 'POST', body: { acceptRules: true } })).status).toBe(201);
    expect((await notes('i', 'REGISTRATION_CONFIRMED')).at(-1)).toMatchObject({ body: 'Sua vaga em Copa Solo Elenco está garantida.', link: `/c/${t.slug}` });
  });
});
