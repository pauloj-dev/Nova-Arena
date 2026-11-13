'use client';

/** Auditoria: consulta do Admin, logs de um campeonato (para o organizador) e exportação em CSV. */
import { AuditLog, AuditMeta, numberedPage } from '@nova/schemas';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { API_BASE, ApiError, api } from '../client';
import { keys } from '../keys';

const AuditPage = numberedPage(AuditLog);

export interface AuditFilters {
  /** Apelido (trecho) ou ID de quem fez. */
  actor?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  tournamentId?: string;
  /** Datas no formato `AAAA-MM-DD` (dia inteiro, UTC) ou ISO completo. */
  from?: string;
  to?: string;
}

export function useAuditLogs(params: AuditFilters & { page?: number }, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.admin.audit(params),
    queryFn: ({ signal }) => api.get('/admin/audit-logs', { schema: AuditPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** Opções dos filtros (ações e tipos de recurso). */
export function useAuditMeta() {
  return useQuery({
    queryKey: keys.admin.audit({ meta: true }),
    queryFn: ({ signal }) => api.get('/admin/audit-logs/meta', { schema: AuditMeta, signal }),
    staleTime: 5 * 60_000,
  });
}

/**
 * Logs de um campeonato. Dono, co-organizador e Admin podem consultar (PRD §6, nota 2).
 * Feito para a aba de auditoria da área do organizador, junto com `<AuditTimeline />`.
 */
export function useTournamentAuditLogs(tournamentId: string | undefined, params: { page?: number; action?: string } = {}) {
  return useQuery({
    queryKey: [...keys.tournaments.detail(tournamentId ?? ''), 'audit-logs', params] as const,
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/audit-logs`, { schema: AuditPage, signal, query: { ...params } }),
    placeholderData: keepPreviousData,
    enabled: Boolean(tournamentId),
  });
}

/** Baixa o CSV com os mesmos filtros da tela (UTF-8 com BOM e `;`, para abrir certo no Excel em pt-BR). */
export async function downloadAuditCsv(filters: AuditFilters): Promise<{ blob: Blob; filename: string }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/admin/audit-logs.csv${qs ? `?${qs}` : ''}`, { credentials: 'same-origin', headers: { Accept: 'text/csv' } });
  if (!res.ok) {
    throw new ApiError({ type: 'about:blank', title: res.status === 403 ? 'Você não tem permissão para exportar a auditoria.' : 'Não foi possível exportar a auditoria. Tente de novo.', status: res.status });
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'auditoria.csv';
  return { blob: await res.blob(), filename };
}

export function useExportAuditCsv() {
  return useMutation({ mutationFn: downloadAuditCsv });
}
