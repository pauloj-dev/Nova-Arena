'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useChannel } from '@/shared/realtime/RealtimeProvider';

/**
 * Mantém as filas de envios e de disputas do campeonato em dia: cada `match.updated`
 * do canal público pode ser um envio novo, uma confirmação, uma contestação ou uma decisão.
 */
export function useLiveResultQueues(tournamentId: string | undefined): void {
  const qc = useQueryClient();
  useChannel(tournamentId ? `tournament:${tournamentId}` : null, (event) => {
    if (event.type !== 'match.updated') return;
    void qc.invalidateQueries({ queryKey: ['submissions'] });
    void qc.invalidateQueries({ queryKey: ['disputes'] });
  });
}
