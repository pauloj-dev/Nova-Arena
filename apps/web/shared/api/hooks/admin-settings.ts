'use client';

/** Configurações do site, recursos liga/desliga e saúde do sistema. */
import { FeatureFlag, PublicSiteSettings, SiteSettings, SystemHealth } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

export function useSiteSettingsAdmin() {
  return useQuery({
    queryKey: keys.admin.settings,
    queryFn: ({ signal }) => api.get('/admin/settings', { schema: SiteSettings, signal }),
  });
}

/** Só o Super Admin salva (PRD §6). */
export function useUpdateSiteSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SiteSettings) => api.put('/admin/settings', input, { schema: SiteSettings }),
    onSuccess: (saved) => {
      qc.setQueryData(keys.admin.settings, saved);
      void qc.invalidateQueries({ queryKey: keys.admin.all });
      void qc.invalidateQueries({ queryKey: keys.site.settings });
    },
  });
}

/** O que o site público precisa das configurações (nome, termos, privacidade, suporte, idade mínima). */
export function usePublicSiteSettings() {
  return useQuery({
    queryKey: keys.site.settings,
    queryFn: ({ signal }) => api.get('/site/settings', { schema: PublicSiteSettings, signal }),
    staleTime: 5 * 60_000,
  });
}

export function useAdminFlags() {
  return useQuery({
    queryKey: keys.admin.flags,
    queryFn: ({ signal }) => api.get('/admin/flags', { schema: z.array(FeatureFlag), signal }),
  });
}

/** Liga ou desliga um recurso. O site reage na hora: a consulta pública das flags é invalidada. */
export function useSetFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => api.put(`/admin/flags/${key}`, { enabled }, { schema: FeatureFlag }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.admin.all });
      void qc.invalidateQueries({ queryKey: keys.site.flags });
    },
  });
}

export const HEALTH_REFRESH_MS = 30_000;

/** Atualiza sozinha a cada 30 s. */
export function useSystemHealth() {
  return useQuery({
    queryKey: keys.admin.health,
    queryFn: ({ signal }) => api.get('/admin/health', { schema: SystemHealth, signal }),
    refetchInterval: HEALTH_REFRESH_MS,
  });
}
