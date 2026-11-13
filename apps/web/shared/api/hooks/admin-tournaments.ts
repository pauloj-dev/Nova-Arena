'use client';

/** Painel do Administrador: visão global dos campeonatos, comunicados globais e aviso no topo do site. */
import { AdminTournament, Bracket, GlobalAnnouncement, LockedStage, numberedPage, SiteBannerItem, type GlobalAnnouncementInput } from '@nova/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const TournamentsPage = numberedPage(AdminTournament);

export interface AdminTournamentsParams {
  q?: string;
  status?: string;
  /** Só a fila "Sem responsável" (RN-09). */
  orphan?: boolean;
  page?: number;
}

function useInvalidateTournaments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.admin.all });
    // O site público também muda (destaque na home, status, organizador).
    void qc.invalidateQueries({ queryKey: keys.tournaments.all });
  };
}

export function useAdminTournaments(params: AdminTournamentsParams) {
  return useQuery({
    queryKey: keys.admin.tournaments(params),
    queryFn: ({ signal }) => api.get('/admin/tournaments', { schema: TournamentsPage, signal, query: { ...params, orphan: params.orphan ? true : undefined } }),
    placeholderData: keepPreviousData,
  });
}

export function useFeatureTournament() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationFn: ({ tournamentId, featured }: { tournamentId: string; featured: boolean }) => api.patch(`/admin/tournaments/${tournamentId}`, { featured }, { schema: AdminTournament }),
    onSuccess: invalidate,
  });
}

export function useChangeTournamentOwner() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationFn: ({ tournamentId, ownerId, reason }: { tournamentId: string; ownerId: string; reason: string }) =>
      api.post(`/admin/tournaments/${tournamentId}/owner`, { ownerId, reason }, { schema: AdminTournament }),
    onSuccess: invalidate,
  });
}

export function useAdminCancelTournament() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationFn: ({ tournamentId, reason }: { tournamentId: string; reason: string }) => api.post(`/admin/tournaments/${tournamentId}/cancel`, { reason }, { schema: AdminTournament }),
    onSuccess: invalidate,
  });
}

export function useAdminArchiveTournament() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationFn: (tournamentId: string) => api.post(`/admin/tournaments/${tournamentId}/archive`, undefined, { schema: AdminTournament }),
    onSuccess: invalidate,
  });
}

const lockedStagesKey = (tournamentId: string) => [...keys.admin.tournaments({ lockedStagesOf: tournamentId })] as const;

/** Fases com a chave travada (já têm partida concluída). */
export function useLockedStages(tournamentId: string | null) {
  return useQuery({
    queryKey: lockedStagesKey(tournamentId ?? ''),
    queryFn: ({ signal }) => api.get(`/admin/tournaments/${tournamentId}/locked-stages`, { schema: z.array(LockedStage), signal }),
    enabled: Boolean(tournamentId),
  });
}

/** Só o Admin destrava (RN-07). O endpoint é do módulo de competição. */
export function useUnlockStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stageId, reason }: { stageId: string; reason: string }) => api.post(`/stages/${stageId}/unlock`, { reason }, { schema: Bracket }),
    onSuccess: (_bracket, { stageId }) => {
      void qc.invalidateQueries({ queryKey: keys.admin.all });
      void qc.invalidateQueries({ queryKey: keys.stages.bracket(stageId) });
    },
  });
}

// ── Comunicados globais ──────────────────────────────────────────────
function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: keys.admin.all });
    void qc.invalidateQueries({ queryKey: keys.site.banner });
    void qc.invalidateQueries({ queryKey: keys.notifications.all });
  };
}

export function useGlobalAnnouncements() {
  return useQuery({
    queryKey: keys.admin.announcements,
    queryFn: ({ signal }) => api.get('/admin/announcements', { schema: z.array(GlobalAnnouncement), signal }),
  });
}

export function useCreateGlobalAnnouncement() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: (input: GlobalAnnouncementInput) => api.post('/admin/announcements', input, { schema: GlobalAnnouncement }),
    onSuccess: invalidate,
  });
}

export function useToggleGlobalAnnouncement() {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/admin/announcements/${id}`, { active }, { schema: GlobalAnnouncement }),
    onSuccess: invalidate,
  });
}

/** Banners e avisos de manutenção ativos para quem está vendo o site. Reconsulta a cada minuto. */
export function useSiteBanner() {
  return useQuery({
    queryKey: keys.site.banner,
    queryFn: ({ signal }) => api.get('/site/banner', { schema: z.array(SiteBannerItem), signal }),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
