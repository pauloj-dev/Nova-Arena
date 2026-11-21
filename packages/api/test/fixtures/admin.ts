/**
 * Harness dos testes do painel Admin contra o Postgres (`TEST_DATABASE_URL`): pessoas com sessão (e 2FA feito ou
 * não), chamada com `Origin` e cookie, e o app com tempo real e fila em memória para conferir o que sai depois do commit.
 */
import type { PrismaClient } from '@nova/db';
import { randomUUID } from 'node:crypto';
import { createApp, envFrom, type App } from '../../src';
import type { Env } from '../../src/env';
import { signAccessToken } from '../../src/auth/jwt';
import type { ScheduledJob } from '../../src/jobs';
import { memoryCache } from '../../src/cache';
import { memoryRealtime } from '../../src/realtime';

export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'ORGANIZER' | 'PARTICIPANT';

export const TEST_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!!';

export function testEnv(extra: Record<string, string> = {}): Env {
  return envFrom({ NODE_ENV: 'test', AUTH_JWT_SECRET: TEST_SECRET, DATABASE_URL: process.env.TEST_DATABASE_URL, ...extra });
}

export interface Person {
  id: string;
  nickname: string;
  email: string;
  cookie: string;
}

export interface Harness {
  app: App;
  db: PrismaClient;
  realtime: ReturnType<typeof memoryRealtime>;
  /** Cache do app (o Redis compartilhado, em produção). */
  cache: ReturnType<typeof memoryCache>;
  jobs: ScheduledJob[];
  mails: { to: string; template: string; data: Record<string, unknown> }[];
  people: Map<string, Person>;
  /** Hora "agora" do app (dá para mexer: `clock.now = …`). */
  clock: { now: Date | null };
  stamp: string;
  makeUser(key: string, roles: AppRole[], options?: { tfa?: boolean; emailVerified?: boolean; createdAt?: Date }): Promise<Person>;
  /** Nova sessão (cookie) para a pessoa, como se tivesse entrado de novo. */
  login(key: string, options?: { tfa?: boolean }): Promise<string>;
  call(who: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: unknown; code?: string; res: Response }>;
}

const ok = async () => 'ok' as const;

export function createHarness(db: PrismaClient, prefix: string, envExtra: Record<string, string> = {}): Harness {
  const realtime = memoryRealtime();
  const jobs: ScheduledJob[] = [];
  const mails: Harness['mails'] = [];
  const clock: { now: Date | null } = { now: null };
  const now = () => clock.now ?? new Date();
  const cache = memoryCache(now);
  const env = testEnv(envExtra);
  const app = createApp({
    env,
    logSink: process.env.TEST_LOGS ? undefined : () => undefined,
    deps: {
      db: () => db,
      now,
      realtime: () => realtime,
      cache: () => cache,
      queue: () => ({ schedule: async (job) => void jobs.push(job) }),
      mailer: () => ({ send: async (to: string, message: { template: string; data: Record<string, unknown> }) => void mails.push({ to, template: message.template, data: message.data }) }) as never,
      checks: { database: ok, redis: ok, qstash: ok },
      breached: async () => false,
      botCheck: async () => true,
    },
  });
  const stamp = String(Date.now()).slice(-7) + Math.floor(Math.random() * 90 + 10);
  const people = new Map<string, Person>();

  async function session(userId: string, roles: AppRole[], tfa: boolean, sv = 0): Promise<string> {
    const s = await db.session.create({ data: { userId, familyId: randomUUID(), refreshTokenHash: `${prefix}-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600_000), sessionVersion: sv } });
    return `na_at=${await signAccessToken(env, { sub: userId, sid: s.id, sv, tfa, roles }, now())}`;
  }

  const harness: Harness = {
    app,
    db,
    realtime,
    cache,
    jobs,
    mails,
    people,
    clock,
    stamp,
    async makeUser(key, roles, options = {}) {
      const nickname = `${prefix}${key}${stamp}`.slice(0, 20);
      const email = `${prefix}.${key}.${stamp}@exemplo.com`.toLowerCase();
      const user = await db.user.create({
        data: {
          email,
          nickname,
          nicknameKey: nickname.toLowerCase(),
          emailVerified: options.emailVerified ?? true,
          lastSeenAt: new Date(),
          ...(options.createdAt ? { createdAt: options.createdAt } : {}),
          roles: { create: [...new Set<AppRole>([...roles, 'PARTICIPANT'])].map((role) => ({ role, ...(options.createdAt ? { grantedAt: options.createdAt } : {}) })) },
          // Admin com 2FA: a configuração ativa existe (a sessão diz se o código foi feito).
          ...((options.tfa ?? true) && roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN') ? { twoFactor: { create: { secretEnc: 'teste', enabledAt: new Date(), recoveryCodesHash: [] } } } : {}),
        },
      });
      const person = { id: user.id, nickname, email, cookie: await session(user.id, roles, options.tfa ?? true) };
      people.set(key, person);
      return person;
    },
    async login(key, options = {}) {
      const person = people.get(key);
      if (!person) throw new Error(`pessoa ${key} não existe`);
      const user = await db.user.findUniqueOrThrow({ where: { id: person.id }, include: { roles: true } });
      person.cookie = await session(
        user.id,
        user.roles.map((r) => r.role),
        options.tfa ?? true,
        user.sessionVersion,
      );
      return person.cookie;
    },
    async call(who, method, path, body) {
      const cookie = who ? people.get(who)?.cookie : undefined;
      if (who && !cookie) throw new Error(`pessoa ${who} não existe`);
      const res = await app.request(`/api/v1${path}`, {
        method,
        headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', 'User-Agent': 'Vitest', 'X-Forwarded-For': '203.0.113.10', ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const clone = res.clone();
      const text = await res.text();
      const parse = (): unknown => {
        try {
          return text ? (JSON.parse(text) as unknown) : null;
        } catch {
          return text;
        }
      };
      const data = parse();
      const code = data && typeof data === 'object' && 'code' in data ? String((data as { code?: unknown }).code) : undefined;
      return { status: res.status, data, code, res: clone };
    },
  };
  return harness;
}

/** Último registro de auditoria da ação sobre o recurso (ou de quem fez). */
export async function lastAudit(db: PrismaClient, action: string, where: { entityId?: string; actorId?: string; tournamentId?: string } = {}) {
  return db.auditLog.findFirst({ where: { action, ...where }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
}

export async function auditCount(db: PrismaClient, action: string, where: { entityId?: string; actorId?: string; tournamentId?: string } = {}) {
  return db.auditLog.count({ where: { action, ...where } });
}
