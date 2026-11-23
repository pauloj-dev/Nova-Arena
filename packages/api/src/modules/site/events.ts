/**
 * Eventos de produto (issue #101): análise própria, **sem cookies** e compatível com a LGPD. Nada de IP, navegador
 * ou identificador de aparelho: só o nome do evento, o usuário (quando logado) e números do evento.
 *
 * - `POST /events`: eventos do navegador do catálogo `PRODUCT_EVENT_NAMES` (ex.: tempo para lançar um resultado).
 * - `POST /me/nps`: pesquisa NPS depois do campeonato, para quem participou ou organizou (uma resposta por campeonato).
 * - `trackAdminMutations`: depois de `adminArea`, registra cada alteração bem-sucedida em `/admin/*` (base do KR
 *   "100% das ações administrativas auditadas"). Quem responde sem mudar nada chama `markUnchanged(c)`.
 */
import type { Prisma } from '@nova/db';
import { NpsAnswer, NpsAnswerInput, ProductEventInput } from '@nova/schemas';
import { Hono, type MiddlewareHandler } from 'hono';
import { currentSession, requireSession } from '../../auth/session';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { conflict, forbidden, notFound } from '../../errors';
import { clientIp, enforceLimit, type RateRule } from '../../security';
import { isUuid } from '../admin/shared';

const EVENTS_RULE: RateRule = { name: 'product-events', tokens: 60, windowSeconds: 60 };
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const productEvents = new Hono<AppEnv>();

/** Grava um evento. Nunca derruba a requisição: falha vai para o log. */
export async function trackEvent(c: AppContext, name: string, userId: string | null, props: Record<string, unknown> = {}): Promise<void> {
  try {
    await c
      .get('deps')
      .db()
      .productEvent.create({ data: { name, userId, props: props as Prisma.InputJsonObject } });
  } catch (error) {
    c.get('log').warn('evento de produto não gravado', { name, error: error instanceof Error ? error.message : String(error) });
  }
}

productEvents.post('/events', async (c) => {
  const { limiter, now } = c.get('deps');
  await enforceLimit(limiter(c.get('env')), EVENTS_RULE, clientIp(c.req.raw.headers), now());
  const input = await body(c, ProductEventInput);
  const session = await currentSession(c);
  await trackEvent(c, input.name, session?.userId ?? null, input.props);
  return c.json({ ok: true }, 202);
});

productEvents.post('/me/nps', async (c) => {
  const session = await requireSession(c);
  const input = await body(c, NpsAnswerInput);
  const db = c.get('deps').db();
  const t = isUuid(input.tournamentId) ? await db.tournament.findUnique({ where: { id: input.tournamentId }, select: { id: true, ownerId: true, status: true } }) : null;
  if (!t) throw notFound('Campeonato');
  if (t.status !== 'FINISHED' && t.status !== 'ARCHIVED') throw conflict('A pesquisa abre quando o campeonato termina.', 'NPS_NOT_OPEN');
  const staff = await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  let as: NpsAnswer['as'] | null = t.ownerId === session.userId || staff?.role === 'CO_ORGANIZER' ? 'ORGANIZER' : null;
  if (!as) {
    const played = await db.registration.count({
      where: { tournamentId: t.id, status: { in: ['CONFIRMED', 'DISQUALIFIED', 'WITHDRAWN'] }, OR: [{ userId: session.userId }, { members: { some: { userId: session.userId } } }] },
    });
    if (played > 0) as = 'PARTICIPANT';
  }
  if (!as) throw forbidden('Só quem participou ou organizou o campeonato responde a esta pesquisa.', 'NPS_NOT_ALLOWED');
  const already = await db.productEvent.count({ where: { name: 'nps', userId: session.userId, props: { path: ['tournamentId'], equals: t.id } } });
  if (already > 0) throw conflict('Você já respondeu a pesquisa deste campeonato. Obrigado!', 'NPS_ALREADY_ANSWERED');
  const saved = await db.productEvent.create({ data: { name: 'nps', userId: session.userId, props: { tournamentId: t.id, score: input.score, as } } });
  return respond(c, NpsAnswer, { tournamentId: t.id, score: input.score, as, createdAt: saved.createdAt.toISOString() }, 201);
});

// ── Alterações na área de administração ──────────────────────────────
const unchanged = new WeakSet<Request>();

/** A ação foi aceita mas não mudou nada (ex.: salvar sem alterar): não conta para a cobertura da auditoria. */
export function markUnchanged(c: AppContext): void {
  unchanged.add(c.req.raw);
}

/** Caminho sem ids (só o formato da rota): `/admin/users/:id/sanctions`. */
const routeShape = (path: string) => path.replace(/^\/api\/v1/, '').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');

export const trackAdminMutations: MiddlewareHandler<AppEnv> = async (c, next) => {
  const startedAt = new Date();
  await next();
  if (!MUTATIONS.has(c.req.method) || c.res.status >= 400 || unchanged.has(c.req.raw)) return;
  const session = c.get('session');
  if (!session) return;
  await trackEvent(c, 'admin_mutation', session.userId, { route: `${c.req.method} ${routeShape(c.req.path)}`, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString() });
};
