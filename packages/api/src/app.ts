/**
 * App Hono da API real (ADR-001: monólito modular em funções). Montado no Next.js em
 * `apps/web/app/api/v1/[[...route]]/route.ts` e testado direto com `app.request` (plano §4.3).
 *
 * Cada módulo é um `Hono` com as próprias rotas, registrado em `modules`. Os módulos seguem os da
 * API simulada (`apps/web/mocks/handlers/*`), que é a especificação executável: mesmas rotas, mesmos
 * códigos de erro, mesmas mensagens em pt-BR.
 */
import { Hono } from 'hono';
import type { Dependencies, AppEnv } from './context';
import { EnvError, parseEnv, processEnv, type Env } from './env';
import { HttpProblem, problemResponse } from './errors';
import { createLogger, requestIdFrom, type LogSink } from './logger';
import { db as defaultDb } from '@nova/db';
import { defaultMailer } from './mail';
import { vercelBotCheck } from './auth/bot';
import { arcticFactory } from './auth/oauth';
import { hibpBreachCheck } from './auth/password-policy';
import { account } from './modules/account';
import { memoryCache, upstashCache, type Cache } from './cache';
import { games } from './modules/games';
import { tournaments } from './modules/tournaments';
import { publicTournaments } from './modules/tournaments/public';
import { jobs } from './modules/jobs';
import { teams } from './modules/teams';
import { registrations } from './modules/registrations';
import { competition } from './modules/competition';
import { matches } from './modules/competition/matches';
import { results } from './modules/competition/results';
import { stages } from './modules/competition/stages';
import { closing } from './modules/competition/closing';
import { submissions } from './modules/submissions';
import { stats } from './modules/stats';
import { qstashQueue } from './jobs';
import { ablyRealtime } from './realtime';
import { notifications, notificationJobs } from './modules/notifications';
import { push, pushJobs } from './modules/push';
import { webPushSender } from './modules/push/sender';
import { realtime } from './modules/realtime';
import { twoFactor } from './modules/two-factor';
import { uploads } from './modules/uploads';
import { users } from './modules/users';
import { vercelBlobStore } from './uploads/store';
import { auth } from './modules/auth';
import { oauth } from './modules/oauth';
import { databaseCheck, health, qstashCheck, redisCheck } from './modules/health';
import { memoryLimiter, requireSameOrigin, upstashLimiter, type RateLimiter } from './security';
import { adminArea } from './auth/admin';
import { adminModules } from './modules/admin';
import { reports } from './modules/reports';
import { site } from './modules/site';
import { productEvents, trackAdminMutations } from './modules/site/events';
import { discord } from './modules/discord';
import { chat } from './modules/chat';
import { calendar } from './modules/calendar';

export const API_BASE_PATH = '/api/v1';

/**
 * Módulos registrados. Entram, na ordem do B1: auth (#67 ✓, OAuth #68 ✓), users e me (#72), roles e audit (#70: `auth/rbac.ts` ✓; rotas na #72),
 * uploads (#73), games (#74), tournaments (#75, #76), teams (#78), registrations (#79). B2: chave (#82), partidas (#83, #84),
 * resultados e histórico (#85, #86), fases (#87, #88), desistência e encerramento (#88, #100), envios e disputas (#90),
 * perfil competitivo (#89).
 */
const modules = [health, auth, oauth, account, users, uploads, games, tournaments, publicTournaments, jobs, teams, registrations, competition, matches, results, stages, closing, submissions, stats, twoFactor, realtime, notifications, notificationJobs, push, pushJobs, ...adminModules, reports, site, productEvents, discord, chat, calendar];

export interface CreateAppOptions {
  /** Variáveis já validadas; padrão: as do processo, validadas na primeira requisição. */
  env?: Env | (() => Env);
  deps?: Partial<Dependencies>;
  logSink?: LogSink;
  /** Só para testes: rotas extras montadas depois dos módulos (ex.: sondas da matriz RBAC). */
  extraModules?: Hono<AppEnv>[];
}

export function createApp(options: CreateAppOptions = {}) {
  const getEnv = typeof options.env === 'function' ? options.env : options.env ? () => options.env as Env : processEnv;
  const now = options.deps?.now ?? (() => new Date());
  // Um limitador por app: o de memória precisa guardar as tentativas entre requisições.
  let limiter: RateLimiter | undefined;
  let cache: Cache | undefined;
  const deps: Dependencies = {
    checks: { database: databaseCheck, redis: redisCheck, qstash: qstashCheck, ...options.deps?.checks },
    now,
    db: options.deps?.db ?? defaultDb,
    limiter:
      options.deps?.limiter ??
      ((env) => {
        limiter ??= env.KV_REST_API_URL && env.KV_REST_API_TOKEN ? upstashLimiter(env) : memoryLimiter(now);
        return limiter;
      }),
    mailer: options.deps?.mailer ?? defaultMailer,
    oauth: options.deps?.oauth ?? arcticFactory,
    breached: options.deps?.breached ?? hibpBreachCheck,
    botCheck: options.deps?.botCheck ?? vercelBotCheck,
    blob: options.deps?.blob ?? vercelBlobStore,
    queue: options.deps?.queue ?? qstashQueue,
    revalidate: options.deps?.revalidate ?? (() => undefined),
    realtime: options.deps?.realtime ?? ablyRealtime,
    push: options.deps?.push ?? webPushSender,
    cache:
      options.deps?.cache ??
      ((env) => {
        cache ??= env.KV_REST_API_URL && env.KV_REST_API_TOKEN ? upstashCache(env) : memoryCache(now);
        return cache;
      }),
  };
  const baseLog = createLogger(options.logSink);

  const app = new Hono<AppEnv>().basePath(API_BASE_PATH);

  app.use(async (c, next) => {
    const requestId = requestIdFrom(c.req.raw.headers);
    const log = baseLog.child({ requestId });
    c.set('requestId', requestId);
    c.set('log', log);
    c.set('deps', deps);
    // Variáveis inválidas derrubam a requisição com a lista do que falta (nos logs, nunca os valores).
    c.set('env', getEnv());
    const started = performance.now();
    await next();
    c.header('X-Request-Id', requestId);
    log.info('requisição', { method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Math.round(performance.now() - started) });
  });

  // CSRF: toda mutação precisa vir do próprio site (plano B1.2).
  app.use(requireSameOrigin);

  // Área de administração (RNF-08): toda rota `/admin/*`, de qualquer módulo, exige Admin ou Super Admin com 2FA
  // feito. As alterações bem-sucedidas viram evento de produto (KR de auditoria, #101).
  app.use('/admin/*', trackAdminMutations, adminArea);

  for (const module of [...modules, ...(options.extraModules ?? [])]) app.route('/', module);

  app.notFound((c) => problemResponse(new HttpProblem(404, 'Rota não encontrada.', 'NOT_FOUND'), c.get('requestId')));

  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof HttpProblem) return problemResponse(error, requestId);
    if (error instanceof EnvError) {
      // Só os nomes e o motivo: valores de variável nunca vão para o log.
      (c.get('log') ?? baseLog).error('variáveis de ambiente inválidas', { problems: error.problems });
      return problemResponse(new HttpProblem(500, 'O servidor está com a configuração incompleta. Avise o suporte.', 'CONFIG_INVALID'), requestId);
    }
    (c.get('log') ?? baseLog).error('erro inesperado', { error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error) });
    return problemResponse(new HttpProblem(500, 'Algo deu errado do nosso lado. Tente de novo em instantes.', 'INTERNAL'), requestId);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

/** Atalho para testes: valida um objeto de variáveis como a API faria na inicialização. */
export const envFrom = parseEnv;
