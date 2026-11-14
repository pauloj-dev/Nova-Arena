/**
 * Erros no padrão RFC 7807 (`application/problem+json`), no mesmo formato da API simulada
 * (`apps/web/mocks/http.ts`): `{ type, title, status, detail, code, errors }`. A tela lê `code` e `errors`.
 */
import type { Problem } from '@nova/schemas';
import type { ZodError } from 'zod';

export class HttpProblem extends Error {
  /** Segundos até poder tentar de novo (vira o cabeçalho `Retry-After` no 429). */
  retryAfter?: number;

  constructor(
    readonly status: number,
    readonly title: string,
    readonly code?: string,
    readonly errors?: Record<string, string>,
  ) {
    super(title);
    this.name = 'HttpProblem';
  }

  toJSON(): Problem {
    return { type: 'about:blank', title: this.title, status: this.status, detail: this.title, code: this.code, errors: this.errors };
  }
}

export const badRequest = (title: string, code?: string, errors?: Record<string, string>) => new HttpProblem(400, title, code, errors);
export const unauthorized = (title = 'Entre na sua conta para continuar.') => new HttpProblem(401, title, 'UNAUTHENTICATED');
export const forbidden = (title = 'Você não tem permissão para fazer isso.', code = 'FORBIDDEN') => new HttpProblem(403, title, code);
export const notFound = (what: string) => new HttpProblem(404, `${what} não encontrado.`, 'NOT_FOUND');
export const conflict = (title: string, code?: string) => new HttpProblem(409, title, code);

/** Erros de campo a partir de uma falha do Zod: o primeiro erro de cada campo, com o caminho em pontos. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function problemResponse(problem: HttpProblem, requestId?: string): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/problem+json' };
  if (requestId) headers['X-Request-Id'] = requestId;
  if (problem.retryAfter) headers['Retry-After'] = String(problem.retryAfter);
  return new Response(JSON.stringify(problem.toJSON()), { status: problem.status, headers });
}
