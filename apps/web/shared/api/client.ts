import { Problem } from '@nova/schemas';
import type { ZodType } from 'zod';

/**
 * Cliente único da API. Nenhuma tela chama `fetch` direto: é isso que permite
 * trocar a API simulada (MSW) pela real sem mexer nos componentes.
 */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly fieldErrors: Record<string, string>;

  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.fieldErrors = problem.errors ?? {};
  }
}

/** Mensagem para mostrar à pessoa, qualquer que seja o erro. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return 'Sem conexão. Confira sua internet e tente de novo.';
  return 'Algo deu errado. Tente de novo em instantes.';
}

type Query = Record<string, string | number | boolean | null | undefined>;

interface RequestOptions<T> {
  query?: Query;
  body?: unknown;
  /** Valida a resposta contra o contrato. Em desenvolvimento, resposta fora do contrato gera erro. */
  schema?: ZodType<T>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
  const res = await fetch(buildUrl(path, opts.query), {
    method,
    credentials: 'same-origin',
    signal: opts.signal,
    headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let problem: Problem = { type: 'about:blank', title: 'Erro inesperado', status: res.status };
    try {
      const parsed = Problem.safeParse(await res.json());
      if (parsed.success) problem = parsed.data;
    } catch {
      // Corpo vazio ou não-JSON: fica o erro genérico.
    }
    throw new ApiError(problem);
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json();
  if (!opts.schema) return data as T;
  const parsed = opts.schema.safeParse(data);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(`[api] Resposta fora do contrato em ${method} ${path}`, parsed.error.issues);
      throw new Error(`Resposta fora do contrato em ${method} ${path}`);
    }
    return data as T;
  }
  return parsed.data;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions<T>, 'body'>) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions<T>) => request<T>('PATCH', path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions<T>) => request<T>('DELETE', path, opts),
};
