/**
 * Calendário .ics (issue 125, plano §11 melhoria 7). Porta de `apps/web/mocks/handlers/calendar.ts`.
 *
 * - `GET /me/calendar` (sessão): endereços do calendário "minhas partidas". O endereço leva uma assinatura
 *   (HMAC-SHA256 com `AUTH_JWT_SECRET` sobre o id da pessoa): o aplicativo de calendário busca sem cookie.
 * - `GET /calendar/u/:file` (`<id>.<assinatura>.ics`): as partidas com horário das inscrições ativas da pessoa, em
 *   todos os campeonatos publicados. Assinatura errada = 404 (não revela se a conta existe).
 * - `GET /tournaments/:id/calendar`: endereços do calendário de um campeonato (rascunho só para a organização).
 * - `GET /calendar/t/:file` (`<slug>.ics`): todas as partidas com horário de um campeonato publicado.
 *
 * Horários sempre em UTC no arquivo (`buildIcs`), com o fuso da pessoa como dica (`X-WR-TIMEZONE`).
 */
import { ACTIVE_REGISTRATION_STATUSES, buildIcs, CalendarFeed, matchToIcsEvent, type IcsEvent } from '@nova/schemas';
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { respond, type AppContext, type AppEnv } from '../../context';
import { HttpProblem, notFound } from '../../errors';
import { requireSession } from '../../auth/session';
import { listMatches } from '../../competition/bracket';
import { staffVia } from '../competition/access';

const HIDDEN_STATUSES = ['DRAFT', 'CANCELLED'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretOf(c: AppContext): string {
  const secret = c.get('env').AUTH_JWT_SECRET;
  if (!secret) throw new HttpProblem(503, 'O calendário está indisponível no momento.', 'CALENDAR_UNAVAILABLE');
  return secret;
}

/** Assinatura do calendário pessoal (base64url, sem preenchimento). */
export function calendarSignature(secret: string, userId: string): string {
  return createHmac('sha256', secret).update(`calendar:${userId}`).digest('base64url');
}

function validSignature(secret: string, userId: string, signature: string): boolean {
  const expected = Buffer.from(calendarSignature(secret, userId));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function siteUrl(c: AppContext): string {
  return (c.get('env').NEXT_PUBLIC_SITE_URL ?? new URL(c.req.url).origin).replace(/\/$/, '');
}

function feed(c: AppContext, path: string, filename: string, events: number): CalendarFeed {
  const url = `${siteUrl(c)}/api/v1${path}`;
  return { url, webcalUrl: url.replace(/^https?:\/\//, 'webcal://'), filename, events };
}

function icsResponse(c: AppContext, ics: string, filename: string, visibility: 'private' | 'public') {
  return c.body(ics, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `inline; filename="${filename}"`,
    'Cache-Control': visibility === 'private' ? 'private, max-age=300' : 'public, max-age=300',
  });
}

/** As partidas com horário das inscrições ativas da pessoa, em campeonatos publicados. */
async function myEvents(c: AppContext, userId: string): Promise<IcsEvent[]> {
  const db = c.get('deps').db();
  const regs = await db.registration.findMany({
    where: { status: { in: [...ACTIVE_REGISTRATION_STATUSES] }, OR: [{ userId }, { members: { some: { userId } } }], tournament: { status: { notIn: [...HIDDEN_STATUSES] } } },
    select: { id: true, tournament: { select: { id: true, name: true, slug: true } } },
  });
  const site = siteUrl(c);
  const events: IcsEvent[] = [];
  for (const reg of regs) {
    const matches = await listMatches(db, reg.tournament.id);
    for (const m of matches) {
      if (!m.participants.some((p) => p.registrationId === reg.id)) continue;
      const event = matchToIcsEvent(m, reg.tournament, { siteUrl: site });
      if (event) events.push(event);
    }
  }
  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

async function tournamentEvents(c: AppContext, t: { id: string; name: string; slug: string }): Promise<IcsEvent[]> {
  const site = siteUrl(c);
  return (await listMatches(c.get('deps').db(), t.id))
    .map((m) => matchToIcsEvent(m, t, { siteUrl: site }))
    .filter((e): e is IcsEvent => e !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const calendar = new Hono<AppEnv>();

calendar.get('/me/calendar', async (c) => {
  const session = await requireSession(c);
  const signature = calendarSignature(secretOf(c), session.userId);
  const events = await myEvents(c, session.userId);
  c.header('Cache-Control', 'private, no-store');
  return respond(c, CalendarFeed, feed(c, `/calendar/u/${session.userId}.${signature}.ics`, 'minhas-partidas-nova-arena.ics', events.length));
});

calendar.get('/calendar/u/:file', async (c) => {
  const file = c.req.param('file');
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]+)\.ics$/i.exec(file);
  const userId = match?.[1];
  const signature = match?.[2];
  if (!userId || !signature || !UUID.test(userId) || !validSignature(secretOf(c), userId, signature)) throw notFound('Calendário');
  const user = await c.get('deps').db().user.findUnique({ where: { id: userId }, select: { status: true, timezone: true } });
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw notFound('Calendário');
  const ics = buildIcs({ name: 'Minhas partidas · Nova Arena', description: 'Suas partidas marcadas na Nova Arena.', timeZone: user.timezone, events: await myEvents(c, userId), now: c.get('deps').now() });
  return icsResponse(c, ics, 'minhas-partidas-nova-arena.ics', 'private');
});

async function findVisibleTournament(c: AppContext, idOrSlug: string) {
  const t = await c
    .get('deps')
    .db()
    .tournament.findFirst({ where: UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }, select: { id: true, name: true, slug: true, status: true, ownerId: true } });
  if (!t) throw notFound('Campeonato');
  if (t.status === 'DRAFT' && !(await staffVia(c, t))) throw notFound('Campeonato');
  return t;
}

calendar.get('/tournaments/:id/calendar', async (c) => {
  const t = await findVisibleTournament(c, c.req.param('id'));
  const events = await tournamentEvents(c, t);
  return respond(c, CalendarFeed, feed(c, `/calendar/t/${t.slug}.ics`, `${t.slug}.ics`, events.length));
});

calendar.get('/calendar/t/:file', async (c) => {
  const slug = c.req.param('file').replace(/\.ics$/i, '');
  const t = await c.get('deps').db().tournament.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, status: true } });
  // O arquivo é público (o aplicativo de calendário busca sem login): rascunho não aparece.
  if (!t || t.status === 'DRAFT') throw notFound('Calendário');
  const ics = buildIcs({ name: `${t.name} · Nova Arena`, description: `Partidas de ${t.name} na Nova Arena.`, events: await tournamentEvents(c, t), now: c.get('deps').now() });
  return icsResponse(c, ics, `${t.slug}.ics`, 'public');
});
