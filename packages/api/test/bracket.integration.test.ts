/**
 * Chave contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI) — issue #82.
 * Critérios de aceite: ajustar depois de uma partida concluída = 409; mesma seed reproduz a mesma chave.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { applyResult } from '@nova/engine';
import { Bracket, Problem } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { readRun, snapshotOf } from '../src/competition/run';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('chave (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-7);
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  let tournamentId = '';
  let stageId = '';

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `bk${key}${stamp}`.slice(0, 20);
    const user = await db.user.create({ data: { email: `bk.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `bk-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
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

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    const owner = await makeUser('dono', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('jog', ['PARTICIPANT']);
    await makeUser('adm', ['ADMIN', 'PARTICIPANT']);
    const game = await db.game.create({
      data: { slug: `bk-${stamp}`, name: `Chave ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'V', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    const t = await db.tournament.create({ data: { slug: `copa-bk-${stamp}`, name: 'Copa da Chave', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status: 'REGISTRATION_OPEN', participantType: 'SOLO', maxParticipants: 8 } });
    tournamentId = t.id;
    stageId = (await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'], config: { bestOf: 1 } } })).id;
    for (let i = 0; i < 8; i += 1) await db.registration.create({ data: { tournamentId: t.id, displayName: `Time ${i + 1}`, status: 'CONFIRMED', createdAt: new Date(Date.now() + i) } });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('gera só com inscrições fechadas; participante não gera; prévia só para a organização', async () => {
    expect(code((await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).data)).toBe('REGISTRATION_STILL_OPEN');
    await db.tournament.update({ where: { id: tournamentId }, data: { status: 'REGISTRATION_CLOSED' } });
    expect((await call('jog', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).status).toBe(403);

    const preview = Bracket.parse((await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'semente-da-copa' } })).data);
    expect(preview).toMatchObject({ state: 'PREVIEW', seedUsed: 'semente-da-copa', seeding: 'RANDOM', locked: false });
    expect(preview.entrants).toHaveLength(8);
    expect(preview.matches.filter((m) => m.round === 1)).toHaveLength(4);
    // Projeção nas tabelas: uma partida por nó do motor, com os ids reais.
    expect(await db.match.count({ where: { stageId } })).toBe(preview.matches.length);
    expect(preview.matches.every((m) => /^[0-9a-f-]{36}$/.test(m.id))).toBe(true);
    expect((await db.stage.findUniqueOrThrow({ where: { id: stageId } })).randomSeed).toBe('semente-da-copa');

    expect(Bracket.parse((await call(null, `/stages/${stageId}/bracket`)).data).state).toBe('NONE');
    expect(Bracket.parse((await call('jog', `/stages/${stageId}/bracket`)).data).state).toBe('NONE');
    expect(Bracket.parse((await call('dono', `/stages/${stageId}/bracket`)).data).state).toBe('PREVIEW');
  });

  it('Mesma seed reproduz a mesma chave', async () => {
    const before = Bracket.parse((await call('dono', `/stages/${stageId}/bracket`)).data);
    const again = Bracket.parse((await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANDOM', seed: 'semente-da-copa' } })).data);
    expect(again.entrants.map((e) => e.registrationId)).toEqual(before.entrants.map((e) => e.registrationId));
    expect(again.matches.map((m) => [m.nodeId, m.participants.map((p) => p.registrationId)])).toEqual(before.matches.map((m) => [m.nodeId, m.participants.map((p) => p.registrationId)]));
  });

  it('ajuste manual (auditado) e confirmação: a chave passa a valer e o campeonato fica em andamento', async () => {
    const before = Bracket.parse((await call('dono', `/stages/${stageId}/bracket`)).data);
    const [a, b] = [before.entrants[0]?.registrationId ?? '', before.entrants[7]?.registrationId ?? ''];
    const swapped = Bracket.parse((await call('dono', `/stages/${stageId}/seeding`, { method: 'PATCH', body: { a, b } })).data);
    expect(swapped.entrants[0]?.registrationId).toBe(b);
    expect(swapped.entrants[7]?.registrationId).toBe(a);
    expect(await db.auditLog.count({ where: { entityId: stageId, action: 'BRACKET_SEEDING_CHANGED' } })).toBe(1);

    const confirmed = Bracket.parse((await call('dono', `/stages/${stageId}/confirm`, { method: 'POST' })).data);
    expect(confirmed.state).toBe('CONFIRMED');
    expect((await db.tournament.findUniqueOrThrow({ where: { id: tournamentId } })).status).toBe('IN_PROGRESS');
    expect(code((await call('dono', `/stages/${stageId}/confirm`, { method: 'POST' })).data)).toBe('ALREADY_CONFIRMED');
    // Agora é pública.
    expect(Bracket.parse((await call(null, `/stages/${stageId}/bracket`)).data).state).toBe('CONFIRMED');
  });

  it('Ajustar depois de uma partida concluída = 409; só o Admin destrava (com motivo)', async () => {
    // Uma partida concluída no retrato do motor (o lançamento de resultado chega com a #85).
    const stage = await db.stage.findUniqueOrThrow({ where: { id: stageId } });
    const run = readRun(stage);
    if (!run) throw new Error('sem chave');
    const first = run.structure.matches.find((m) => m.round === 1 && m.slots.every((s) => s.entrantId));
    const [x, y] = (first?.slots ?? []).map((s) => s.entrantId as string);
    const played = applyResult(run.structure, run.state, { matchId: first?.id ?? '', entries: [{ entrantId: x as string, score: 2 }, { entrantId: y as string, score: 1 }] });
    await db.stage.update({ where: { id: stageId }, data: { engineSnapshot: snapshotOf(played.structure, played.state) } });

    const bracket = Bracket.parse((await call('dono', `/stages/${stageId}/bracket`)).data);
    expect(bracket.locked).toBe(true);
    const [a, b] = [bracket.entrants[1]?.registrationId ?? '', bracket.entrants[2]?.registrationId ?? ''];
    const swap = await call('dono', `/stages/${stageId}/seeding`, { method: 'PATCH', body: { a, b } });
    expect(swap.status).toBe(409);
    expect(code(swap.data)).toBe('BRACKET_LOCKED');
    expect((await call('dono', `/stages/${stageId}/generate`, { method: 'POST', body: { seeding: 'RANDOM' } })).status).toBe(409);

    expect((await call('dono', `/stages/${stageId}/unlock`, { method: 'POST', body: { reason: 'Erro de inscrição' } })).status).toBe(403);
    const unlocked = Bracket.parse((await call('adm', `/stages/${stageId}/unlock`, { method: 'POST', body: { reason: 'Inscrito errado na chave' } })).data);
    expect(unlocked.locked).toBe(false);
    const log = await db.auditLog.findFirst({ where: { entityId: stageId, action: 'BRACKET_UNLOCKED' } });
    expect(log?.reason).toBe('Inscrito errado na chave');
  });
});
