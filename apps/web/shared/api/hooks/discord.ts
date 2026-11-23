'use client';

/** Hooks do bot do Discord (issue 121): vínculo de um campeonato com um servidor, na operação do organizador. */
import { DiscordInteractionResponse, DiscordLinkCode, DiscordLinkStatus, DiscordQueued } from '@nova/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { keys } from '../keys';

const base = (tournamentId: string) => `/tournaments/${encodeURIComponent(tournamentId)}/discord`;

export function useDiscordLink(tournamentId: string) {
  return useQuery({
    queryKey: keys.discord.link(tournamentId),
    queryFn: ({ signal }) => api.get(base(tournamentId), { schema: DiscordLinkStatus, signal }),
  });
}

export function useCreateDiscordCode(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`${base(tournamentId)}/code`, undefined, { schema: DiscordLinkCode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.discord.link(tournamentId) }),
  });
}

export function useUnlinkDiscord(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(base(tournamentId), { schema: DiscordLinkStatus }),
    onSuccess: (status) => qc.setQueryData(keys.discord.link(tournamentId), status),
  });
}

export function useTestDiscord(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`${base(tournamentId)}/test`, undefined, { schema: DiscordQueued }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.discord.link(tournamentId) }),
  });
}

/**
 * Só no protótipo (módulo `discord` simulado): faz o papel do Discord e manda `/nova-arena vincular` como se a pessoa
 * logada tivesse digitado o comando num canal de um servidor de demonstração. Na API real a rota exige a assinatura
 * do Discord.
 */
export function useSimulateDiscordLink(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api.post(
        '/discord/interactions',
        {
          id: `sim-${Date.now()}`,
          type: 2,
          guild_id: '100000000000000001',
          channel_id: '100000000000000002',
          guild: { id: '100000000000000001', name: 'Servidor de demonstração' },
          member: { user: { id: 'prototipo', username: 'prototipo' }, permissions: '32' },
          data: { name: 'nova-arena', options: [{ type: 1, name: 'vincular', options: [{ type: 3, name: 'codigo', value: code }] }] },
        },
        { schema: DiscordInteractionResponse },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.discord.link(tournamentId) }),
  });
}
