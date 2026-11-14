/**
 * Sobe a API simulada dentro do Vitest (msw/node) para testar as regras dos handlers de ponta a ponta,
 * sem navegador. Usado pelos testes de `features/teams` e `features/registrations`.
 */
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { db, resetDb, save, setSessionUserId, type Db } from '@/mocks/db';
import { handlers as registrationHandlers } from '@/mocks/handlers/registrations';
import { handlers as registrationManageHandlers } from '@/mocks/handlers/registrations-manage';
import { handlers as teamHandlers } from '@/mocks/handlers/teams';
import { handlers as tournamentHandlers } from '@/mocks/handlers/tournaments';

const ORIGIN = 'http://localhost:3000';

export interface ApiResult<T = unknown> {
  status: number;
  data: T;
  code: string | undefined;
  detail: string | undefined;
}

export function setupMockApi() {
  const server = setupServer(...registrationHandlers, ...registrationManageHandlers, ...tournamentHandlers, ...teamHandlers);
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

export async function call<T = unknown>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${ORIGIN}/api/v1${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = res.status === 204 ? null : await res.json();
  const problem = (res.ok ? {} : data) as { code?: string; detail?: string };
  return { status: res.status, data: data as T, code: problem.code, detail: problem.detail };
}
