'use client';

import type { ExtraStatField } from '@nova/schemas';
import { useGame } from '@/shared/api/hooks/games';
import { useTournament } from '@/shared/api/hooks/tournaments';

/** Campo de desempate do jogo do campeonato (ex.: pênaltis no eFootball), para empate em mata-mata (RN-14). */
export function useTiebreakField(tournamentId: string | undefined, enabled = true): { field: ExtraStatField | undefined; isLoading: boolean } {
  const tournament = useTournament(enabled ? tournamentId : undefined);
  const game = useGame(tournament.data?.gameId);
  return {
    field: game.data?.extraStatFields.find((f) => f.when === 'tiebreak'),
    isLoading: enabled && (tournament.isLoading || game.isLoading),
  };
}
