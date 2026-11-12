'use client';

import { Announcement, page, Registration, Tournament, TournamentSummary, type TournamentListQuery } from '@nova/schemas';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const TournamentPage = page(TournamentSummary);
const Registrations = z.array(Registration);
const Announcements = z.array(Announcement);

export type TournamentFilters = Partial<Omit<TournamentListQuery, 'cursor' | 'limit'>>;

/** Lista com rolagem infinita (20 por página). */
export function useTournamentList(filters: TournamentFilters, limit = 20) {
  return useInfiniteQuery({
    queryKey: keys.tournaments.list({ ...filters, limit }),
    queryFn: ({ pageParam, signal }) => api.get('/tournaments', { schema: TournamentPage, signal, query: { ...filters, limit, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Uma página só (vitrines da home). */
export function useTournaments(filters: TournamentFilters, limit = 8) {
  return useQuery({
    queryKey: keys.tournaments.list({ ...filters, limit, single: true }),
    queryFn: ({ signal }) => api.get('/tournaments', { schema: TournamentPage, signal, query: { ...filters, limit } }),
  });
}

export function useTournament(slugOrId: string | undefined) {
  return useQuery({
    queryKey: keys.tournaments.detail(slugOrId ?? ''),
    queryFn: ({ signal }) => api.get(`/tournaments/${slugOrId}`, { schema: Tournament, signal }),
    enabled: Boolean(slugOrId),
  });
}

/** `scope: 'all'` inclui lista de espera, recusados etc. — só para a organização. */
export function useTournamentRegistrations(tournamentId: string | undefined, scope: 'public' | 'all' = 'public') {
  return useQuery({
    queryKey: keys.tournaments.registrations(tournamentId ?? '', { scope }),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/registrations`, { schema: Registrations, signal, query: { scope: scope === 'all' ? 'all' : undefined } }),
    enabled: Boolean(tournamentId),
  });
}

export function useTournamentAnnouncements(tournamentId: string | undefined) {
  return useQuery({
    queryKey: keys.tournaments.announcements(tournamentId ?? ''),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/announcements`, { schema: Announcements, signal }),
    enabled: Boolean(tournamentId),
  });
}
