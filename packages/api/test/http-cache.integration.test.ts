/**
 * Cache na borda das leituras públicas (#111) contra um Postgres de verdade: o que é igual para todos sai com
 * `s-maxage` + `stale-while-revalidate`; o que depende de quem pede (sessão, rascunho, prévia da organização)
 * nunca vai para o cache compartilhado.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import { signAccessToken } from '../src/auth/jwt';
import { cacheControlValue, EDGE_CACHE, NO_STORE } from '../src/http-cache';
import { DUEL_RULES } from './fixtures/tournament';

const url = process.env.TEST_DATABASE_URL;
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres!!', DATABASE_URL: url });

describe.skipIf(!url)('Cache-Control das leituras (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const stamp = String(Date.now()).slice(-8);
  let cookie = '';
  let nickname = '';
  let gameSlug = '';
  const slugs: Record<string, string> = {};
  const stageIds: Record<string, string> = {};

  const get = (path: string, withSession = false) => app.request(`/api/v1${path}`, { headers: withSession ? { Cookie: cookie } : {} });

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    app = createApp({ env, deps: { db: () => db } });
    nickname = `hc${stamp}`;
    const owner = await db.user.create({ data: { email: `hc.${stamp}@exemplo.com`, nickname, nicknameKey: nickname, roles: { create: [{ role: 'ORGANIZER' }, { role: 'PARTICIPANT' }] } } });
    const session = await db.session.create({ data: { userId: owner.id, familyId: randomUUID(), refreshTokenHash: `hc-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    cookie = `na_at=${await signAccessToken(env, { sub: owner.id, sid: session.id, sv: 0, tfa: false, roles: ['ORGANIZER', 'PARTICIPANT'] }, new Date())}`;
    gameSlug = `cache-${stamp}`;
    const game = await db.game.create({
      data: { slug: gameSlug, name: `Cache ${stamp}`, modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } }, scoringModels: { create: { name: 'Vitória', matchType: 'DUEL', rules: DUEL_RULES, tiebreakers: ['points'] } } },
      include: { modes: true, scoringModels: true },
    });
    for (const status of ['DRAFT', 'REGISTRATION_OPEN', 'IN_PROGRESS', 'FINISHED'] as const) {
      const t = await db.tournament.create({
        data: { slug: `cache-${status.toLowerCase().replace('_', '-')}-${stamp}`, name: `Cache ${status}`, gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: owner.id, status, participantType: 'SOLO', maxParticipants: 8 },
      });
      const stage = await db.stage.create({ data: { tournamentId: t.id, order: 1, name: 'Mata-mata', format: 'SINGLE_ELIM', scoringModelId: game.scoringModels[0]?.id ?? '', tiebreakers: ['points'] } });
      slugs[status] = t.slug;
      stageIds[status] = stage.id;
    }
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it('vitrine, página pública, comunicados e perfil: cache público na borda', async () => {
    expect((await get(`/tournaments?game=${gameSlug}`)).headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.listing));
    // Igual para todos: nem o cookie de sessão tira do cache.
    expect((await get(`/tournaments/${slugs.REGISTRATION_OPEN}`, true)).headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.listing));
    expect((await get(`/tournaments/${slugs.REGISTRATION_OPEN}/announcements`)).headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.listing));
    expect((await get(`/users/${nickname}`)).headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.profile));
    expect((await get(`/tournaments/${slugs.FINISHED}/podium`)).headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.finished));
  });

  it('catálogo de jogos: público para visitante (Vary: Cookie), sem cache para quem está logado', async () => {
    const visitor = await get('/games');
    expect(visitor.status).toBe(200);
    expect(visitor.headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.catalog));
    expect(visitor.headers.get('vary')).toContain('Cookie');
    expect((await get('/games', true)).headers.get('cache-control')).toBe(NO_STORE);
  });

  it('rascunho, papel de quem vê, dados da sessão e erros: private, no-store', async () => {
    const draft = await get(`/tournaments/${slugs.DRAFT}`, true);
    expect(draft.status).toBe(200);
    expect(draft.headers.get('cache-control')).toBe(NO_STORE);
    expect((await get(`/tournaments/${slugs.DRAFT}`)).headers.get('cache-control')).toBe(NO_STORE); // 404 para o visitante
    expect((await get(`/tournaments/${slugs.REGISTRATION_OPEN}/access`, true)).headers.get('cache-control')).toBe(NO_STORE);
    const mine = await get('/teams/mine', true);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe(NO_STORE);
    expect((await get('/teams/mine')).headers.get('cache-control')).toBe(NO_STORE); // 401
  });

  it('chave e partidas: ao vivo sem cache na borda; encerrado com cache longo só para visitante', async () => {
    expect((await get(`/tournaments/${slugs.IN_PROGRESS}/matches`)).headers.get('cache-control')).toBe(NO_STORE);
    const finished = await get(`/tournaments/${slugs.FINISHED}/matches`);
    expect(finished.status).toBe(200);
    expect(finished.headers.get('cache-control')).toBe(cacheControlValue(EDGE_CACHE.finished));
    expect((await get(`/tournaments/${slugs.FINISHED}/matches`, true)).headers.get('cache-control')).toBe(NO_STORE);
    expect((await get(`/tournaments/${slugs.FINISHED}/matches?mine=1`)).headers.get('cache-control')).toBe(NO_STORE);
  });
});
