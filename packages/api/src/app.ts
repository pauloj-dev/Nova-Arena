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
import { databaseCheck, health, qstashCheck, redisCheck } from './modules/health';

export const API_BASE_PATH = '/api/v1';

/**
 * Módulos registrados. Entram, na ordem do B1: auth (#67, #68), users e me (#72), roles e audit (#70, #71),
 * uploads (#73), games (#74), tournaments (#75, #76), teams (#78), registrations (#79).
 */
const modules = [health];

export interface CreateAppOptions {
  /** Variáveis já validadas; padrão: as do processo, validadas na primeira requisição. */
  env?: Env | (() => Env);
  deps?: Partial<Dependencies>;
  logSink?: LogSink;
}

export function createApp(options: CreateAppOptions = {}) {
  const getEnv = typeof options.env === 'function' ? options.env : options.env ? () => options.env as Env : processEnv;
  const deps: Dependencies = {
    checks: { database: databaseCheck, redis: redisCheck, qstash: qstashCheck, ...options.deps?.checks },
    now: options.deps?.now ?? (() => new Date()),
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

  for (const module of modules) app.route('/', module);

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
