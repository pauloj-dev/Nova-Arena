/**
 * Harness dos testes de integração da competição (B2): app Hono real + Postgres (`TEST_DATABASE_URL`), relógio
 * injetável, sessões assinadas no horário do relógio, tempo real e cache em memória para conferir o que foi publicado.
 * Mesmo padrão de `check-in.integration.test.ts`.
 */
import { createDb, type PrismaClient } from '@nova/db';
import { Problem, StageConfig, type StageFormat } from '@nova/schemas';
import { randomUUID } from 'node:crypto';
import { createApp, envFrom, type App } from '../../src';
import { signAccessToken } from '../../src/auth/jwt';
import { memoryCache, type Cache } from '../../src/cache';
import { memoryRealtime } from '../../src/realtime';

export const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';
type Role = 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT';

export const BR_RULES = [
  { type: 'PER_UNIT' as const, stat: 'kills', points: 1 },
  { type: 'TABLE' as const, stat: 'placement', table: { '1': 3 } },
];
export const BR_TB = ['points', 'booyahs', 'kills', 'avgPlacement', 'lastDropKills', 'draw'];
/** Coroas/frames + vitória (Clash Royale, 8 Ball). */
export const SERIES_RULES = [
  { type: 'PER_UNIT' as const, stat: 'score', points: 1 },
  { type: 'OUTCOME' as const, win: 3, draw: 0, loss: 0 },
];
export const DUEL_TB = ['points', 'scoreDiff', 'score', 'headToHead', 'draw'];

export interface StageSpec {
  name: string;
  format: StageFormat;
  model: string;
  config?: Record<string, unknown>;
  qualification?: { type: 'TOP_N_PER_GROUP' | 'TOP_N_OVERALL' | 'WINNERS'; n: number; repechage: number } | null;
  tiebreakers?: string[];
  seeding?: 'RANDOM' | 'RANKED' | 'MANUAL';
}

export interface Call {
  status: number;
  data: unknown;
  code: string | undefined;
  detail: string | undefined;
}

export async function createHarness(url: string, prefix: string) {
  const db: PrismaClient = createDb({ connectionString: url, max: 4 });
  const env = envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: SECRET, DATABASE_URL: url });
  const clock = { now: new Date() };
  const realtime = memoryRealtime();
  const cache: Cache = memoryCache(() => clock.now);
  const jobs: { path: string; body: unknown }[] = [];
  const app: App = createApp({
    env,
    deps: {
      db: () => db,
      now: () => clock.now,
      realtime: () => realtime,
      cache: () => cache,
      queue: () => ({ schedule: async (job: { path: string; body: unknown }) => void jobs.push(job) }),
    },
  });
  const stamp = String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const sessions = new Map<string, { sub: string; sid: string; roles: Role[] }>();
  const ids = new Map<string, string>();

  async function user(key: string, roles: Role[] = ['PARTICIPANT']): Promise<{ id: string; nickname: string }> {
    const nickname = `${prefix}${key}${stamp}`.slice(0, 20);
    const u = await db.user.create({ data: { email: `${prefix}.${key}.${stamp}@exemplo.com`, nickname, nicknameKey: nickname.toLowerCase(), roles: { create: roles.map((role) => ({ role })) } } });
    const session = await db.session.create({ data: { userId: u.id, familyId: randomUUID(), refreshTokenHash: `${prefix}-${randomUUID()}`, expiresAt: new Date(Date.now() + 30 * 24 * 3600_000) } });
    sessions.set(key, { sub: u.id, sid: session.id, roles });
    ids.set(key, u.id);
    return { id: u.id, nickname };
  }

  const id = (key: string) => ids.get(key) as string;

  async function call(who: string | null, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Call> {
    const s = who ? sessions.get(who) : undefined;
    const cookie = s ? `na_at=${await signAccessToken(env, { ...s, sv: 0, tfa: true }, clock.now)}` : '';
    const res = await app.request(`/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    const problem = res.status >= 400 ? Problem.safeParse(data) : null;
    return { status: res.status, data, code: problem?.success ? (problem.data.code ?? undefined) : undefined, detail: problem?.success ? (problem.data.detail ?? undefined) : undefined };
  }

  /** Jogo com um modo e os modelos de pontuação pedidos (o primeiro é o padrão). */
  async function game(matchType: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE', models: { name: string; matchType?: 'DUEL' | 'TEAM_VS_TEAM' | 'BATTLE_ROYALE'; rules: unknown; ownerId?: string }[], extraStatFields: unknown[] = []) {
    const g = await db.game.create({
      data: {
        slug: `${prefix}-${matchType.toLowerCase().replace(/_/g, '-')}-${stamp}-${randomUUID().slice(0, 4)}`,
        name: `Jogo ${prefix} ${matchType}`,
        icon: matchType === 'BATTLE_ROYALE' ? '🔥' : '👑',
        extraStatFields: extraStatFields as never,
        modes: { create: { name: 'Modo', teamSize: 1, matchType } },
        scoringModels: { create: models.map((m, i) => ({ name: m.name, matchType: m.matchType ?? matchType, rules: m.rules as never, tiebreakers: matchType === 'BATTLE_ROYALE' ? BR_TB : DUEL_TB, isDefault: i === 0, ownerId: m.ownerId ?? null })) },
      },
      include: { modes: true, scoringModels: true },
    });
    const models_ = new Map(g.scoringModels.map((m) => [m.name, m.id]));
    return { id: g.id, modeId: g.modes[0]?.id as string, model: (name: string) => models_.get(name) as string };
  }

  /** Campeonato com as fases pedidas (status inicial `REGISTRATION_CLOSED`). */
  async function tournament(input: { owner: string; game: { id: string; modeId: string; model: (n: string) => string }; stages: StageSpec[]; status?: string; name?: string; checkIn?: boolean }) {
    const t = await db.tournament.create({
      data: {
        slug: `${prefix}-${stamp}-${randomUUID().slice(0, 6)}`,
        name: input.name ?? `Copa ${prefix}`,
        gameId: input.game.id,
        gameModeId: input.game.modeId,
        ownerId: id(input.owner),
        status: (input.status ?? 'REGISTRATION_CLOSED') as never,
        participantType: 'SOLO',
        maxParticipants: 64,
        checkInConfig: { enabled: input.checkIn ?? false, opensMinutesBefore: 30, closesMinutesBefore: 10, requireAllMembers: false },
      },
    });
    const stageIds: string[] = [];
    for (const [i, s] of input.stages.entries()) {
      const row = await db.stage.create({
        data: {
          tournamentId: t.id,
          order: i + 1,
          name: s.name,
          format: s.format,
          scoringModelId: input.game.model(s.model),
          config: StageConfig.parse(s.config ?? {}) as never,
          qualification: (s.qualification ?? undefined) as never,
          tiebreakers: s.tiebreakers ?? DUEL_TB,
          seeding: s.seeding ?? 'RANDOM',
        },
      });
      stageIds.push(row.id);
    }
    return { id: t.id, slug: t.slug, stageIds };
  }

  /** Inscrições confirmadas: de usuários (solo) ou só com nome (importadas). Devolve os ids na ordem. */
  async function register(tournamentId: string, entries: ({ user: string } | { name: string })[]): Promise<string[]> {
    const out: string[] = [];
    for (const [i, e] of entries.entries()) {
      const row = await db.registration.create({
        data: { tournamentId, status: 'CONFIRMED', createdAt: new Date(Date.now() + i), ...('user' in e ? { userId: id(e.user) } : { displayName: e.name }) },
      });
      out.push(row.id);
    }
    return out;
  }

  async function staff(tournamentId: string, key: string, role: 'MODERATOR' | 'CO_ORGANIZER', addedBy: string) {
    await db.tournamentStaff.create({ data: { tournamentId, userId: id(key), role, addedById: id(addedBy) } });
  }

  /** Prova enviada (upload privado confirmado) de alguém: o endereço que a tela manda. */
  async function evidence(owner: string): Promise<string> {
    const u = await db.upload.create({ data: { ownerId: id(owner), purpose: 'evidence', access: 'private', blobUrl: `https://blob.exemplo/${randomUUID()}.png`, pathname: `evidence/${randomUUID()}.png`, contentType: 'image/png', size: 1000 } });
    return `/api/v1/files/${u.id}`;
  }

  const notificationsOf = async (key: string) => (await db.notification.findMany({ where: { userId: id(key) }, orderBy: { createdAt: 'asc' } })).map((n) => n.title);
  const auditCount = (where: { action: string; entityId?: string; tournamentId?: string }) => db.auditLog.count({ where });

  return { db, app, env, clock, realtime, cache, jobs, user, id, call, game, tournament, register, staff, evidence, notificationsOf, auditCount };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
