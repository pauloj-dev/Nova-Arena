'use client';

/** LGPD (issue #115): exportar os dados pessoais e excluir a conta. */
import { DataExportJob, DataExportResponse, DeletionCheck, Me, type DeleteAccountInput, type PersonalDataExport } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

export function useDeletionCheck(enabled = true) {
  return useQuery({ queryKey: keys.privacy.deletion, queryFn: ({ signal }) => api.get('/me/deletion', { schema: DeletionCheck, signal }), enabled });
}

export function useDataExports() {
  return useQuery({ queryKey: keys.privacy.exports, queryFn: ({ signal }) => api.get('/me/exports', { schema: z.array(DataExportJob), signal }) });
}

/** Salva o arquivo no aparelho (download pelo navegador). */
export function downloadJson(data: PersonalDataExport, filename = `nova-arena-meus-dados-${data.generatedAt.slice(0, 10)}.json`): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Pede a exportação. Arquivo na hora → baixa; conta grande → o job avisa quando ficar pronto. */
export function useRequestExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/me/export', undefined, { schema: DataExportResponse }),
    onSuccess: (result) => {
      if ('format' in result) downloadJson(result);
      else void qc.invalidateQueries({ queryKey: keys.privacy.exports });
    },
  });
}

/** Exclui a conta. Depois disso não há sessão: o cache inteiro é descartado. */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteAccountInput) => api.delete<void>('/me', { body: input }),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData<Me | null>(keys.me, null);
    },
  });
}
