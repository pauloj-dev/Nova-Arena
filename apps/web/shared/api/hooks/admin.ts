'use client';

/**
 * Painel do Administrador: indicadores, usuários, papéis, convites e pedidos de organizador.
 * As demais telas do painel têm hooks em `admin-tournaments`, `admin-audit`, `admin-moderation`,
 * `admin-settings` e `admin-security`.
 */
import {
  AdminMember,
  AdminOrganizer,
  AdminOrganizerRequest,
  AdminRemovalRequest,
  AdminStats,
  AdminUser,
  AdminUserDetail,
  MergeUsersResult,
  numberedPage,
  PasswordResetLink,
  RoleInvite,
  RoleRevokeResult,
  SanctionResult,
  TwoFactorStatus,
  type CreateRoleInviteInput,
  type CreateSanctionInput,
  type OrganizerLimitsInput,
} from '@nova/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const UsersPage = numberedPage(AdminUser);
const OrganizersPage = numberedPage(AdminOrganizer);

/** Qualquer mudança feita pelo painel pode mexer em listas, contadores e na auditoria: invalida tudo o que é do Admin. */
export function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.admin.all });
}

// ── Dashboard ────────────────────────────────────────────────────────
export function useAdminStats(range: { from: string; to: string }) {
  return useQuery({
    queryKey: keys.admin.stats(range),
    queryFn: ({ signal }) => api.get('/admin/stats', { schema: AdminStats, signal, query: range }),
    placeholderData: keepPreviousData,
  });
}

// ── Usuários ─────────────────────────────────────────────────────────
export interface AdminUsersParams {
  q?: string;
  role?: string;
  status?: string;
  page?: number;
}

export function useAdminUsers(params: AdminUsersParams, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.admin.users(params),
    queryFn: ({ signal }) => api.get('/admin/users', { schema: UsersPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: keys.admin.user(id),
    queryFn: ({ signal }) => api.get(`/admin/users/${id}`, { schema: AdminUserDetail, signal }),
  });
}

/** Advertência, suspensão ou banimento. Com `reportId`, a denúncia é fechada junto (ação rápida da moderação). */
export function useSanctionUser() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: CreateSanctionInput }) => api.post(`/admin/users/${userId}/sanctions`, input, { schema: SanctionResult }),
    onSuccess: invalidate,
  });
}

export function useLiftSanction() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ sanctionId, reason }: { sanctionId: string; reason?: string }) => api.delete(`/admin/sanctions/${sanctionId}`, { schema: AdminUserDetail, body: { reason } }),
    onSuccess: invalidate,
  });
}

export function useResetUserPassword() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (userId: string) => api.post(`/admin/users/${userId}/reset-password`, undefined, { schema: PasswordResetLink }),
    onSuccess: invalidate,
  });
}

/** `targetId` é a conta que fica; `sourceUserId` é a duplicada. Irreversível (RN-13). */
export function useMergeUsers() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ targetId, sourceUserId, reason }: { targetId: string; sourceUserId: string; reason: string }) =>
      api.post(`/admin/users/${targetId}/merge`, { sourceUserId, reason }, { schema: MergeUsersResult }),
    onSuccess: invalidate,
  });
}

/** Só o Super Admin: para quem perdeu o autenticador e os códigos de recuperação. */
export function useResetUserTwoFactor() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) => api.post(`/admin/users/${userId}/2fa/reset`, { reason }, { schema: TwoFactorStatus }),
    onSuccess: invalidate,
  });
}

// ── Papéis ───────────────────────────────────────────────────────────
export function useAdmins() {
  return useQuery({
    queryKey: keys.admin.admins,
    queryFn: ({ signal }) => api.get('/admin/admins', { schema: z.array(AdminMember), signal }),
  });
}

export function useGrantRole() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, role, reason }: { userId: string; role: 'ADMIN' | 'ORGANIZER'; reason?: string }) =>
      api.post(`/admin/users/${userId}/roles`, { role, reason: reason || undefined }, { schema: AdminUserDetail }),
    onSuccess: invalidate,
  });
}

/**
 * Revoga o papel. Para Admin mais antigo, a resposta vem com `outcome: 'PENDING_APPROVAL'` (RN-11);
 * para organizador, traz os campeonatos afetados (RN-09).
 */
export function useRevokeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role, reason }: { userId: string; role: 'ADMIN' | 'ORGANIZER'; reason?: string }) =>
      api.delete(`/admin/users/${userId}/roles/${role}`, { schema: RoleRevokeResult, body: { reason: reason || undefined } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.all });
      void qc.invalidateQueries({ queryKey: keys.tournaments.all });
    },
  });
}

const removalRequestsKey = [...keys.admin.admins, 'removal-requests'] as const;

export function useAdminRemovalRequests() {
  return useQuery({
    queryKey: removalRequestsKey,
    queryFn: ({ signal }) => api.get('/admin/admin-removal-requests', { schema: z.array(AdminRemovalRequest), signal }),
  });
}

export function useReviewAdminRemoval() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: 'approve' | 'reject' }) =>
      api.post(`/admin/admin-removal-requests/${requestId}/${decision}`, undefined, { schema: AdminRemovalRequest }),
    onSuccess: invalidate,
  });
}

// ── Convites ─────────────────────────────────────────────────────────
export function useRoleInvites() {
  return useQuery({
    queryKey: keys.admin.invites,
    queryFn: ({ signal }) => api.get('/admin/invites', { schema: z.array(RoleInvite), signal }),
  });
}

/** A resposta traz o `link` completo — é a única vez em que ele aparece. */
export function useCreateRoleInvite() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (input: CreateRoleInviteInput) => api.post('/admin/invites', input, { schema: RoleInvite }),
    onSuccess: invalidate,
  });
}

export function useRevokeRoleInvite() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: (inviteId: string) => api.delete(`/admin/invites/${inviteId}`, { schema: RoleInvite }),
    onSuccess: invalidate,
  });
}

// ── Organizadores ────────────────────────────────────────────────────
export function useAdminOrganizers(params: { q?: string; page?: number }) {
  return useQuery({
    queryKey: keys.admin.organizers(params),
    queryFn: ({ signal }) => api.get('/admin/organizers', { schema: OrganizersPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateOrganizerLimits() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: OrganizerLimitsInput }) => api.patch(`/admin/users/${userId}/organizer-limits`, input, { schema: AdminOrganizer }),
    onSuccess: invalidate,
  });
}

export function useAdminOrganizerRequests(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
  return useQuery({
    queryKey: keys.admin.organizerRequests({ status }),
    queryFn: ({ signal }) => api.get('/admin/organizer-requests', { schema: z.array(AdminOrganizerRequest), signal, query: { status } }),
  });
}

export function useReviewOrganizerRequest() {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ requestId, action, reason }: { requestId: string; action: 'approve' | 'reject'; reason?: string }) =>
      api.patch(`/admin/organizer-requests/${requestId}`, { action, reason: reason || undefined }, { schema: AdminOrganizerRequest }),
    onSuccess: invalidate,
  });
}
