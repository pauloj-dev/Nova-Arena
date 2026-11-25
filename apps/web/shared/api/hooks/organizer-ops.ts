'use client';

/**
 * Hooks da operação do campeonato pelo organizador (F2.3): equipe do evento, comunicados,
 * pausar/retomar/arquivar e troca da pontuação de uma fase. Os de chave, partidas e resultados
 * ficam em `competition.ts`.
 */
import {
  AcceptStaffInviteResponse,
  Announcement,
  MyStaffTournament,
  OrganizerTournamentDetail,
  StaffInvitePreview,
  Standings,
  TournamentStaff,
  TournamentStaffInvite,
  type AnnouncementInput,
  type CreateStaffInviteInput,
  type PauseTournamentInput,
  type ResumeTournamentInput,
  type StaffInput,
  type StaffRole,
  type StageScoringInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';
import { organizerTournamentKey } from './organizer';

const StaffList = z.array(TournamentStaff);
const StaffInviteList = z.array(TournamentStaffInvite);
const MyStaffTournaments = z.array(MyStaffTournament);

// ── Equipe do evento ─────────────────────────────────────────────────
export function useTournamentStaff(tournamentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.tournaments.staff(tournamentId ?? ''),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/staff`, { schema: StaffList, signal }),
    enabled: Boolean(tournamentId) && enabled,
  });
}

/** Adiciona alguém à equipe pelo apelido. Só o responsável pelo campeonato (ou o Admin). */
export function useAddStaff(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StaffInput) => api.post(`/tournaments/${tournamentId}/staff`, input, { schema: TournamentStaff }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.staff(tournamentId) }),
  });
}

export function useUpdateStaff(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: StaffRole }) => api.patch(`/tournaments/${tournamentId}/staff/${userId}`, { role }, { schema: TournamentStaff }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.staff(tournamentId) }),
  });
}

export function useRemoveStaff(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<void>(`/tournaments/${tournamentId}/staff/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.staff(tournamentId) }),
  });
}

// ── Convite por link para a equipe ───────────────────────────────────
/** Links do campeonato (ativos e antigos). Só o responsável (ou o Admin) vê. */
export function useStaffInvites(tournamentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.tournaments.staffInvites(tournamentId ?? ''),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/staff-invites`, { schema: StaffInviteList, signal }),
    enabled: Boolean(tournamentId) && enabled,
  });
}

/** Cria o link. O link completo só vem nesta resposta (o servidor guarda o hash do token). */
export function useCreateStaffInvite(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInviteInput) => api.post(`/tournaments/${tournamentId}/staff-invites`, input, { schema: TournamentStaffInvite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.staffInvites(tournamentId) }),
  });
}

export function useRevokeStaffInvite(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/tournaments/${tournamentId}/staff-invites/${inviteId}`, { schema: TournamentStaffInvite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.staffInvites(tournamentId) }),
  });
}

/** Prévia pública do link (antes do login). */
export function useStaffInvite(token: string | undefined) {
  return useQuery({
    queryKey: keys.staffInvite(token ?? ''),
    queryFn: ({ signal }) => api.get(`/staff-invites/${encodeURIComponent(token ?? '')}`, { schema: StaffInvitePreview, signal }),
    enabled: Boolean(token),
  });
}

/** Entra na equipe pelo link. Convite inválido volta 410 e não muda nada. */
export function useAcceptStaffInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post(`/staff-invites/${encodeURIComponent(token)}/accept`, undefined, { schema: AcceptStaffInviteResponse }),
    onSuccess: (res, token) => {
      void qc.invalidateQueries({ queryKey: keys.staffInvite(token) });
      void qc.invalidateQueries({ queryKey: keys.tournaments.staffOf });
      void qc.invalidateQueries({ queryKey: keys.tournaments.access(res.tournamentId) });
      void qc.invalidateQueries({ queryKey: keys.tournaments.access(res.slug) });
    },
  });
}

/** Campeonatos em que faço parte da equipe (inclusive sem o papel de organizador). */
export function useMyStaffTournaments(enabled = true) {
  return useQuery({
    queryKey: keys.tournaments.staffOf,
    queryFn: ({ signal }) => api.get('/me/staff-tournaments', { schema: MyStaffTournaments, signal }),
    enabled,
  });
}

// ── Comunicados ──────────────────────────────────────────────────────
/** Envia um comunicado para todos os inscritos, uma fase ou um grupo. */
export function useCreateAnnouncement(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AnnouncementInput) => api.post(`/tournaments/${tournamentId}/announcements`, input, { schema: Announcement }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.announcements(tournamentId) }),
  });
}

export function useDeleteAnnouncement(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (announcementId: string) => api.delete<void>(`/announcements/${announcementId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.announcements(tournamentId) }),
  });
}

// ── Pausar, retomar e arquivar ───────────────────────────────────────
function useOperation<TInput extends { id: string }>(path: (input: TInput) => string, bodyOf?: (input: TInput) => unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => api.post(path(input), bodyOf?.(input), { schema: OrganizerTournamentDetail }),
    onSuccess: (t) => {
      qc.setQueryData(organizerTournamentKey(t.id), t);
      return qc.invalidateQueries({ queryKey: keys.tournaments.all });
    },
  });
}

/** Pausa o campeonato em andamento. O motivo é obrigatório e vai para os inscritos. */
export function usePauseTournament() {
  return useOperation<{ id: string } & PauseTournamentInput>(({ id }) => `/tournaments/${id}/pause`, ({ reason }) => ({ reason }));
}
export function useResumeTournament() {
  return useOperation<{ id: string } & ResumeTournamentInput>(({ id }) => `/tournaments/${id}/resume`, ({ reason }) => ({ reason }));
}
/** Arquiva um campeonato finalizado: sai da vitrine e fica só para consulta. */
export function useArchiveTournament() {
  return useOperation<{ id: string }>(({ id }) => `/tournaments/${id}/archive`);
}

// ── Pontuação da fase ────────────────────────────────────────────────
/** Troca o modelo de pontuação da fase. Em fase em andamento, a tabela inteira é recalculada (RN-02). */
export function useChangeStageScoring(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StageScoringInput) => api.patch(`/stages/${stageId}/scoring`, input, { schema: Standings }),
    onSuccess: (standings) => {
      qc.setQueryData(keys.stages.standings(stageId), standings);
      void qc.invalidateQueries({ queryKey: keys.stages.bracket(stageId) });
      void qc.invalidateQueries({ queryKey: ['match'] });
      return qc.invalidateQueries({ queryKey: keys.tournaments.all });
    },
  });
}
