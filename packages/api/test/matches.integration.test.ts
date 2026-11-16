/**
 * Agenda e sala contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI) — issue #83.
 * Critérios de aceite: quem não está na partida não recebe o código; o código nunca aparece em evento nem em log
 * (nem na auditoria).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Match, MatchLobby, Problem } from '@nova/schemas';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App, type LogEntry } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import type { ScheduledJob } from '../src/jobs';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url, LOBBY_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
const CODE = 'SALA-SECRETA-777';
const PASSWORD = 'senha-da-sala-123';

describe.skipIf(!url)('agenda e sala (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const logs: LogEntry[] = [];
  const jobs: ScheduledJob[] = [];
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let tournamentId = '';
  let stageId = '';
  let matchId = '';
  let inMatch: string[] = [];

  async function makeUser(key: string, roles: ('ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `mt${key}${stamp}`.slice(0, 20);
    const user = await db.user.create({ data: { email: `mt.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `mt-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles }, new Date())}`);
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

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, logSink: (entry) => logs.push(entry), deps: { db: () => db, queue: () => ({ schedule: async (job) => void jobs.push(job) }) } });
    const owner = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('mod', ['PARTICIPANT']);
    const game = await db.game.create({
      data: { slug: `mt-${stamp}`, name: `Agenda ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    const t = await db.tournament.create({
      data: { slug: `copa-mt-${stamp}`, name: 'Copa da Agenda', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'REGISTRATION_CLOSED', participantType: 'SOLO', maxParticipants: 4, checkInConfig: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false } },
    });
    tournamentId = t.id;
    await db.tournamentStaff.create({ data: { tournamentId: t.id, userId: ids.get('mod') ?? '', role: 'MODERATOR', addedById: owner.id } });
    stageId = (await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } })).id;
    for (const key of ['a', 'b', 'c', 'd']) {
      const u = await makeUser(key, ['PARTICIPANT']);
      await db.registration.create({ data: { tournamentId: t.id, userId: u.id, status: 'CONFIRMED' } });
    }
    await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await call('dono', `/stages/${stageId}/confirm`, { method: 'POST' });
    const list = z.array(Match).parse((await call('dono', `/tournaments/${tournamentId}/matches`)).data);
    const first = list.find((m) => m.round === 1);
    if (!first) throw new Error('sem partida');
    matchId = first.id;
    const regToKey = new Map<string, string>();
    for (const key of ['a', 'b', 'c', 'd']) {
      const r = await db.registration.findFirstOrThrow({ where: { tournamentId, userId: ids.get(key) } });
      regToKey.set(r.id, key);
    }
    inMatch = first.participants.map((p) => regToKey.get(p.registrationId ?? '') ?? '');
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('agenda com sala: o código fica cifrado no banco e fora da auditoria e dos logs', async () => {
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    expect((await call(inMatch[0] ?? '', `/matches/${matchId}`, { method: 'PATCH', body: { scheduledAt: at } })).status).toBe(403);
    const res = await call('mod', `/matches/${matchId}`, { method: 'PATCH', body: { scheduledAt: at, lobbyCode: CODE, lobbyPassword: PASSWORD } });
    expect(res.status).toBe(200);
    const view = Match.parse(res.data);
    expect(view).toMatchObject({ scheduledAt: at, hasLobby: true });
    expect(JSON.stringify(res.data)).not.toContain(CODE);

    const row = await db.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(row.lobbyCodeEnc).toBeTruthy();
    expect(row.lobbyCodeEnc).not.toContain(CODE);
    const audit = await db.auditLog.findMany({ where: { entityId: matchId } });
    expect(audit.map((l) => l.action)).toContain('MATCH_SCHEDULED');
    expect(JSON.stringify(audit)).not.toContain(CODE);
    expect(JSON.stringify(audit)).toContain('definida');
    expect(JSON.stringify(logs)).not.toContain(CODE);
    expect(JSON.stringify(logs)).not.toContain(PASSWORD);
    // Mensagem do QStash para o fechamento do check-in (10 min antes).
    expect(jobs.at(-1)).toMatchObject({ path: '/jobs/matches/check-in', at: new Date(Date.parse(at) - 10 * 60_000) });
  });

  it('Quem não está na partida não recebe o código; quem está, só perto do horário', async () => {
    const outsider = ['a', 'b', 'c', 'd'].find((k) => !inMatch.includes(k)) ?? '';
    const stranger = await call(outsider, `/matches/${matchId}/lobby`);
    expect(stranger.status).toBe(403);
    expect(JSON.stringify(stranger.data)).not.toContain(CODE);
    expect((await call(null, `/matches/${matchId}/lobby`)).status).toBe(401);

    // Partida daqui a 3 h: o check-in abre 30 min antes, então ainda não revela.
    expect(code((await call(inMatch[0] ?? '', `/matches/${matchId}/lobby`)).data)).toBe('LOBBY_NOT_REVEALED');
    // A organização vê a qualquer hora.
    expect(MatchLobby.parse((await call('dono', `/matches/${matchId}/lobby`)).data)).toMatchObject({ code: CODE, password: PASSWORD });

    // Reagendada para daqui a 20 min: janela de check-in aberta, quem joga recebe.
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    await call('dono', `/matches/${matchId}`, { method: 'PATCH', body: { scheduledAt: soon } });
    const lobby = await call(inMatch[1] ?? '', `/matches/${matchId}/lobby`);
    expect(lobby.status).toBe(200);
    expect(MatchLobby.parse(lobby.data).code).toBe(CODE);
  });

  it('reagendar zera os check-ins e recria a mensagem (a antiga deixa de valer)', async () => {
    const reg = await db.registration.findFirstOrThrow({ where: { tournamentId, userId: ids.get(inMatch[0] ?? '') } });
    await db.checkIn.create({ data: { matchId, registrationId: reg.id, userId: reg.userId ?? '' } });
    const before = jobs.length;
    const later = new Date(Date.now() + 5 * 3600_000).toISOString();
    await call('dono', `/matches/${matchId}`, { method: 'PATCH', body: { scheduledAt: later } });
    expect(await db.checkIn.count({ where: { matchId } })).toBe(0);
    expect(jobs.length).toBe(before + 1);
    expect(jobs.at(-1)?.dedupId).toBe(`checkin-${matchId}-${Date.parse(later)}`);
    // Só a sala, sem mudar o horário: nada de nova mensagem.
    await call('dono', `/matches/${matchId}`, { method: 'PATCH', body: { lobbyCode: 'OUTRA-SALA' } });
    expect(jobs.length).toBe(before + 1);
  });

  it('agenda a rodada inteira com intervalo', async () => {
    const start = new Date(Date.now() + 24 * 3600_000);
    const res = await call('dono', `/stages/${stageId}/schedule-round`, { method: 'POST', body: { round: 1, startsAt: start.toISOString(), intervalMinutes: 30 } });
    const list = z.array(Match).parse(res.data).filter((m) => m.round === 1);
    expect(list.map((m) => m.scheduledAt)).toEqual([start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString()]);
    expect(code((await call('dono', `/stages/${stageId}/schedule-round`, { method: 'POST', body: { round: 9, startsAt: start.toISOString() } })).data)).toBe('EMPTY_ROUND');
  });
});
