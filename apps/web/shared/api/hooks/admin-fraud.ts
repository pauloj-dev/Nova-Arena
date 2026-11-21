'use client';

/** Antifraude (issue #114): fila de alertas na moderação. */
import { FraudAlert, FraudAlertPage, type ReviewFraudAlertInput } from '@nova/schemas';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

export interface FraudAlertsParams {
  status?: string;
  kind?: string;
  page?: number;
}

export function useFraudAlerts(params: FraudAlertsParams) {
  return useQuery({
    queryKey: keys.admin.fraudAlerts(params),
    queryFn: ({ signal }) => api.get('/admin/fraud-alerts', { schema: FraudAlertPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
  });
}

export function useReviewFraudAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertId, ...input }: ReviewFraudAlertInput & { alertId: string }) => api.patch(`/admin/fraud-alerts/${alertId}`, input, { schema: FraudAlert }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'fraud-alerts'] }),
  });
}
