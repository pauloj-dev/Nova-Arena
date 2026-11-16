/**
 * Check-in e W.O. automático contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI) — issue #84.
 * Critérios de aceite: CT-07 com relógio simulado; job de W.O. entregue duas vezes aplica uma; o Cron aplica o W.O.
 * quando a mensagem não chega.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Match, Problem } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { applyDueWalkover, sweepWalkovers } from '../src/competition/walkover';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });
const MIN = 60_000;

describe.skipIf(!url)('check-in e W.O. automático (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  /** Relógio simulado: as rotas leem `deps.now()`. */
  let clock = new Date();
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const regOf = new Map<string, string>();
  let tournamentId = '';
  let stageId = '';
  let first: Match;
  let second: Match;
  /** Horário marcado das partidas: janela abre 30 min antes e fecha 10 min antes. */
  const T = new Date(Date.now() + 4 * 3600_000);

  async function makeUser(key: string, roles: ('ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `ck${key}${stamp}`.slice(0, 20);
    const user = await db.user.create({ data: { email: `ck.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `ck-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
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
  /** Chave de quem joga cada lado da partida. */
  const sides = (m: Match) => m.participants.map((p) => [...regOf.entries()].find(([, r]) => r === p.registrationId)?.[0] ?? '');
  const matches = async () => z.array(Match).parse((await call('dono', `/tournaments/${tournamentId}/matches`)).data);

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db, now: () => clock, queue: () => ({ schedule: async () => undefined }) } });
    const owner = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    const game = await db.game.create({
      data: { slug: `ck-${stamp}`, name: `Check-in ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    const t = await db.tournament.create({
      data: { slug: `copa-ck-${stamp}`, name: 'Copa do Check-in', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'REGISTRATION_CLOSED', participantType: 'SOLO', maxParticipants: 4, checkInConfig: { enabled: true, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false } },
    });
    tournamentId = t.id;
    stageId = (await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } })).id;
    for (const key of ['a', 'b', 'c', 'd']) {
      const u = await makeUser(key, ['PARTICIPANT']);
      regOf.set(key, (await db.registration.create({ data: { tournamentId: t.id, userId: u.id, status: 'CONFIRMED' } })).id);
    }
    await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANKED' } });
    await call('dono', `/stages/${stageId}/confirm`, { method: 'POST' });
    await db.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    await call('dono', `/stages/${stageId}/schedule-round`, { method: 'POST', body: { round: 1, startsAt: T.toISOString(), intervalMinutes: 0 } });
    const round1 = (await matches()).filter((m) => m.round === 1);
    [first, second] = round1 as [Match, Match];
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('check-in só dentro da janela, só para quem joga, e repetir não duplica', async () => {
    const [x, y] = sides(first);
    const outsider = sides(second)[0] ?? '';
    clock = new Date(T.getTime() - 40 * MIN);
    expect(code((await call(x ?? '', `/matches/${first.id}/check-in`, { method: 'POST' })).data)).toBe('CHECKIN_NOT_OPEN');
    clock = new Date(T.getTime() - 20 * MIN);
    expect((await call(outsider, `/matches/${first.id}/check-in`, { method: 'POST' })).status).toBe(403);
    expect((await call(null, `/matches/${first.id}/check-in`, { method: 'POST' })).status).toBe(401);
    const ok = await call(x ?? '', `/matches/${first.id}/check-in`, { method: 'POST' });
    expect(ok.status).toBe(200);
    const view = Match.parse(ok.data);
    expect(view.participants.find((p) => p.registrationId === regOf.get(x ?? ''))).toMatchObject({ checkedIn: true, checkedInUserIds: [ids.get(x ?? '')] });
    expect(view.participants.find((p) => p.registrationId === regOf.get(y ?? ''))?.checkedIn).toBe(false);
    await call(x ?? '', `/matches/${first.id}/check-in`, { method: 'POST' });
    expect(await db.checkIn.count({ where: { matchId: first.id } })).toBe(1);
    clock = new Date(T.getTime() - 5 * MIN);
    expect(code((await call(y ?? '', `/matches/${first.id}/check-in`, { method: 'POST' })).data)).toBe('CHECKIN_CLOSED');
  });

  it('CT-07: quem não fez check-in leva W.O. no fechamento; entregue duas vezes, aplica uma', async () => {
    const [x, y] = sides(first);
    // Antes do fechamento, nada.
    expect((await applyDueWalkover(db, first.id, new Date(T.getTime() - 11 * MIN))).outcome).toBe('NOT_DUE');
    const close = new Date(T.getTime() - 10 * MIN);
    const once = await applyDueWalkover(db, first.id, close);
    expect(once).toMatchObject({ outcome: 'APPLIED', winnerId: regOf.get(x ?? ''), loserId: regOf.get(y ?? '') });
    // A mesma mensagem de novo (o QStash entrega "pelo menos uma vez"), ou o Cron junto: nada muda.
    const [again, sweepAgain] = await Promise.all([applyDueWalkover(db, first.id, close), applyDueWalkover(db, first.id, close)]);
    expect([again.outcome, sweepAgain.outcome]).toEqual(['ALREADY_DECIDED', 'ALREADY_DECIDED']);
    expect(await db.auditLog.count({ where: { entityId: first.id, action: 'WALKOVER_APPLIED' } })).toBe(1);

    const list = await matches();
    const decided = list.find((m) => m.id === first.id);
    expect(decided).toMatchObject({ status: 'WALKOVER', walkover: true });
    // O vencedor avança para a final.
    const final = list.find((m) => m.round === 2);
    expect(final?.participants.some((p) => p.registrationId === regOf.get(x ?? ''))).toBe(true);
  });

  it('sem a mensagem do QStash, a varredura do Cron aplica o W.O. atrasado', async () => {
    const [x] = sides(second);
    clock = new Date(T.getTime() - 15 * MIN);
    expect((await call(x ?? '', `/matches/${second.id}/check-in`, { method: 'POST' })).status).toBe(200);
    // Ainda dentro da janela: a varredura não mexe.
    expect(await sweepWalkovers(db, clock)).toBe(0);
    // Passou do fechamento e a mensagem não chegou: o Cron aplica (uma vez só).
    const late = new Date(T.getTime() + 2 * MIN);
    expect(await sweepWalkovers(db, late)).toBe(1);
    expect(await sweepWalkovers(db, late)).toBe(0);
    expect((await matches()).find((m) => m.id === second.id)?.status).toBe('WALKOVER');
  });

  it('os dois ausentes: a organização decide (W.O. manual com motivo, moderador também)', async () => {
    const final = (await matches()).find((m) => m.round === 2);
    if (!final) throw new Error('sem final');
    const finalAt = new Date(T.getTime() + 3 * 3600_000);
    await call('dono', `/matches/${final.id}`, { method: 'PATCH', body: { scheduledAt: finalAt.toISOString() } });
    expect((await applyDueWalkover(db, final.id, new Date(finalAt.getTime() - 5 * MIN))).outcome).toBe('BOTH_ABSENT');

    const [x] = sides(final);
    // Ao vivo e de volta para agendada (RN-08): só a organização.
    expect((await call(x ?? '', `/matches/${final.id}/start`, { method: 'POST' })).status).toBe(403);
    expect(Match.parse((await call('dono', `/matches/${final.id}/start`, { method: 'POST' })).data).status).toBe('LIVE');
    expect(Match.parse((await call('dono', `/matches/${final.id}/start`, { method: 'POST', body: { live: false } })).data).status).toBe('SCHEDULED');

    expect((await call(x ?? '', `/matches/${final.id}/walkover`, { method: 'POST', body: { winnerRegistrationId: regOf.get(x ?? ''), reason: 'Ninguém apareceu' } })).status).toBe(403);
    expect(code((await call('dono', `/matches/${final.id}/walkover`, { method: 'POST', body: { winnerRegistrationId: randomUUID(), reason: 'Ninguém apareceu' } })).data)).toBe('NOT_IN_MATCH');
    const res = await call('dono', `/matches/${final.id}/walkover`, { method: 'POST', body: { winnerRegistrationId: regOf.get(x ?? ''), reason: 'Ninguém apareceu' } });
    expect(res.status).toBe(200);
    expect(Match.parse(res.data)).toMatchObject({ status: 'WALKOVER', walkover: true });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: final.id, action: 'WALKOVER_APPLIED' } });
    expect(log.reason).toBe('Ninguém apareceu');
  });

  it('partida concluída não volta a ficar ao vivo', async () => {
    expect(code((await call('dono', `/matches/${first.id}/start`, { method: 'POST' })).data)).toBe('MATCH_FINISHED');
  });
});
