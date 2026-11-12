/**
 * Sobe a API simulada inteira dentro do Vitest (msw/node), para testar as regras dos handlers
 * de ponta a ponta sem navegador — os mesmos cenários que a API real terá de passar em B1/B2.
 */
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { db, resetDb, save, setSessionUserId, type Db } from './db';
import { enabledHandlers } from './handlers';

const ORIGIN = 'http://localhost:3000';

export interface ApiResult<T = unknown> {
  status: number;
  data: T;
  code: string | undefined;
  detail: string | undefined;
}

export function setupMockApi(): void {
  const server = setupServer(...enabledHandlers('all'));
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  beforeEach(() => resetDb());
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
}

/** Troca o usuário da sessão simulada. `null` = visitante. */
export function as(userId: string | null): void {
  setSessionUserId(userId);
}

/** Muda o banco simulado direto (preparar cenários que a API não cria sozinha). */
export function mutate(change: (d: Db) => void): void {
  change(db());
  save();
}

export async function call<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const res = await fetch(`${ORIGIN}/api/v1${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = res.status === 204 ? null : await res.json();
  const problem = (res.ok ? {} : data) as { code?: string; detail?: string };
  return { status: res.status, data: data as T, code: problem.code, detail: problem.detail };
}
