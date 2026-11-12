'use client';

import { Game } from '@nova/schemas';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../client';
import { keys } from '../keys';

const Games = z.array(Game);

/** Jogos do catálogo. `includeInactive` só tem efeito para o Admin. */
export function useGames(opts: { includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: keys.games.list(opts),
    queryFn: ({ signal }) => api.get('/games', { schema: Games, signal, query: { all: opts.includeInactive ? 1 : undefined } }),
    staleTime: 5 * 60_000,
  });
}

export function useGame(slugOrId: string | undefined) {
  return useQuery({
    queryKey: keys.games.detail(slugOrId ?? ''),
    queryFn: ({ signal }) => api.get(`/games/${slugOrId}`, { schema: Game, signal }),
    enabled: Boolean(slugOrId),
    staleTime: 5 * 60_000,
  });
}
