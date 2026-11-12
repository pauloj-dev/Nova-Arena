'use client';

/** Moderação: fila de denúncias e disputas escaladas para a administração. */
import { AdminReport, Dispute, numberedPage } from '@nova/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const ReportsPage = numberedPage(AdminReport);

export interface AdminReportsParams {
  status?: string;
  /** Denúncias em que este usuário responde pelo alvo (perfil do usuário no painel). */
  targetUserId?: string;
  page?: number;
}

export function useAdminReports(params: AdminReportsParams) {
  return useQuery({
    queryKey: keys.admin.reports(params),
    queryFn: ({ signal }) => api.get('/admin/reports', { schema: ReportsPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
  });
}

/** Muda o status da denúncia. Para fechar (tratada ou improcedente), a explicação é obrigatória. */
export function useHandleReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reportId, status, resolution }: { reportId: string; status: 'IN_REVIEW' | 'ACTIONED' | 'DISMISSED' | 'OPEN'; resolution?: string }) =>
      api.patch(`/admin/reports/${reportId}`, { status, resolution: resolution || undefined }, { schema: AdminReport }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.all });
      void qc.invalidateQueries({ queryKey: keys.reports.mine });
    },
  });
}

/** Disputas que os organizadores escalaram. A decisão acontece na tela da disputa (`/disputas/[id]`). */
export function useEscalatedDisputes() {
  return useQuery({
    queryKey: keys.admin.reports({ disputes: 'ESCALATED' }),
    queryFn: ({ signal }) => api.get('/admin/disputes', { schema: z.array(Dispute), signal, query: { status: 'ESCALATED' } }),
  });
}
