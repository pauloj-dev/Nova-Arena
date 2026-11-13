'use client';

/**
 * Recursos liga/desliga (feature flags) no cliente.
 *
 * `useFlag('ranking')` diz se o recurso está ligado. As flags vêm de `GET /site/flags`, ficam em
 * cache por 5 minutos e são reconsultadas quando a aba volta ao foco. Quando o Super Admin muda
 * uma flag no painel, a consulta é invalidada e o site reage sem novo deploy.
 *
 * Enquanto a primeira resposta não chega (ou se a consulta falhar), vale o padrão de cada flag
 * (`FEATURE_FLAG_DEFAULTS`): o site não pisca nem esconde recurso por causa de rede lenta.
 */
import { FEATURE_FLAG_DEFAULTS, FeatureFlags, type FeatureFlagKey } from '@nova/schemas';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/keys';

export const FLAGS_STALE_MS = 5 * 60_000;

export type FlagMap = Record<FeatureFlagKey, boolean> & Record<string, boolean>;

/** Junta a resposta da API com os padrões. Chave desconhecida (flag nova no servidor) passa adiante. */
export function resolveFlags(remote: Record<string, boolean> | undefined): FlagMap {
  return { ...FEATURE_FLAG_DEFAULTS, ...(remote ?? {}) };
}

/** Todas as flags, já com os padrões aplicados. `isLoading` é verdadeiro só antes da primeira resposta. */
export function useFlags(): { flags: FlagMap; isLoading: boolean } {
  const query = useQuery({
    queryKey: keys.site.flags,
    queryFn: ({ signal }) => api.get('/site/flags', { schema: FeatureFlags, signal }),
    staleTime: FLAGS_STALE_MS,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: true,
  });
  return { flags: resolveFlags(query.data), isLoading: query.isPending };
}

/** O recurso está ligado? Chave fora do catálogo conta como desligada. */
export function useFlag(key: FeatureFlagKey | (string & {})): boolean {
  return useFlags().flags[key] ?? false;
}
