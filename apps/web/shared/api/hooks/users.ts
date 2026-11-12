'use client';

import {
  AcceptRoleInviteResponse,
  FollowList,
  ForgotPasswordResponse,
  Me,
  Ok,
  OrganizerRequest,
  PublicUser,
  RegisterResponse,
  ResendVerificationResponse,
  RoleInvitePreview,
  type FollowTargetType,
  type RegisterInput,
  type UpdateMeInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';
import { useSession } from '../../session/useSession';

const OrganizerRequestOrNull = OrganizerRequest.nullable();
const EMPTY_FOLLOWS: FollowList = { tournaments: [], games: [] };

// ── Cadastro, verificação de e-mail e senha ──────────────────────────

/** Cria a conta e já deixa a pessoa logada. No protótipo a resposta traz `devVerifyToken`. */
export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api.post('/auth/register', input, { schema: RegisterResponse }),
    onSuccess: ({ user }) => {
      // Mudou a sessão: o que estava em cache pode ser de outra pessoa.
      qc.clear();
      qc.setQueryData(keys.me, user);
    },
  });
}

/** Confirma o e-mail a partir do token do link. Vale mesmo sem estar logado. */
export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post('/auth/verify-email', { token }, { schema: Me }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => api.post('/auth/resend-verification', undefined, { schema: ResendVerificationResponse }),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => api.post('/auth/forgot-password', { email }, { schema: ForgotPasswordResponse }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; password: string }) => api.post('/auth/reset-password', input, { schema: Ok }),
  });
}

// ── Minha conta ──────────────────────────────────────────────────────

/** Atualiza os dados do perfil. Apelido duplicado volta como `ApiError` 409 com `fieldErrors.nickname`. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.patch('/me', input, { schema: Me }),
    onSuccess: (me) => {
      qc.setQueryData(keys.me, me);
      // O perfil público mostra o mesmo apelido, avatar e bio.
      void qc.invalidateQueries({ queryKey: keys.users.profile(me.nickname.toLowerCase()) });
    },
  });
}

/** Salva o ID/nick de um jogo. Erros por campo voltam com a chave `fields.<key>`. */
export function useUpsertGameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gameId, fields }: { gameId: string; fields: Record<string, string> }) => api.put(`/me/game-accounts/${gameId}`, { fields }, { schema: Me }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

export function useDeleteGameAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: string) => api.delete(`/me/game-accounts/${gameId}`, { schema: Me }),
    onSuccess: (me) => qc.setQueryData(keys.me, me),
  });
}

/** Pedido mais recente para virar organizador, ou `null` se nunca pediu. Só consulta com a pessoa logada. */
export function useOrganizerRequest() {
  const { isAuthenticated } = useSession();
  return useQuery({
    queryKey: keys.organizerRequest,
    queryFn: ({ signal }) => api.get('/me/organizer-request', { schema: OrganizerRequestOrNull, signal }),
    enabled: isAuthenticated,
  });
}

export function useCreateOrganizerRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (justification: string) => api.post('/me/organizer-request', { justification }, { schema: OrganizerRequest }),
    onSuccess: (request) => qc.setQueryData(keys.organizerRequest, request),
  });
}

// ── Perfil público ───────────────────────────────────────────────────

/** Perfil público por apelido (sem e-mail e sem IDs de jogo). 404 vira `ApiError` com `status === 404`. */
export function usePublicProfile(nickname: string | undefined) {
  return useQuery({
    queryKey: keys.users.profile((nickname ?? '').toLowerCase()),
    queryFn: ({ signal }) => api.get(`/users/${encodeURIComponent(nickname ?? '')}`, { schema: PublicUser, signal }),
    enabled: Boolean(nickname),
  });
}

// ── Seguir campeonato ou jogo (RN-15) ────────────────────────────────

/** O que a pessoa segue. Visitante não consulta a API: recebe listas vazias. */
export function useFollows() {
  const { isAuthenticated } = useSession();
  const query = useQuery({
    queryKey: keys.follows,
    queryFn: ({ signal }) => api.get('/me/follows', { schema: FollowList, signal }),
    enabled: isAuthenticated,
  });
  const follows = (isAuthenticated ? query.data : undefined) ?? EMPTY_FOLLOWS;
  return {
    follows,
    isLoading: isAuthenticated && query.isPending,
    isError: query.isError,
    isFollowing: (type: FollowTargetType, id: string) => (type === 'game' ? follows.games : follows.tournaments).includes(id),
  };
}

export interface ToggleFollowInput {
  type: FollowTargetType;
  /** Id do campeonato ou do jogo (não o slug). */
  id: string;
  /** `true` = seguir; `false` = deixar de seguir. */
  follow: boolean;
}

/** Segue ou deixa de seguir, com atualização otimista da lista. Exige login (401 para visitante). */
export function useToggleFollow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, follow }: ToggleFollowInput) =>
      follow ? api.put(`/me/follows/${type}/${id}`, undefined, { schema: FollowList }) : api.delete(`/me/follows/${type}/${id}`, { schema: FollowList }),
    onMutate: async ({ type, id, follow }) => {
      await qc.cancelQueries({ queryKey: keys.follows });
      const previous = qc.getQueryData<FollowList>(keys.follows);
      const base = previous ?? EMPTY_FOLLOWS;
      const field = type === 'game' ? 'games' : 'tournaments';
      const without = base[field].filter((x) => x !== id);
      qc.setQueryData<FollowList>(keys.follows, { ...base, [field]: follow ? [...without, id] : without });
      return { previous };
    },
    onError: (_error, _input, context) => {
      qc.setQueryData(keys.follows, context?.previous);
    },
    onSuccess: (list) => qc.setQueryData(keys.follows, list),
  });
}

// ── Convite de Admin/Organizador (PRD §7.3) ──────────────────────────

/** Prévia do convite (papel, quem convidou, validade e estado). Convite inexistente = `ApiError` 404. */
export function useRoleInvite(token: string | undefined) {
  return useQuery({
    queryKey: keys.roleInvite(token ?? ''),
    queryFn: ({ signal }) => api.get(`/role-invites/${encodeURIComponent(token ?? '')}`, { schema: RoleInvitePreview, signal }),
    enabled: Boolean(token),
  });
}

/** Aceita o convite. Exige login e e-mail verificado; convite inválido volta 410 e não concede nada. */
export function useAcceptRoleInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post(`/role-invites/${encodeURIComponent(token)}/accept`, undefined, { schema: AcceptRoleInviteResponse }),
    onSuccess: ({ user }, token) => {
      qc.setQueryData(keys.me, user);
      void qc.invalidateQueries({ queryKey: keys.roleInvite(token) });
    },
  });
}
