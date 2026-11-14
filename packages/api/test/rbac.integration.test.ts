/**
 * Matriz RBAC contra um Postgres de verdade (`TEST_DATABASE_URL`, no CI): cada rota × 4 papéis + visitante
 * → status esperado (issue #70). As rotas de papel/campeonato ainda não existem na API (chegam na #72 e na
 * #75), então a matriz também cobre **sondas** montadas com os mesmos middlewares que essas rotas vão usar.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, envFrom, type App } from '../src';
import type { AppEnv } from '../src/context';
import { signAccessToken } from '../src/auth/jwt';
import { ADMIN_ROLES, ORGANIZER_AREA_ROLES, requireRole, requireTournamentAccess } from '../src/auth/rbac';

const url = process.env.TEST_DATABASE_URL;
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET, DATABASE_URL: url });

type Actor = 'visitante' | 'participante' | 'moderador' | 'organizadorA' | 'organizadorB' | 'admin' | 'superAdmin';
type Expect = Partial<Record<Actor, number>>;

/** Prefixo único do apelido de cada ator (organizadorA e organizadorB não podem colidir). */
const ACTOR_CODE: Record<Actor, string> = { visitante: 'vis', participante: 'par', moderador: 'mod', organizadorA: 'orgA', organizadorB: 'orgB', admin: 'adm', superAdmin: 'sup' };

/** Sondas: mesmas checagens das rotas futuras de admin, organizador e campeonato. */
const probes = new Hono<AppEnv>();
probes.get('/_rbac/admin', requireRole(...ADMIN_ROLES), (c) => c.json({ ok: true }));
probes.get('/_rbac/organizador', requireRole(...ORGANIZER_AREA_ROLES), (c) => c.json({ ok: true }));
probes.get('/_rbac/campeonatos/:tournamentId/gerenciar', requireTournamentAccess('manage'), (c) => c.json(c.get('tournamentAccess')));
probes.get('/_rbac/campeonatos/:tournamentId/moderar', requireTournamentAccess('moderate'), (c) => c.json(c.get('tournamentAccess')));

describe.skipIf(!url)('matriz RBAC (Postgres)', () => {
  let db: PrismaClient;
  let app: App;
  const cookies = new Map<Actor, string>();
  let tournamentA = '';
  let slugA = '';
  const stamp = Date.now();

  async function makeUser(actor: Actor, roles: ('SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT')[]) {
    const nickname = `${ACTOR_CODE[actor]}${stamp}`.slice(0, 20);
    const user = await db.user.create({ data: { email: `${actor}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: user.id, familyId: randomUUID(), refreshTokenHash: `rbac-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000) } });
    // O token carrega os papéis só para a borda: aqui ele vai SEM papéis, para provar que a API lê do banco.
    const token = await signAccessToken(env, { sub: user.id, sid: session.id, sv: 0, tfa: false, roles: [] }, new Date());
    cookies.set(actor, `na_at=${token}`);
    return user;
  }

  beforeAll(async () => {
    db = createDb({ connectionString: url, max: 3 });
    const ok = async () => 'ok' as const;
    // Saúde dos serviços não é assunto da matriz: as checagens respondem ok.
    app = createApp({ env, deps: { db: () => db, checks: { database: ok, redis: ok, qstash: ok } }, extraModules: [probes] });
    await makeUser('participante', ['PARTICIPANT']);
    const moderator = await makeUser('moderador', ['PARTICIPANT']);
    const ownerA = await makeUser('organizadorA', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('organizadorB', ['ORGANIZER', 'PARTICIPANT']);
    await makeUser('admin', ['ADMIN', 'PARTICIPANT']);
    await makeUser('superAdmin', ['SUPER_ADMIN', 'ADMIN', 'PARTICIPANT']);

    const game = await db.game.create({ data: { slug: `rbac-${stamp}`, name: 'Jogo RBAC', modes: { create: { name: '1x1', teamSize: 1, matchType: 'DUEL' } } }, include: { modes: true } });
    slugA = `copa-a-${stamp}`;
    const t = await db.tournament.create({
      data: { slug: slugA, name: 'Copa A', gameId: game.id, gameModeId: game.modes[0]?.id ?? '', ownerId: ownerA.id, participantType: 'SOLO', maxParticipants: 8, staff: { create: { userId: moderator.id, role: 'MODERATOR', addedById: ownerA.id } } },
    });
    tournamentA = t.id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const ALL: Actor[] = ['visitante', 'participante', 'moderador', 'organizadorA', 'organizadorB', 'admin', 'superAdmin'];
  const every = (status: number, over: Expect = {}): Expect => Object.fromEntries(ALL.map((a) => [a, over[a] ?? status]));

  const MATRIX: { route: () => string; label: string; expect: Expect }[] = [
    // Rotas existentes.
    { label: 'GET /health (público)', route: () => '/health', expect: every(200) },
    { label: 'GET /me (visitante recebe null)', route: () => '/me', expect: every(200) },
    { label: 'GET /me/oauth (logado)', route: () => '/me/oauth', expect: every(200, { visitante: 401 }) },
    // Áreas (sondas com os middlewares reais).
    { label: 'área Admin', route: () => '/_rbac/admin', expect: every(403, { visitante: 401, admin: 200, superAdmin: 200 }) },
    { label: 'área do organizador', route: () => '/_rbac/organizador', expect: every(403, { visitante: 401, organizadorA: 200, organizadorB: 200, admin: 200, superAdmin: 200 }) },
    // Campeonato do Organizador A (por id e por slug).
    { label: 'gerenciar o campeonato A (id)', route: () => `/_rbac/campeonatos/${tournamentA}/gerenciar`, expect: every(403, { visitante: 401, organizadorA: 200, admin: 200, superAdmin: 200 }) },
    { label: 'gerenciar o campeonato A (slug)', route: () => `/_rbac/campeonatos/${slugA}/gerenciar`, expect: every(403, { visitante: 401, organizadorA: 200, admin: 200, superAdmin: 200 }) },
    { label: 'moderar o campeonato A', route: () => `/_rbac/campeonatos/${tournamentA}/moderar`, expect: every(403, { visitante: 401, moderador: 200, organizadorA: 200, admin: 200, superAdmin: 200 }) },
    { label: 'campeonato inexistente', route: () => `/_rbac/campeonatos/${randomUUID()}/gerenciar`, expect: every(404, { visitante: 401 }) },
  ];

  it.each(MATRIX.map((m) => [m.label, m] as const))('%s', async (_label, { route, expect: expected }) => {
    const got: Expect = {};
    for (const actor of ALL) {
      const cookie = cookies.get(actor);
      const res = await app.request(`/api/v1${route()}`, { headers: cookie ? { Cookie: cookie } : {} });
      got[actor] = res.status;
    }
    expect(got).toEqual(expected);
  });

  it('Organizador A não acessa recurso do campeonato do B (e o B não acessa o do A)', async () => {
    const res = await app.request(`/api/v1/_rbac/campeonatos/${tournamentA}/gerenciar`, { headers: { Cookie: cookies.get('organizadorB') ?? '' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('NOT_TOURNAMENT_STAFF');
  });

  it('o acesso diz por onde a pessoa entrou (dono, staff ou Admin)', async () => {
    const via = async (actor: Actor, level: string) => ((await (await app.request(`/api/v1/_rbac/campeonatos/${tournamentA}/${level}`, { headers: { Cookie: cookies.get(actor) ?? '' } })).json()) as { via: string }).via;
    expect(await via('organizadorA', 'gerenciar')).toBe('owner');
    expect(await via('moderador', 'moderar')).toBe('MODERATOR');
    expect(await via('admin', 'gerenciar')).toBe('admin');
  });

  it('papel revogado vale na hora na API, mesmo com token ainda válido', async () => {
    const admin = await db.user.findUniqueOrThrow({ where: { email: `admin.${stamp}@exemplo.com` } });
    await db.userRole.delete({ where: { userId_role: { userId: admin.id, role: 'ADMIN' } } });
    const res = await app.request('/api/v1/_rbac/admin', { headers: { Cookie: cookies.get('admin') ?? '' } });
    expect(res.status).toBe(403);
  });
});
