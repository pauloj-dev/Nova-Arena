'use client';

/** Ranking de temporada (rating ELO) e ligas semanais — issue #120. */
import { League, LeagueDetail, Ok, Season, SeasonRanking, SubjectRatings, type LeagueInput, type LeaguePatch, type RatingKind, type SeasonInput, type SeasonPatch } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const Seasons = z.array(Season);
const Leagues = z.array(League);

// ── Temporadas e rating ──
export function useSeasons(game?: string) {
  return useQuery({
    queryKey: keys.seasons.list(game),
    queryFn: ({ signal }) => api.get('/seasons', { schema: Seasons, signal, query: { game } }),
  });
}

export function useSeasonRanking(slug: string | undefined, params: { season?: string; kind: RatingKind }) {
  return useQuery({
    queryKey: keys.seasons.ranking(slug ?? '', params),
    queryFn: ({ signal }) => api.get(`/games/${slug}/season-ranking`, { schema: SeasonRanking, signal, query: { season: params.season, kind: params.kind } }),
    enabled: Boolean(slug),
  });
}

export function useUserRating(nickname: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.seasons.userRating(nickname ?? ''),
    queryFn: ({ signal }) => api.get(`/users/${encodeURIComponent(nickname ?? '')}/rating`, { schema: SubjectRatings, signal }),
    enabled: Boolean(nickname) && (opts.enabled ?? true),
  });
}

export function useTeamRating(teamId: string | undefined, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.seasons.teamRating(teamId ?? ''),
    queryFn: ({ signal }) => api.get(`/teams/${teamId}/rating`, { schema: SubjectRatings, signal }),
    enabled: Boolean(teamId) && (opts.enabled ?? true),
  });
}

export function useCreateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SeasonInput) => api.post('/admin/seasons', input, { schema: Season }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.seasons.all }),
  });
}

export function useUpdateSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: SeasonPatch & { id: string }) => api.patch(`/admin/seasons/${id}`, input, { schema: Season }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.seasons.all }),
  });
}

export function useDeleteSeason() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/seasons/${id}`, { schema: Ok }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.seasons.all }),
  });
}

// ── Ligas ──
export function useLeagues(game?: string) {
  return useQuery({
    queryKey: keys.leagues.list(game),
    queryFn: ({ signal }) => api.get('/leagues', { schema: Leagues, signal, query: { game } }),
  });
}

export function useLeague(slug: string | undefined) {
  return useQuery({
    queryKey: keys.leagues.detail(slug ?? ''),
    queryFn: ({ signal }) => api.get(`/leagues/${slug}`, { schema: LeagueDetail, signal }),
    enabled: Boolean(slug),
  });
}

export function useMyLeagues() {
  return useQuery({
    queryKey: keys.leagues.mine,
    queryFn: ({ signal }) => api.get('/organizer/leagues', { schema: Leagues, signal }),
  });
}

function useInvalidateLeagues() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.leagues.all });
}

export function useCreateLeague() {
  const invalidate = useInvalidateLeagues();
  return useMutation({
    mutationFn: (input: LeagueInput) => api.post('/organizer/leagues', input, { schema: League }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateLeague(id: string) {
  const invalidate = useInvalidateLeagues();
  return useMutation({
    mutationFn: (input: LeaguePatch) => api.patch(`/organizer/leagues/${id}`, input, { schema: League }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteLeague() {
  const invalidate = useInvalidateLeagues();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/organizer/leagues/${id}`, { schema: Ok }),
    onSuccess: () => invalidate(),
  });
}

export function useAddLeagueTournament(id: string) {
  const invalidate = useInvalidateLeagues();
  return useMutation({
    mutationFn: (tournamentId: string) => api.post(`/organizer/leagues/${id}/tournaments`, { tournamentId }, { schema: League }),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveLeagueTournament(id: string) {
  const invalidate = useInvalidateLeagues();
  return useMutation({
    mutationFn: (tournamentId: string) => api.delete(`/organizer/leagues/${id}/tournaments/${tournamentId}`, { schema: League }),
    onSuccess: () => invalidate(),
  });
}
