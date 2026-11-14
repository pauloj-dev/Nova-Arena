/**
 * Tipos e utilidades compartilhados pelos módulos: o contexto do Hono, a leitura do corpo validada
 * pelo contrato e a resposta validada pelo contrato.
 */
import type { PrismaClient } from '@nova/db';
import type { Context } from 'hono';
import type { ZodType } from 'zod';
import type { Env } from './env';
import { badRequest, fieldErrors, HttpProblem } from './errors';
import type { Logger } from './logger';
import type { Mailer } from './mail';
import type { RateLimiter } from './security';

/** Verificação de uma dependência (banco, Redis, QStash): devolve ok ou lança com o motivo. */
export type DependencyCheck = (env: Env) => Promise<'ok' | 'not_configured'>;

export interface Dependencies {
  checks: { database: DependencyCheck; redis: DependencyCheck; qstash: DependencyCheck };
  /** Relógio injetável (testes). */
  now: () => Date;
  /** Banco (padrão: `db()` de `@nova/db`, criado na primeira chamada). */
  db: () => PrismaClient;
  /** Limite de tentativas (padrão: Upstash quando configurado; senão, em memória). */
  limiter: (env: Env) => RateLimiter;
  /** Envio de e-mail (padrão: só registra no log até a issue #80). */
  mailer: (log: Logger) => Mailer;
}

/** Sessão da requisição, carregada sob demanda por `currentUser(c)`. */
export interface SessionInfo {
  userId: string;
  sessionId: string;
  twoFactorVerified: boolean;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
    env: Env;
    deps: Dependencies;
    /** `undefined` = ainda não carregada; `null` = visitante. */
    session?: SessionInfo | null;
  };
}

export type AppContext = Context<AppEnv>;

/** Lê o corpo JSON e valida pelo schema de `@nova/schemas`. Erro de campo → 400 `VALIDATION`. */
export async function body<T>(c: AppContext, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Corpo da requisição inválido.', 'INVALID_BODY');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest('Confira os campos destacados.', 'VALIDATION', fieldErrors(parsed.error));
  return parsed.data;
}

/**
 * Responde validando pelo contrato (plano §4.3: 100% dos endpoints). Resposta fora do contrato vira 500
 * `CONTRACT_VIOLATION` — e quebra o teste de integração da rota — em vez de chegar torta na tela.
 */
export function respond<T>(c: AppContext, schema: ZodType<T>, data: T, status: 200 | 201 | 202 | 503 = 200): Response {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    c.get('log').error('resposta fora do contrato', { path: c.req.path, errors: fieldErrors(parsed.error) });
    throw new HttpProblem(500, 'A API respondeu fora do contrato.', 'CONTRACT_VIOLATION');
  }
  return c.json(parsed.data as object, status);
}
