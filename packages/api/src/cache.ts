/**
 * Cache de leituras públicas (issue #74: lista de jogos ativos). Upstash Redis quando configurado (vale para
 * todas as instâncias da função); senão, memória da instância (desenvolvimento e testes).
 * Quem escreve invalida (`del`) na mesma requisição.
 */
import { Redis } from '@upstash/redis';
import type { Env } from './env';

export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function upstashCache(env: Env): Cache {
  const redis = new Redis({ url: env.KV_REST_API_URL as string, token: env.KV_REST_API_TOKEN as string });
  // `KV_PREFIX`: ambientes que dividem o mesmo Redis não leem o cache um do outro.
  const k = (key: string) => `${env.KV_PREFIX ?? ''}${key}`;
  return {
    get: async <T>(key: string) => (await redis.get<T>(k(key))) ?? null,
    set: async (key, value, ttlSeconds) => void (await redis.set(k(key), value, { ex: ttlSeconds })),
    del: async (key) => void (await redis.del(k(key))),
  };
}

export function memoryCache(now: () => Date): Cache {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get<T>(key: string) {
      const hit = store.get(key);
      if (!hit || hit.expiresAt <= now().getTime()) return null;
      return structuredClone(hit.value) as T;
    },
    async set(key, value, ttlSeconds) {
      store.set(key, { value: structuredClone(value), expiresAt: now().getTime() + ttlSeconds * 1000 });
    },
    async del(key) {
      store.delete(key);
    },
  };
}
