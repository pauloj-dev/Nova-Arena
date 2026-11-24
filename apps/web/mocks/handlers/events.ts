/**
 * Módulo `events` da API simulada (ADR-0005): eventos que agrupam campeonatos, com a regra de participação.
 * Mesmas rotas, permissões e códigos de erro da API real (`packages/api/src/modules/events`).
 */
import { http } from 'msw';
import { EventInput, EventPatch, EventTournamentInput } from '@nova/schemas';
import { audit } from '../audit';
import { db, nowIso, save, slugify, uid } from '../db';
import { eventsStore, type DbEvent } from '../event-store';
import { EVENT_EDITABLE_STATUSES, assertEventAssignable, isPublicTournament, playersInSeveralTournaments, toEvent, toEventDetail } from '../events';
import { body, conflict, forbidden, handle, isAdmin, json, notFound, param, requireRole, requireTournamentAccess, requireUser, url } from '../http';

export const moduleName = 'events';

const ORGANIZER_ROLES = ['ORGANIZER', 'ADMIN', 'SUPER_ADMIN'] as const;

function uniqueEventSlug(name: string): string {
  const root = slugify(name) || 'evento';
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? root : `${root}-${i}`;
    if (!eventsStore().some((e) => e.slug === slug)) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function manageableEvent(id: string) {
  const user = requireUser();
  const event = eventsStore().find((e) => e.id === id);
  if (!event) throw notFound('Evento');
  if (event.ownerId !== user.id && !isAdmin(user)) throw forbidden('Só quem organiza o evento pode alterá-lo.');
  return { event, user };
}

const byNewest = (a: DbEvent, b: DbEvent) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'pt-BR');

export const handlers = [
  http.get(
    url('/events/:slug'),
    handle(({ params }) => {
      const slug = param(params, 'slug');
      const event = eventsStore().find((e) => e.slug === slug || e.id === slug);
      if (!event || !db().tournaments.some((t) => t.eventId === event.id && isPublicTournament(t.status))) throw notFound('Evento');
      return json(toEventDetail(event, isPublicTournament));
    }),
  ),
  http.get(
    url('/organizer/events'),
    handle(() => {
      const user = requireRole(...ORGANIZER_ROLES);
      return json(
        [...eventsStore()]
          .filter((e) => e.ownerId === user.id)
          .sort(byNewest)
          .map((e) => toEvent(e)),
      );
    }),
  ),
  http.get(
    url('/organizer/events/:id'),
    handle(({ params }) => json(toEventDetail(manageableEvent(param(params, 'id')).event))),
  ),
  http.post(
    url('/organizer/events'),
    handle(async ({ request }) => {
      const user = requireRole(...ORGANIZER_ROLES);
      const input = await body(request, EventInput);
      const now = nowIso();
      const event: DbEvent = {
        id: uid('ev'),
        slug: uniqueEventSlug(input.name),
        name: input.name,
        description: input.description ?? '',
        bannerUrl: input.bannerUrl ?? null,
        ownerId: user.id,
        participationRule: input.participationRule ?? 'MULTIPLE',
        createdAt: now,
        updatedAt: now,
      };
      eventsStore().push(event);
      save();
      audit(user, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: event.id, entityLabel: event.name, after: { name: event.name, regra: event.participationRule } });
      return json(toEvent(event), 201);
    }),
  ),
  http.patch(
    url('/organizer/events/:id'),
    handle(async ({ params, request }) => {
      const { event, user } = manageableEvent(param(params, 'id'));
      const input = await body(request, EventPatch);
      if (input.participationRule === 'SINGLE' && event.participationRule !== 'SINGLE') {
        const clash = playersInSeveralTournaments(event.id);
        if (clash > 0) {
          const who = clash === 1 ? '1 jogador já está' : `${clash} jogadores já estão`;
          throw conflict(`${who} em mais de um campeonato deste evento. Para valer "um só campeonato por jogador", essas inscrições precisam ser resolvidas antes.`, 'EVENT_RULE_CONFLICT');
        }
      }
      const before = { name: event.name, regra: event.participationRule };
      Object.assign(event, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.participationRule !== undefined ? { participationRule: input.participationRule } : {}),
        ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
        updatedAt: nowIso(),
      });
      save();
      audit(user, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: event.id, entityLabel: event.name, before, after: { name: event.name, regra: event.participationRule } });
      return json(toEvent(event));
    }),
  ),
  http.delete(
    url('/organizer/events/:id'),
    handle(({ params }) => {
      const { event, user } = manageableEvent(param(params, 'id'));
      const mine = db().tournaments.filter((t) => t.eventId === event.id);
      if (mine.some((t) => t.status !== 'DRAFT' && t.status !== 'CANCELLED')) {
        throw conflict('Este evento já tem campeonato publicado. Tire os campeonatos do evento ou cancele-os antes de excluir.', 'EVENT_HAS_TOURNAMENTS');
      }
      // Os campeonatos continuam existindo, avulsos.
      for (const t of mine) t.eventId = null;
      const list = eventsStore();
      list.splice(list.indexOf(event), 1);
      save();
      audit(user, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: event.id, entityLabel: event.name, before: { name: event.name }, after: { removido: true } });
      return json({ ok: true });
    }),
  ),
  http.post(
    url('/organizer/events/:id/tournaments'),
    handle(async ({ params, request }) => {
      const { event, user } = manageableEvent(param(params, 'id'));
      const input = await body(request, EventTournamentInput);
      const t = db().tournaments.find((x) => x.id === input.tournamentId || x.slug === input.tournamentId);
      if (!t) throw notFound('Campeonato');
      // Só entra campeonato que a pessoa organiza (dona, co-organizadora ou Admin).
      requireTournamentAccess(t);
      if (t.eventId === event.id) throw conflict('Este campeonato já faz parte do evento.', 'TOURNAMENT_IN_EVENT');
      if (t.eventId) throw conflict('Este campeonato já faz parte de outro evento. Tire-o de lá antes.', 'TOURNAMENT_IN_EVENT');
      assertEventAssignable(user, t, event.id);
      t.eventId = event.id;
      save();
      audit(user, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: event.id, entityLabel: event.name, tournamentId: t.id, after: { campeonatoIncluido: t.name } });
      return json(toEventDetail(event));
    }),
  ),
  http.delete(
    url('/organizer/events/:id/tournaments/:tournamentId'),
    handle(({ params }) => {
      const { event, user } = manageableEvent(param(params, 'id'));
      const t = db().tournaments.find((x) => x.id === param(params, 'tournamentId') && x.eventId === event.id);
      if (!t) throw notFound('Campeonato do evento');
      if (!EVENT_EDITABLE_STATUSES.includes(t.status) && t.status !== 'CANCELLED') throw conflict('O campeonato já começou: ele não sai mais do evento.', 'EVENT_LOCKED');
      t.eventId = null;
      save();
      audit(user, { action: 'EVENT_CHANGED', entityType: 'Event', entityId: event.id, entityLabel: event.name, tournamentId: t.id, after: { campeonatoRetirado: t.name } });
      return json(toEventDetail(event));
    }),
  ),
];
