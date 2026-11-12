'use client';

/** Hooks de denúncias (F2.9): enviar e acompanhar as minhas. */
import { Report, type CreateReportInput } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const Reports = z.array(Report);

/** As minhas denúncias, com o status e a resposta da moderação. */
export function useMyReports(enabled = true) {
  return useQuery({
    queryKey: keys.reports.mine,
    queryFn: ({ signal }) => api.get('/me/reports', { schema: Reports, signal }),
    enabled,
  });
}

/** Envia uma denúncia. Exige login (401), não aceita denunciar a si mesmo (400) e limita repetições (409). */
export function useCreateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReportInput) => api.post('/reports', input, { schema: Report }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.reports.mine }),
  });
}
