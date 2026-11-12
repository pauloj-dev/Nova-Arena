'use client';

/** Hook do perfil competitivo (F2.7). */
import { CompetitiveStats } from '@nova/schemas';
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

/** Estatísticas por jogo, conquistas e histórico de campeonatos de um jogador (dados públicos). */
export function useCompetitiveStats(nickname: string | undefined) {
  return useQuery({
    queryKey: keys.users.stats((nickname ?? '').toLowerCase()),
    queryFn: ({ signal }) => api.get(`/users/${encodeURIComponent(nickname ?? '')}/stats`, { schema: CompetitiveStats, signal }),
    enabled: Boolean(nickname),
  });
}
