/**
 * Proteções transversais: checagem de `Origin` nas mutações (CSRF) e limite de tentativas.
 */
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './context';
import type { Env } from './env';
import { HttpProblem } from './errors';

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Origens aceitas: a do site (`NEXT_PUBLIC_SITE_URL`) e a da própria requisição (previews têm URL própria). */
function allowedOrigins(requestUrl: string, env: Env): Set<string> {
  const origins = new Set([new URL(requestUrl).origin]);
  if (env.NEXT_PUBLIC_SITE_URL) origins.add(new URL(env.NEXT_PUBLIC_SITE_URL).origin);
  return origins;
}

/**
 * CSRF (plano B1.2): toda mutação precisa vir do próprio site. Com API e telas no mesmo domínio,
 * `SameSite=Lax` já barra a maioria; o `Origin` fecha o resto. Sem `Origin`, vale o `Referer`;
 * sem os dois, a mutação é recusada.
 */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Jobs do QStash não vêm de navegador: a proteção deles é a assinatura (`requireQStash`).
  if (MUTATIONS.has(c.req.method) && !c.req.path.startsWith('/api/v1/jobs/')) {
    const origin = c.req.header('origin') ?? (c.req.header('referer') ? new URL(c.req.header('referer') as string).origin : undefined);
    if (!origin || !allowedOrigins(c.req.url, c.get('env')).has(origin)) {
      throw new HttpProblem(403, 'Requisição recusada: ela não veio do site da Nova Arena.', 'INVALID_ORIGIN');
    }
  }
  await next();
};

// ── Limite de tentativas ─────────────────────────────────────────────

export interface RateLimitResult {
  success: boolean;
  /** Quando a janela libera de novo (epoch ms). */
  reset: number;
}

export interface RateLimiter {
  limit(key: string, rule: RateRule): Promise<RateLimitResult>;
}

export interface RateRule {
  /** Prefixo da regra (ex.: `login`). */
  name: string;
  tokens: number;
  windowSeconds: number;
}

export const RULES = {
  /** RNF-07 / B1.2: 5 tentativas de login por minuto por IP. */
  login: { name: 'login', tokens: 5, windowSeconds: 60 },
  register: { name: 'register', tokens: 5, windowSeconds: 60 },
  forgotPassword: { name: 'forgot', tokens: 5, windowSeconds: 60 },
  verifyEmail: { name: 'verify', tokens: 10, windowSeconds: 60 },
  /** Conferir a senha atual (troca de senha e de e-mail): por conta, contra adivinhação com a sessão roubada. */
  confirmPassword: { name: 'confirm-password', tokens: 5, windowSeconds: 300 },
} satisfies Record<string, RateRule>;

/**
 * Upstash Redis (vale para todas as instâncias da função). Se o Redis falhar (fora do ar, ou o Redis local do
 * docker-compose, que não roda os scripts do `@upstash/ratelimit`), o limite continua valendo por instância, em
 * memória: login e cadastro não viram erro 500 por causa do Redis.
 */
export function upstashLimiter(env: Env, onFallback: (error: unknown) => void = () => undefined): RateLimiter {
  const redis = new Redis({ url: env.KV_REST_API_URL as string, token: env.KV_REST_API_TOKEN as string });
  const cache = new Map<string, Ratelimit>();
  const fallback = memoryLimiter();
  return {
    async limit(key, rule) {
      let limiter = cache.get(rule.name);
      if (!limiter) {
        limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(rule.tokens, `${rule.windowSeconds} s`), prefix: `${env.KV_PREFIX ?? ''}rl:${rule.name}` });
        cache.set(rule.name, limiter);
      }
      try {
        const r = await limiter.limit(key);
        return { success: r.success, reset: r.reset };
      } catch (error) {
        onFallback(error);
        return fallback.limit(key, rule);
      }
    },
  };
}

/** Em memória, por instância: só para desenvolvimento e testes (sem Redis configurado). */
export function memoryLimiter(now: () => Date = () => new Date()): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(key, rule) {
      const t = now().getTime();
      const windowMs = rule.windowSeconds * 1000;
      const id = `${rule.name}:${key}`;
      const recent = (hits.get(id) ?? []).filter((at) => t - at < windowMs);
      const success = recent.length < rule.tokens;
      if (success) recent.push(t);
      hits.set(id, recent);
      return { success, reset: (recent[0] ?? t) + windowMs };
    },
  };
}

/** IP de quem chamou: o primeiro do `x-forwarded-for` (a borda da Vercel preenche) ou `x-real-ip`. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'desconhecido';
}

/** Aplica a regra; estourou → 429 com `Retry-After`. */
export async function enforceLimit(limiter: RateLimiter, rule: RateRule, key: string, now: Date): Promise<void> {
  const r = await limiter.limit(key, rule);
  if (!r.success) {
    const seconds = Math.max(1, Math.ceil((r.reset - now.getTime()) / 1000));
    const problem = new HttpProblem(429, `Muitas tentativas. Espere ${seconds} s e tente de novo.`, 'RATE_LIMITED');
    problem.retryAfter = seconds;
    throw problem;
  }
}
