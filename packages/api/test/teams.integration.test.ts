/**
 * Squads contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): criar, convidar, entrar, sair,
 * capitania e exclusão (issue #78).
 * Critérios de aceite: convite expirado recusado; jogador não fica em dois squads no mesmo campeonato.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { InviteCandidate, Problem, Team, TeamInvite, TeamInvitePreview } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('squads (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-6);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  // Tags de até 5 caracteres, únicas por execução.
  const tag = (prefix: string) => `${prefix}${stamp.slice(-3)}`.slice(0, 5).toUpperCase();

  async function makeUser(key: string) {
    const nickname = `sq${key}${stamp}`;
    const user = await db.user.create({ data: { email: `sq.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: { role: 'PARTICIPANT' } } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `sq-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles: ['PARTICIPANT'] }, new Date())}`);
    ids.set(key, user.id);
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

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    for (const key of ['cap', 'ana', 'beto', 'caio', 'dani']) await makeUser(key);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('cria o squad (tag única, filtro de nomes) e convida por apelido; só o capitão vê os convites', async () => {
    const created = await call('cap', '/teams', { method: 'POST', body: { name: 'Squad Alfa', tag: tag('ALF') } });
    expect(created.status).toBe(201);
    const team = Team.parse(created.data);
    expect(team.members.map((m) => m.role)).toEqual(['CAPTAIN']);
    expect(code((await call('ana', '/teams', { method: 'POST', body: { name: 'Outro', tag: tag('alf') } })).data)).toBe('TAG_TAKEN');
    expect((await call('ana', '/teams', { method: 'POST', body: { name: 'Os Merda', tag: 'OSM' } })).status).toBe(400);

    const invite = TeamInvite.parse((await call('cap', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'nickname', nickname: `@sqana${stamp}` } })).data);
    expect(invite.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(code((await call('cap', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'nickname', nickname: `sqana${stamp}` } })).data)).toBe('ALREADY_INVITED');
    expect((await call('ana', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'link' } })).status).toBe(403);
    expect(Team.parse((await call('cap', `/teams/${team.id}`)).data).pendingInvites).toHaveLength(1);
    expect(Team.parse((await call('ana', `/teams/${team.id}`)).data).pendingInvites).toEqual([]);
    expect(z.array(TeamInvite).parse((await call('ana', '/me/team-invites')).data).map((i) => i.id)).toEqual([invite.id]);

    // Convite por apelido é só para quem foi convidado.
    expect(code((await call('beto', `/team-invites/${invite.code}/accept`, { method: 'POST' })).data)).toBe('INVITE_NOT_FOR_YOU');
    const joined = Team.parse((await call('ana', `/team-invites/${invite.code.toLowerCase()}/accept`, { method: 'POST' })).data);
    expect(joined.members).toHaveLength(2);
    expect(code((await call('ana', `/team-invites/${invite.code}/accept`, { method: 'POST' })).data)).toBe('ALREADY_MEMBER');
  });

  it('Convite expirado recusado (e revogado também); link vale para várias pessoas', async () => {
    const team = Team.parse((await call('cap', '/teams', { method: 'POST', body: { name: 'Squad Beta', tag: tag('BET') } })).data);
    const link = TeamInvite.parse((await call('cap', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    const preview = TeamInvitePreview.parse((await call(null, `/team-invites/${link.code}`)).data);
    expect(preview).toMatchObject({ state: 'VALID', team: { name: 'Squad Beta', memberCount: 1 } });
    expect((await call('beto', `/team-invites/${link.code}/accept`, { method: 'POST' })).status).toBe(200);
    expect((await call('caio', `/team-invites/${link.code}/accept`, { method: 'POST' })).status).toBe(200);

    await db.teamInvite.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await call('dani', `/team-invites/${link.code}/accept`, { method: 'POST' });
    expect(expired.status).toBe(410);
    expect(code(expired.data)).toBe('INVITE_EXPIRED');
    expect(TeamInvitePreview.parse((await call(null, `/team-invites/${link.code}`)).data).state).toBe('EXPIRED');

    const other = TeamInvite.parse((await call('cap', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    expect((await call('cap', `/team-invites/${other.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(code((await call('dani', `/team-invites/${other.code}/accept`, { method: 'POST' })).data)).toBe('INVITE_REVOKED');
    expect(code((await call('dani', '/team-invites/ZZZZZZ')).data)).toBe('INVITE_NOT_FOUND');
  });

  it('capitania, reserva, sair e remover; capitão não sai sem transferir', async () => {
    const team = Team.parse((await call('cap', '/teams', { method: 'POST', body: { name: 'Squad Gama', tag: tag('GAM') } })).data);
    const link = TeamInvite.parse((await call('cap', `/teams/${team.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    await call('ana', `/team-invites/${link.code}/accept`, { method: 'POST' });
    await call('beto', `/team-invites/${link.code}/accept`, { method: 'POST' });

    expect(Team.parse((await call('cap', `/teams/${team.id}/members/${ids.get('ana')}`, { method: 'PATCH', body: { isSub: true } })).data).members.find((m) => m.userId === ids.get('ana'))?.isSub).toBe(true);
    expect(code((await call('cap', `/teams/${team.id}/members/${ids.get('cap')}`, { method: 'DELETE' })).data)).toBe('CAPTAIN_MUST_TRANSFER');
    expect((await call('ana', `/teams/${team.id}/members/${ids.get('beto')}`, { method: 'DELETE' })).status).toBe(403);

    const transferred = Team.parse((await call('cap', `/teams/${team.id}/transfer-captain`, { method: 'POST', body: { userId: ids.get('ana') } })).data);
    expect(transferred.captainId).toBe(ids.get('ana'));
    expect(transferred.members.filter((m) => m.role === 'CAPTAIN').map((m) => m.userId)).toEqual([ids.get('ana')]);
    expect((await call('cap', `/teams/${team.id}/members/${ids.get('cap')}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call('ana', `/teams/${team.id}/members/${ids.get('beto')}`, { method: 'DELETE' })).status).toBe(204);
    expect(Team.parse((await call('ana', `/teams/${team.id}`)).data).members.map((m) => m.userId)).toEqual([ids.get('ana')]);
  });

  it('Jogador não fica em dois squads no mesmo campeonato; escalado não sai; squad inscrito não é excluído', async () => {
    const game = await db.game.create({
      data: { slug: `sq-${stamp}`, name: `Squads ${stamp}`, modes: { create: { name: '2x2', teamSize: 2, matchType: 'TEAM_VS_TEAM' } }, scoringModels: { create: { name: 'Vitória', matchType: 'TEAM_VS_TEAM', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true },
    });
    const t = await db.tournament.create({ data: { slug: `copa-sq-${stamp}`, name: 'Copa dos Squads', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: ids.get('dani') ?? '', status: 'REGISTRATION_OPEN', participantType: 'TEAM', maxParticipants: 8 } });
    const a = Team.parse((await call('cap', '/teams', { method: 'POST', body: { name: 'Squad Delta', tag: tag('DEL') } })).data);
    const b = Team.parse((await call('beto', '/teams', { method: 'POST', body: { name: 'Squad Eco', tag: tag('ECO') } })).data);
    const link = TeamInvite.parse((await call('cap', `/teams/${a.id}/invites`, { method: 'POST', body: { kind: 'link' } })).data);
    await call('caio', `/team-invites/${link.code}/accept`, { method: 'POST' });

    const regA = await db.registration.create({ data: { tournamentId: t.id, teamId: a.id, status: 'CONFIRMED', members: { create: [{ tournamentId: t.id, userId: ids.get('cap') ?? '', isCaptain: true }, { tournamentId: t.id, userId: ids.get('caio') ?? '' }] } } });
    expect(regA.id).toBeTruthy();
    // O mesmo jogador escalado por outro squad no mesmo campeonato: o banco recusa.
    await expect(
      db.registration.create({ data: { tournamentId: t.id, teamId: b.id, status: 'CONFIRMED', members: { create: [{ tournamentId: t.id, userId: ids.get('beto') ?? '', isCaptain: true }, { tournamentId: t.id, userId: ids.get('caio') ?? '' }] } } }),
    ).rejects.toThrow();

    expect(code((await call('caio', `/teams/${a.id}/members/${ids.get('caio')}`, { method: 'DELETE' })).data)).toBe('MEMBER_IN_ACTIVE_REGISTRATION');
    expect(code((await call('cap', `/teams/${a.id}`, { method: 'DELETE' })).data)).toBe('TEAM_HAS_ACTIVE_REGISTRATION');

    // Inscrição cancelada: aí pode excluir; o histórico guarda nome e tag e a tag fica livre.
    await db.registration.update({ where: { id: regA.id }, data: { status: 'CANCELLED' } });
    expect((await call('cap', `/teams/${a.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call('cap', `/teams/${a.id}`)).status).toBe(404);
    expect((await db.registration.findUniqueOrThrow({ where: { id: regA.id } })).displayName).toBe('Squad Delta');
    expect((await call('dani', '/teams', { method: 'POST', body: { name: 'Nova Delta', tag: tag('DEL') } })).status).toBe(201);
  });

  it('busca de jogador para convidar: só dados públicos, sem a própria pessoa', async () => {
    const res = await call('cap', `/user-search?q=sq`);
    const list = z.array(InviteCandidate).parse(res.data);
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((u) => u.id)).not.toContain(ids.get('cap'));
    expect(JSON.stringify(res.data)).not.toContain('@exemplo.com');
    expect((await call('cap', '/user-search?q=a')).status).toBe(400);
  });
});
