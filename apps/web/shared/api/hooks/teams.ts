'use client';

import {
  InviteCandidate,
  Team,
  TeamInvite,
  TeamInvitePreview,
  type TeamInput,
  type TeamInviteInput,
  type TeamUpdateInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const Teams = z.array(Team);
const TeamInvites = z.array(TeamInvite);
const InviteCandidates = z.array(InviteCandidate);

/**
 * Depois de qualquer mudança em squad ou convite, tudo de `teams` é relido (lista, detalhe, convites).
 * Com `registrations`, relê também o que mostra o squad dentro de um campeonato (nome, tag e quem é o capitão
 * aparecem nas inscrições, que ficam sob `keys.tournaments`).
 */
function useInvalidateTeams(opts: { registrations?: boolean } = {}) {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.teams.all }), opts.registrations ? qc.invalidateQueries({ queryKey: keys.tournaments.all }) : undefined]);
}

/** Squads em que sou membro (os que capitaneio vêm primeiro). */
export function useMyTeams(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.teams.mine,
    queryFn: ({ signal }) => api.get('/teams/mine', { schema: Teams, signal }),
    enabled: opts.enabled ?? true,
  });
}

/** Squad com membros. `pendingInvites` só vem preenchido para o capitão. */
export function useTeam(teamId: string | undefined) {
  return useQuery({
    queryKey: keys.teams.detail(teamId ?? ''),
    queryFn: ({ signal }) => api.get(`/teams/${teamId}`, { schema: Team, signal }),
    enabled: Boolean(teamId),
  });
}

export function useCreateTeam() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: TeamInput) => api.post('/teams', input, { schema: Team }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTeam(teamId: string) {
  const invalidate = useInvalidateTeams({ registrations: true });
  return useMutation({
    mutationFn: (input: TeamUpdateInput) => api.patch(`/teams/${teamId}`, input, { schema: Team }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamId: string) => api.delete<void>(`/teams/${teamId}`),
    onSuccess: (_data, teamId) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.teams.mine }),
        qc.invalidateQueries({ queryKey: keys.teams.myInvites }),
        // O detalhe do squad excluído fica só marcado como vencido: reler agora daria 404 na tela que está fechando.
        qc.invalidateQueries({ queryKey: keys.teams.detail(teamId), refetchType: 'none' }),
        // As inscrições antigas do squad continuam no histórico de quem jogou.
        qc.invalidateQueries({ queryKey: keys.tournaments.all }),
      ]),
  });
}

// ── Membros ──────────────────────────────────────────────────────────
/** Marca ou desmarca um membro como reserva (só o capitão). */
export function useUpdateTeamMember(teamId: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: ({ userId, isSub }: { userId: string; isSub: boolean }) => api.patch(`/teams/${teamId}/members/${userId}`, { isSub }, { schema: Team }),
    onSuccess: () => invalidate(),
  });
}

/** O capitão remove um membro; um membro passa o próprio id para sair do squad. */
export function useRemoveTeamMember(teamId: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (userId: string) => api.delete<void>(`/teams/${teamId}/members/${userId}`),
    onSuccess: () => invalidate(),
  });
}

export function useTransferCaptain(teamId: string) {
  const invalidate = useInvalidateTeams({ registrations: true });
  return useMutation({
    mutationFn: (userId: string) => api.post(`/teams/${teamId}/transfer-captain`, { userId }, { schema: Team }),
    onSuccess: () => invalidate(),
  });
}

// ── Convites ─────────────────────────────────────────────────────────
/** Convida por apelido (`kind: 'nickname'`) ou gera um link/código (`kind: 'link'`). Vale 72 h. */
export function useCreateTeamInvite(teamId: string) {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (input: TeamInviteInput) => api.post(`/teams/${teamId}/invites`, input, { schema: TeamInvite }),
    onSuccess: () => invalidate(),
  });
}

export function useRevokeTeamInvite() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete<void>(`/team-invites/${inviteId}`),
    onSuccess: () => invalidate(),
  });
}

/** Prévia pública do convite pelo código de 6 caracteres. */
export function useTeamInvitePreview(code: string | undefined) {
  return useQuery({
    queryKey: keys.teams.invite(code ?? ''),
    queryFn: ({ signal }) => api.get(`/team-invites/${encodeURIComponent(code ?? '')}`, { schema: TeamInvitePreview, signal }),
    enabled: Boolean(code),
  });
}

/** Convites pendentes feitos para o meu apelido. */
export function useMyTeamInvites(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.teams.myInvites,
    queryFn: ({ signal }) => api.get('/me/team-invites', { schema: TeamInvites, signal }),
    enabled: opts.enabled ?? true,
  });
}

export function useAcceptTeamInvite() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (code: string) => api.post(`/team-invites/${encodeURIComponent(code)}/accept`, undefined, { schema: Team }),
    onSuccess: () => invalidate(),
  });
}

export function useDeclineTeamInvite() {
  const invalidate = useInvalidateTeams();
  return useMutation({
    mutationFn: (code: string) => api.post<void>(`/team-invites/${encodeURIComponent(code)}/decline`),
    onSuccess: () => invalidate(),
  });
}

// ── Busca de jogador ─────────────────────────────────────────────────
/** Busca por apelido para convidar. Só consulta a partir de 2 caracteres; devolve até 8 jogadores. */
export function useUserSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: keys.users.search(term.toLowerCase()),
    queryFn: ({ signal }) => api.get('/user-search', { schema: InviteCandidates, signal, query: { q: term } }),
    enabled: term.length >= 2,
    staleTime: 60_000,
  });
}
