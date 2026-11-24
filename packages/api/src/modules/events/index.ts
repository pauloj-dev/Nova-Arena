/**
 * Eventos (ADR-0005): um evento agrupa vários campeonatos de quem organiza, com a regra de participação
 * (`SINGLE`: um só campeonato por jogador; `MULTIPLE`: vários). A regra é conferida na inscrição (`rules.ts`).
 *
 * - Público: `GET /events/:slug` (evento + campeonatos publicados).
 * - Organizador (dono do evento ou Admin): `GET|POST /organizer/events`, `GET|PATCH|DELETE /organizer/events/:id`,
 *   `POST /organizer/events/:id/tournaments`, `DELETE /organizer/events/:id/tournaments/:tournamentId`. Auditado.
 * - O campeonato também entra no evento pelo assistente (`eventId` em `POST /tournaments` e `PATCH /tournaments/:id`).
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { Event, EventDetail, EventInput, EventPatch, EventTournamentInput, Ok, type TournamentStatus } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { conflict, forbidden, notFound } from '../../errors';
import { ORGANIZER_AREA_ROLES, assertRole, assertTournamentAccess, currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { EDGE_CACHE, publicCache } from '../../http-cache';
import { revalidateTournaments } from '../../revalidate';
import { auditCtx, isUuid } from '../competition/access';
import { slugify } from '../tournaments';
import { countsOf, toTournamentSummary, tournamentInclude } from '../tournaments/views';
import { assertEventAssignable, EVENT_EDITABLE_STATUSES, playersInSeveralTournaments } from './rules';

type Db = PrismaClient | Prisma.TransactionClient;

/** Na página pública, rascunho e cancelado não aparecem. */
const PUBLIC_HIDDEN: TournamentStatus[] = ['DRAFT', 'CANCELLED'];
/** Evento só é excluído enquanto nenhum campeonato dele saiu do rascunho (ou foi cancelado): o link já circulou. */
const DELETABLE_WITH: TournamentStatus[] = ['DRAFT', 'CANCELLED'];

const eventInclude = { owner: { select: { id: true, nickname: true } }, tournaments: { select: { id: true, status: true } } } satisfies Prisma.EventInclude;
type EventRow = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

function toEvent(row: EventRow, visible: (status: TournamentStatus) => boolean): Event {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    bannerUrl: row.bannerUrl,
    participationRule: row.participationRule,
    owner: row.owner,
    tournamentCount: row.tournaments.filter((t) => visible(t.status)).length,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const all = () => true;
const isPublic = (status: TournamentStatus) => !PUBLIC_HIDDEN.includes(status);

async function detailOf(db: Db, row: EventRow, visible: (status: TournamentStatus) => boolean): Promise<EventDetail> {
  const rows = await db.tournament.findMany({ where: { eventId: row.id }, include: tournamentInclude });
  const shown = rows.filter((t) => visible(t.status));
  // Primeiro os que começam antes; sem data, no fim.
  shown.sort((a, b) => (a.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name, 'pt-BR'));
  const counts = await countsOf(db, shown.map((t) => t.id));
  return { ...toEvent(row, visible), tournaments: shown.map((t) => toTournamentSummary(t, counts.get(t.id))) };
}

async function uniqueEventSlug(db: Db, name: string): Promise<string> {
  const root = slugify(name) || 'evento';
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? root : `${root}-${i}`;
    if (!(await db.event.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Evento que a pessoa pode gerenciar: a dona ou um Admin. */
async function manageableEvent(c: AppContext, id: string): Promise<EventRow> {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const row = isUuid(id) ? await db.event.findUnique({ where: { id }, include: eventInclude }) : null;
  if (!row) throw notFound('Evento');
  if (row.ownerId !== session.userId && !isAdmin(await currentRoles(c))) throw forbidden('Só quem organiza o evento pode alterá-lo.');
  return row;
}

// ── Rotas ────────────────────────────────────────────────────────────
export const events = new Hono<AppEnv>();

events.get('/events/:slug', async (c) => {
  const db = c.get('deps').db();
  const slug = c.req.param('slug');
  const row = await db.event.findFirst({ where: isUuid(slug) ? { OR: [{ slug }, { id: slug }] } : { slug }, include: eventInclude });
  // Evento sem nenhum campeonato publicado ainda não existe para o público.
  if (!row || !row.tournaments.some((t) => isPublic(t.status))) throw notFound('Evento');
  publicCache(c, EDGE_CACHE.listing);
  return respond(c, EventDetail, await detailOf(db, row, isPublic));
});

events.get('/organizer/events', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const session = await requireSession(c);
  const rows = await c.get('deps').db().event.findMany({ where: { ownerId: session.userId }, include: eventInclude, orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }] });
  return respond(c, z.array(Event), rows.map((r) => toEvent(r, all)));
});

events.get('/organizer/events/:id', async (c) => {
  const row = await manageableEvent(c, c.req.param('id'));
  return respond(c, EventDetail, await detailOf(c.get('deps').db(), row, all));
});

events.post('/organizer/events', async (c) => {
  await assertRole(c, ORGANIZER_AREA_ROLES);
  const input = await body(c, EventInput);
  const db = c.get('deps').db();
  const audit = await auditCtx(c);
  const row = await withAudit(db, audit, async (tx) => {
    const created = await tx.event.create({
      data: { slug: await uniqueEventSlug(tx, input.name), name: input.name, description: input.description, participationRule: input.participationRule, bannerUrl: input.bannerUrl ?? null, ownerId: audit.actorId },
      include: eventInclude,
    });
    await audited(tx, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: created.id, entityLabel: created.name, after: { name: created.name, regra: created.participationRule } });
    return created;
  });
  return respond(c, Event, toEvent(row, all), 201);
});

events.patch('/organizer/events/:id', async (c) => {
  const current = await manageableEvent(c, c.req.param('id'));
  const input = await body(c, EventPatch);
  const db = c.get('deps').db();
  const row = await withAudit(db, await auditCtx(c), async (tx) => {
    if (input.participationRule === 'SINGLE' && current.participationRule !== 'SINGLE') {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${current.id}::uuid FOR UPDATE`;
      const clash = await playersInSeveralTournaments(tx, current.id);
      if (clash > 0) {
        const who = clash === 1 ? '1 jogador já está' : `${clash} jogadores já estão`;
        throw conflict(`${who} em mais de um campeonato deste evento. Para valer "um só campeonato por jogador", essas inscrições precisam ser resolvidas antes.`, 'EVENT_RULE_CONFLICT');
      }
    }
    const updated = await tx.event.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.participationRule !== undefined ? { participationRule: input.participationRule } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
      },
      include: eventInclude,
    });
    await audited(tx, {
      action: 'EVENT_CHANGED',
      entityType: 'Event',
      entityId: current.id,
      entityLabel: updated.name,
      before: { name: current.name, regra: current.participationRule },
      after: { name: updated.name, regra: updated.participationRule },
    });
    return updated;
  });
  revalidateTournaments(c);
  return respond(c, Event, toEvent(row, all));
});

events.delete('/organizer/events/:id', async (c) => {
  const current = await manageableEvent(c, c.req.param('id'));
  if (current.tournaments.some((t) => !DELETABLE_WITH.includes(t.status))) {
    throw conflict('Este evento já tem campeonato publicado. Tire os campeonatos do evento ou cancele-os antes de excluir.', 'EVENT_HAS_TOURNAMENTS');
  }
  await withAudit(c.get('deps').db(), await auditCtx(c), async (tx) => {
    // Os campeonatos continuam existindo, avulsos (`onDelete: SetNull`).
    await tx.event.delete({ where: { id: current.id } });
    await audited(tx, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: current.id, entityLabel: current.name, before: { name: current.name }, after: { removido: true } });
  });
  return respond(c, Ok, { ok: true });
});

events.post('/organizer/events/:id/tournaments', async (c) => {
  const current = await manageableEvent(c, c.req.param('id'));
  const input = await body(c, EventTournamentInput);
  // Só entra campeonato que a pessoa organiza (dona, co-organizadora ou Admin).
  const access = await assertTournamentAccess(c, input.tournamentId, 'manage');
  const db = c.get('deps').db();
  const t = await db.tournament.findUniqueOrThrow({ where: { id: access.tournamentId }, select: { id: true, name: true, status: true, eventId: true } });
  if (t.eventId === current.id) throw conflict('Este campeonato já faz parte do evento.', 'TOURNAMENT_IN_EVENT');
  if (t.eventId !== null) throw conflict('Este campeonato já faz parte de outro evento. Tire-o de lá antes.', 'TOURNAMENT_IN_EVENT');
  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.$queryRaw`SELECT id FROM events WHERE id = ${current.id}::uuid FOR UPDATE`;
    await assertEventAssignable(c, tx, t, current.id);
    await tx.tournament.update({ where: { id: t.id }, data: { eventId: current.id } });
    await audited(tx, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: current.id, entityLabel: current.name, tournamentId: t.id, after: { campeonatoIncluido: t.name } });
  });
  revalidateTournaments(c);
  return respond(c, EventDetail, await detailOf(db, await manageableEvent(c, current.id), all));
});

events.delete('/organizer/events/:id/tournaments/:tournamentId', async (c) => {
  const current = await manageableEvent(c, c.req.param('id'));
  const tournamentId = c.req.param('tournamentId');
  const db = c.get('deps').db();
  const t = isUuid(tournamentId) ? await db.tournament.findFirst({ where: { id: tournamentId, eventId: current.id }, select: { id: true, name: true, status: true, eventId: true } }) : null;
  if (!t) throw notFound('Campeonato do evento');
  if (!EVENT_EDITABLE_STATUSES.includes(t.status) && t.status !== 'CANCELLED') throw conflict('O campeonato já começou: ele não sai mais do evento.', 'EVENT_LOCKED');
  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.tournament.update({ where: { id: t.id }, data: { eventId: null } });
    await audited(tx, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: current.id, entityLabel: current.name, tournamentId: t.id, after: { campeonatoRetirado: t.name } });
  });
  revalidateTournaments(c);
  return respond(c, EventDetail, await detailOf(db, await manageableEvent(c, current.id), all));
});
