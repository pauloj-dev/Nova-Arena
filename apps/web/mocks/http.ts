/**
 * Helpers dos handlers da API simulada: respostas, erros RFC 7807, leitura do corpo com Zod
 * e autenticação/permissão — o mesmo comportamento que a API real terá em B1.
 */
import { HttpResponse, delay } from 'msw';
import type { Role } from '@nova/schemas';
import type { ZodType } from 'zod';
import { db, getSessionUserId, type DbTournament, type DbUser } from './db';

export const API = '/api/v1';
export const url = (path: string) => `${API}${path}`;

/** Latência simulada, para os estados de carregando aparecerem no protótipo. Zero nos testes. */
export async function latency(): Promise<void> {
  if (typeof window !== 'undefined' && (window as { __NOVA_E2E__?: boolean }).__NOVA_E2E__) return;
  await delay(process.env.NODE_ENV === 'test' ? 0 : 180);
}

export function json<T>(data: T, status = 200) {
  return HttpResponse.json(data as never, { status });
}
export function noContent() {
  return new HttpResponse(null, { status: 204 });
}

export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly code?: string,
    readonly errors?: Record<string, string>,
  ) {
    super(title);
  }
  toResponse() {
    return HttpResponse.json(
      { type: 'about:blank', title: this.title, status: this.status, detail: this.title, code: this.code, errors: this.errors },
      { status: this.status, headers: { 'Content-Type': 'application/problem+json' } },
    );
  }
}

export const badRequest = (title: string, code?: string, errors?: Record<string, string>) => new HttpProblem(400, title, code, errors);
export const unauthorized = () => new HttpProblem(401, 'Entre na sua conta para continuar.', 'UNAUTHENTICATED');
export const forbidden = (title = 'Você não tem permissão para fazer isso.') => new HttpProblem(403, title, 'FORBIDDEN');
export const notFound = (what = 'Recurso') => new HttpProblem(404, `${what} não encontrado.`, 'NOT_FOUND');
export const conflict = (title: string, code?: string) => new HttpProblem(409, title, code);

/** Lê e valida o corpo. Erros de validação viram 400 com mensagem por campo. */
export async function body<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('Corpo da requisição inválido.', 'INVALID_BODY');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!errors[key]) errors[key] = issue.message;
    }
    throw badRequest('Confira os campos destacados.', 'VALIDATION', errors);
  }
  return parsed.data;
}

export function query(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

// ── Autenticação e permissão ─────────────────────────────────────────
export function currentUser(): DbUser | null {
  const id = getSessionUserId();
  if (!id) return null;
  const user = db().users.find((u) => u.id === id);
  // Banido, suspenso, excluído ou mesclado: a sessão deixa de valer na hora (CT-09).
  if (!user || user.status !== 'ACTIVE') return null;
  return user;
}
export function requireUser(): DbUser {
  const user = currentUser();
  if (!user) throw unauthorized();
  return user;
}
export function hasRole(user: DbUser, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}
export function isAdmin(user: DbUser): boolean {
  return hasRole(user, 'ADMIN', 'SUPER_ADMIN');
}
export function requireRole(...roles: Role[]): DbUser {
  const user = requireUser();
  if (!hasRole(user, ...roles)) throw forbidden();
  return user;
}
export function requireAdmin(): DbUser {
  const user = requireRole('ADMIN', 'SUPER_ADMIN');
  // A verificação em duas etapas é obrigatória para a área de administração (RNF-08).
  if (!user.twoFactorEnabled) throw new HttpProblem(403, 'Ative a verificação em duas etapas para usar a administração.', 'TWO_FACTOR_REQUIRED');
  return user;
}

export type TournamentAccess = 'OWNER' | 'CO_ORGANIZER' | 'MODERATOR' | 'ADMIN';

/** Papel do usuário naquele campeonato, ou nulo (matriz RBAC do PRD §6). */
export function tournamentAccess(user: DbUser | null, t: DbTournament): TournamentAccess | null {
  if (!user) return null;
  if (isAdmin(user)) return 'ADMIN';
  if (t.ownerId === user.id) return 'OWNER';
  const staff = db().staff.find((s) => s.tournamentId === t.id && s.userId === user.id);
  return staff ? staff.role : null;
}
/** Exige dono, co-organizador ou Admin. Com `allowModerator`, moderador também passa. */
export function requireTournamentAccess(t: DbTournament, opts: { allowModerator?: boolean } = {}): { user: DbUser; access: TournamentAccess } {
  const user = requireUser();
  const access = tournamentAccess(user, t);
  if (!access || (access === 'MODERATOR' && !opts.allowModerator)) throw forbidden('Só a organização deste campeonato pode fazer isso.');
  return { user, access };
}

export function findTournament(idOrSlug: string): DbTournament {
  const t = db().tournaments.find((x) => x.id === idOrSlug || x.slug === idOrSlug);
  if (!t) throw notFound('Campeonato');
  return t;
}

export interface HandlerArgs {
  request: Request;
  params: Record<string, string | readonly string[] | undefined>;
}
type Resolver = (args: HandlerArgs) => Promise<Response> | Response;

/** Envolve o handler: aplica latência e transforma `HttpProblem` em resposta de erro. */
export function handle(resolver: Resolver) {
  return async (args: HandlerArgs): Promise<Response> => {
    await latency();
    try {
      return await resolver(args);
    } catch (error) {
      if (error instanceof HttpProblem) return error.toResponse();
      console.error('[mock] erro inesperado', error);
      return new HttpProblem(500, 'Erro interno na API simulada.').toResponse();
    }
  };
}

export function param(params: HandlerArgs['params'], name: string): string {
  const v = params[name];
  if (typeof v !== 'string') throw notFound();
  return v;
}

/** Paginação por cursor sobre uma lista já filtrada e ordenada. O cursor é o índice. */
export function paginate<T>(items: T[], cursor: string | null, limit: number): { items: T[]; nextCursor: string | null; total: number } {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const slice = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : null;
  return { items: slice, nextCursor: next, total: items.length };
}
export function paginateNumbered<T>(items: T[], pageParam: string | null, size = 20) {
  const page = Math.max(1, Number.parseInt(pageParam ?? '1', 10) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  return { items: items.slice((page - 1) * size, page * size), page: Math.min(page, pageCount), pageCount, total: items.length };
}
