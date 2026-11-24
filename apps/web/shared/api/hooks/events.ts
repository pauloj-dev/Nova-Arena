'use client';

/** Eventos que agrupam campeonatos, com a regra de participação (ADR-0005). */
import { Event, EventDetail, Ok, type EventInput, type EventPatch } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const Events = z.array(Event);

/** Página pública do evento (só os campeonatos publicados). */
export function useEvent(slug: string | undefined) {
  return useQuery({
    queryKey: keys.events.detail(slug ?? ''),
    queryFn: ({ signal }) => api.get(`/events/${slug}`, { schema: EventDetail, signal }),
    enabled: Boolean(slug),
  });
}

/** Meus eventos (área do organizador). */
export function useMyEvents(enabled = true) {
  return useQuery({
    queryKey: keys.events.mine,
    queryFn: ({ signal }) => api.get('/organizer/events', { schema: Events, signal }),
    enabled,
  });
}

/** Evento para quem organiza (com os rascunhos). */
export function useManagedEvent(id: string | undefined) {
  return useQuery({
    queryKey: keys.events.manage(id ?? ''),
    queryFn: ({ signal }) => api.get(`/organizer/events/${id}`, { schema: EventDetail, signal }),
    enabled: Boolean(id),
  });
}

/** Evento muda também a página dos campeonatos dele (o selo do evento e o aviso da regra). */
function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.events.all }), qc.invalidateQueries({ queryKey: keys.tournaments.all })]);
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (input: EventInput) => api.post('/organizer/events', input, { schema: Event }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateEvent(id: string) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (input: EventPatch) => api.patch(`/organizer/events/${id}`, input, { schema: Event }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/organizer/events/${id}`, { schema: Ok }),
    onSuccess: () => invalidate(),
  });
}

export function useAddEventTournament(id: string) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (tournamentId: string) => api.post(`/organizer/events/${id}/tournaments`, { tournamentId }, { schema: EventDetail }),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveEventTournament(id: string) {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (tournamentId: string) => api.delete(`/organizer/events/${id}/tournaments/${tournamentId}`, { schema: EventDetail }),
    onSuccess: () => invalidate(),
  });
}
