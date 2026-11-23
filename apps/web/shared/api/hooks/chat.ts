'use client';

/**
 * Hooks do chat por partida (issue 125). A lista vem da API; o canal de tempo real `match:{id}` só avisa que mudou
 * (`chat.updated`). Sem tempo real, a lista atualiza a cada 10 s.
 */
import { MatchChat, MatchChatMessage, type MatchChatInput } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useChannel, useLiveRefetchInterval } from '../../realtime/RealtimeProvider';
import { api } from '../client';
import { keys } from '../keys';

const path = (matchId: string) => `/matches/${encodeURIComponent(matchId)}/chat`;

export function useMatchChat(matchId: string, opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const enabled = opts.enabled ?? true;
  const refetchInterval = useLiveRefetchInterval();
  useChannel(enabled ? `match:${matchId}` : null, (event) => {
    if (event.type === 'chat.updated' && event.matchId === matchId) void qc.invalidateQueries({ queryKey: keys.chat.match(matchId) });
  });
  return useQuery({
    queryKey: keys.chat.match(matchId),
    queryFn: ({ signal }) => api.get(path(matchId), { schema: MatchChat, signal }),
    enabled,
    refetchInterval,
    // 403 (não é da partida) não melhora tentando de novo.
    retry: false,
  });
}

export function useSendChatMessage(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MatchChatInput) => api.post(path(matchId), input, { schema: MatchChatMessage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chat.match(matchId) }),
  });
}

export function useHideChatMessage(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.delete(`${path(matchId)}/${encodeURIComponent(messageId)}`, { schema: MatchChatMessage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.chat.match(matchId) }),
  });
}
