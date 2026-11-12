'use client';

import { Game, ScoringModel, type GameAdminInput, type GameAdminPatch, type ScoringModelInput, type ScoringModelPatch } from '@nova/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

/** Toda mudança no catálogo invalida as listas e os detalhes de jogo (inclusive os do site público). */
function useInvalidateGames() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.games.all });
}

export function useCreateGame() {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: (input: GameAdminInput) => api.post('/admin/games', input, { schema: Game }),
    onSuccess: invalidate,
  });
}

/** Edita o jogo. Para ativar ou desativar, mande só `{ active }`. */
export function useUpdateGame() {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: ({ gameId, patch }: { gameId: string; patch: GameAdminPatch }) => api.patch(`/admin/games/${gameId}`, patch, { schema: Game }),
    onSuccess: invalidate,
  });
}

export function useCreateScoringModel(gameId: string) {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: (input: ScoringModelInput) => api.post(`/admin/games/${gameId}/scoring-models`, input, { schema: ScoringModel }),
    onSuccess: invalidate,
  });
}

/** Edita o modelo. Para torná-lo padrão do tipo de partida, mande `{ isDefault: true }`. */
export function useUpdateScoringModel(gameId: string) {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: ({ modelId, patch }: { modelId: string; patch: ScoringModelPatch }) =>
      api.patch(`/admin/games/${gameId}/scoring-models/${modelId}`, patch, { schema: ScoringModel }),
    onSuccess: invalidate,
  });
}

export function useDeleteScoringModel(gameId: string) {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: (modelId: string) => api.delete<void>(`/admin/games/${gameId}/scoring-models/${modelId}`),
    onSuccess: invalidate,
  });
}

export function useDuplicateScoringModel(gameId: string) {
  const invalidate = useInvalidateGames();
  return useMutation({
    mutationFn: (modelId: string) => api.post(`/admin/games/${gameId}/scoring-models/${modelId}/duplicate`, undefined, { schema: ScoringModel }),
    onSuccess: invalidate,
  });
}
