'use client';

import type { RealtimeChannel, RealtimeEvent } from '@nova/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { keys } from '../api/keys';
import { isModuleMocked } from '../api/mode';
import { useSession } from '../session/useSession';
import { AblyRealtimeClient } from './ably-client';
import { POLLING_INTERVAL_MS, type ConnectionStatus, type RealtimeClient } from './client';
import { MergedRealtimeClient } from './merged-client';
import { MockRealtimeClient } from './mock-client';

const RealtimeContext = createContext<RealtimeClient | null>(null);

declare global {
  interface Window {
    /** Só no protótipo: `window.__novaRealtime.setOnline(false)` simula a queda do tempo real. */
    __novaRealtime?: MockRealtimeClient;
  }
}

let singleton: RealtimeClient | null = null;

/**
 * O cliente certo para o ambiente (`NEXT_PUBLIC_API_MOCK`, módulo `realtime`):
 * - simulado (protótipo): `MockRealtimeClient`, que escuta a API simulada;
 * - real: `AblyRealtimeClient`; enquanto algum módulo ainda é simulado (preview e staging), soma o barramento
 *   do protótipo para os eventos desses módulos continuarem chegando.
 */
function createClient(): RealtimeClient {
  if (isModuleMocked('realtime')) {
    const mock = new MockRealtimeClient();
    window.__novaRealtime = mock;
    return mock;
  }
  const ably = new AblyRealtimeClient();
  if ((process.env.NEXT_PUBLIC_API_MOCK ?? 'all') === 'none') return ably;
  return new MergedRealtimeClient(ably, new MockRealtimeClient());
}

/** Um cliente só para a vida inteira da página (no servidor não existe conexão). */
function getClient(): RealtimeClient | null {
  if (typeof window === 'undefined') return null;
  singleton ??= createClient();
  return singleton;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getClient);
  return (
    <RealtimeContext.Provider value={client}>
      <UserChannel />
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeClient | null {
  return useContext(RealtimeContext);
}

const noop = () => () => {};

export function useRealtimeStatus(): ConnectionStatus {
  const client = useRealtime();
  return useSyncExternalStore(
    client ? (cb) => client.onStatusChange(cb) : noop,
    () => client?.getStatus() ?? 'connecting',
    () => 'connecting',
  );
}

/**
 * Intervalo de atualização para consultas "ao vivo": desligado enquanto o tempo real funciona,
 * 10 s quando a conexão cai (CT-10). Passe para `refetchInterval` do TanStack Query.
 */
export function useLiveRefetchInterval(): number | false {
  return useRealtimeStatus() === 'disconnected' ? POLLING_INTERVAL_MS : false;
}

/** Assina um canal enquanto o componente está montado. O handler pode mudar a cada render. */
export function useChannel(channel: RealtimeChannel | null, handler: (event: RealtimeEvent) => void): void {
  const client = useRealtime();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    if (!client || !channel) return;
    const sub = client.subscribe(channel, (event) => ref.current(event));
    return () => sub.unsubscribe();
  }, [client, channel]);
}

/**
 * Canal público do campeonato: cada evento só diz o que mudou; a tela invalida as consultas
 * e busca os dados na API, que confere a permissão (plano §2.3).
 */
export function useTournamentChannel(tournamentId: string | undefined, onEvent?: (event: RealtimeEvent) => void): void {
  const qc = useQueryClient();
  useChannel(tournamentId ? `tournament:${tournamentId}` : null, (event) => {
    switch (event.type) {
      case 'standings.updated':
        void qc.invalidateQueries({ queryKey: keys.stages.standings(event.stageId) });
        break;
      case 'bracket.updated':
        void qc.invalidateQueries({ queryKey: keys.stages.bracket(event.stageId) });
        void qc.invalidateQueries({ queryKey: ['tournaments', 'matches', tournamentId] });
        break;
      case 'match.updated':
        void qc.invalidateQueries({ queryKey: keys.matches.detail(event.matchId) });
        void qc.invalidateQueries({ queryKey: keys.stages.bracket(event.stageId) });
        void qc.invalidateQueries({ queryKey: ['tournaments', 'matches', tournamentId] });
        break;
      case 'stage.advanced':
        void qc.invalidateQueries({ queryKey: keys.stages.bracket(event.toStageId) });
        void qc.invalidateQueries({ queryKey: keys.stages.standings(event.fromStageId) });
        void qc.invalidateQueries({ queryKey: keys.tournaments.all });
        break;
      case 'announcement.created':
        void qc.invalidateQueries({ queryKey: keys.tournaments.announcements(event.tournamentId) });
        break;
      case 'tournament.updated':
        void qc.invalidateQueries({ queryKey: keys.tournaments.all });
        break;
      default:
        break;
    }
    onEvent?.(event);
  });
}

/** Canal privado do usuário: notificações novas e sessão derrubada. Montado uma vez, no provider. */
function UserChannel() {
  const { user } = useSession();
  const qc = useQueryClient();
  const client = useRealtime();
  const userId = user?.id ?? null;
  const previous = useRef<string | null | undefined>(undefined);
  // Entrou, saiu ou trocou de conta: o token do tempo real passa a ter os canais da pessoa certa.
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== userId) client?.refreshAuth?.();
    previous.current = userId;
  }, [client, userId]);
  useChannel(user ? `user:${user.id}` : null, (event) => {
    if (event.type === 'notification.created') void qc.invalidateQueries({ queryKey: keys.notifications.all });
    if (event.type === 'session.revoked') {
      // Primeiro a sessão vira "visitante" (quem está na tela redesenha na hora); depois sai todo dado da conta.
      qc.setQueryData(keys.me, null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
  });
  return null;
}
