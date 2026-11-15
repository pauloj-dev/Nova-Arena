/**
 * Catálogo de jogos contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): cadastro pelo Admin,
 * cache da lista pública invalidado na edição, jogo desativado e auditoria (issue #74).
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Game, Problem, ScoringModel } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { memoryCache, type Cache } from '../src/cache';
import { GAMES_CACHE_KEY } from '../src/modules/games';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('catálogo de jogos (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  let cache: Cache;
  const cookies = new Map<string, string>();
  const stamp = String(Date.now()).slice(-8);
  const slug = `jogo-${stamp}`;
  let adminId = '';

  async function makeUser(key: string, roles: ('ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `gm${key}${stamp}`;
    const user = await db.user.create({ data: { email: `gm.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `gm-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookies.set(key, `na_at=${await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: true, roles }, new Date())}`);
    return user;
  }

  const call = (who: string | null, path: string, init: { method?: string; body?: unknown } = {}) =>
    app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'User-Agent': 'Vitest', ...(who ? { Cookie: cookies.get(who) ?? '' } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  const listSlugs = async (who: string | null = null, query = '') => z.array(Game).parse(await (await call(who, `/games${query}`)).json()).map((g) => g.slug);

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    cache = memoryCache(() => new Date());
    app = createApp({ env, deps: { db: () => db, cache: () => cache } });
    adminId = (await makeUser('adm', ['ADMIN', 'PARTICIPANT'])).id;
    await makeUser('org', ['ORGANIZER', 'PARTICIPANT']);
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const newGame = {
    name: 'Jogo de Teste',
    slug,
    icon: '🎯',
    coverUrl: null,
    platform: 'mobile',
    active: true,
    requiredAccountFields: [{ key: 'playerId', label: 'ID do jogador', pattern: '^[0-9]+$' }],
    extraStatFields: [],
    modes: [
      { name: 'Solo', teamSize: 1, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null },
      { name: 'Squad', teamSize: 4, maxSubs: 1, matchType: 'BATTLE_ROYALE', maxLobbySize: 12 },
    ],
  };

  it('Admin cadastra; organizador e visitante não; endereço repetido = 409 no campo', async () => {
    expect((await call('org', '/admin/games', { method: 'POST', body: newGame })).status).toBe(403);
    expect((await call(null, '/admin/games', { method: 'POST', body: newGame })).status).toBe(401);
    const res = await call('adm', '/admin/games', { method: 'POST', body: newGame });
    expect(res.status).toBe(201);
    expect(Game.parse(await res.json()).modes.map((m) => m.name)).toEqual(['Solo', 'Squad']);
    const again = await call('adm', '/admin/games', { method: 'POST', body: newGame });
    expect(Problem.parse(await again.json()).errors?.slug).toMatch(/endereço/);

    const log = await db.auditLog.findFirst({ where: { action: 'GAME_CREATED', entityLabel: 'Jogo de Teste', actorId: adminId } });
    expect(log?.userAgent).toBe('Vitest');
  });

  it('lista pública em cache, invalidada na edição; desativado some da lista mas abre pelo endereço', async () => {
    expect(await listSlugs()).toContain(slug);
    expect(await cache.get(GAMES_CACHE_KEY)).not.toBeNull();

    const off = await call('adm', `/admin/games/${slug}`, { method: 'PATCH', body: { active: false } });
    expect(Game.parse(await off.json()).active).toBe(false);
    expect(await cache.get(GAMES_CACHE_KEY)).toBeNull();
    expect(await listSlugs()).not.toContain(slug);
    expect((await call(null, `/games/${slug}`)).status).toBe(200);
    expect(await listSlugs('adm', '?all=1')).toContain(slug);
    // `all=1` não vale para quem não é Admin.
    expect(await listSlugs('org', '?all=1')).not.toContain(slug);

    await call('adm', `/admin/games/${slug}`, { method: 'PATCH', body: { active: true } });
    expect(await listSlugs()).toContain(slug);
  });

  it('modos: troca nomes e remove o que não tem campeonato; o usado não sai', async () => {
    const game = Game.parse(await (await call(null, `/games/${slug}`)).json());
    const [solo, squad] = game.modes;
    const res = await call('adm', `/admin/games/${slug}`, { method: 'PATCH', body: { modes: [{ ...solo, name: 'Solo 1x1' }] } });
    expect(Game.parse(await res.json()).modes.map((m) => [m.id, m.name])).toEqual([[solo?.id, 'Solo 1x1']]);
    expect(squad).toBeDefined();

    await db.tournament.create({ data: { slug: `copa-gm-${stamp}`, name: 'Copa do Solo', gameId: game.id, gameModeId: solo?.id ?? '', ownerId: adminId, participantType: 'SOLO', maxParticipants: 8 } });
    const blocked = await call('adm', `/admin/games/${slug}`, { method: 'PATCH', body: { modes: [{ name: 'Outro', teamSize: 2, maxSubs: 0, matchType: 'DUEL', maxLobbySize: null }] } });
    expect(blocked.status).toBe(409);
    expect(Problem.parse(await blocked.json()).code).toBe('MODE_IN_USE');
  });

  it('modelos: cria (desempate em ordem), só um padrão por tipo, duplica, edita e exclui', async () => {
    const base = { matchType: 'DUEL', rules: [{ type: 'OUTCOME', win: 3, draw: 1, loss: 0 }], isDefault: true };
    const first = ScoringModel.parse(await (await call('adm', `/admin/games/${slug}/scoring-models`, { method: 'POST', body: { ...base, name: 'Vitória 3', tiebreakers: ['draw', 'wins', 'points'] } })).json());
    expect(first.tiebreakers).toEqual(['points', 'wins', 'draw']);
    const second = ScoringModel.parse(await (await call('adm', `/admin/games/${slug}/scoring-models`, { method: 'POST', body: { ...base, name: 'Vitória 2', tiebreakers: ['points'] } })).json());
    const models = Game.parse(await (await call(null, `/games/${slug}`)).json()).scoringModels;
    expect(models.filter((m) => m.isDefault).map((m) => m.id)).toEqual([second.id]);

    const copy = ScoringModel.parse(await (await call('adm', `/admin/games/${slug}/scoring-models/${first.id}/duplicate`, { method: 'POST' })).json());
    expect(copy).toMatchObject({ name: 'Vitória 3 (cópia)', isDefault: false });

    const bad = await call('adm', `/admin/games/${slug}/scoring-models/${copy.id}`, { method: 'PATCH', body: { name: '' } });
    expect(bad.status).toBe(400);
    const renamed = await call('adm', `/admin/games/${slug}/scoring-models/${copy.id}`, { method: 'PATCH', body: { name: 'Vitória 3 B' } });
    expect(ScoringModel.parse(await renamed.json()).name).toBe('Vitória 3 B');
    expect((await call('adm', `/admin/games/${slug}/scoring-models/${copy.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await db.auditLog.count({ where: { action: 'SCORING_MODEL_CHANGED', entityId: copy.id } })).toBe(3);
  });
});
