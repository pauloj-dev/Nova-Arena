import type { RealtimeChannel, RealtimeEvent } from '@nova/schemas';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Subscription {
  unsubscribe: () => void;
}

/**
 * Interface de tempo real independente do fornecedor (plano F2.10).
 * No protótipo é implementada por `MockRealtimeClient`; em B2.9 entra a implementação do Ably
 * com esta mesma interface, sem mudar nenhuma tela.
 */
export interface RealtimeClient {
  subscribe(channel: RealtimeChannel, handler: (event: RealtimeEvent) => void): Subscription;
  getStatus(): ConnectionStatus;
  onStatusChange(listener: (status: ConnectionStatus) => void): () => void;
  close(): void;
}

/** Intervalo do polling que assume quando a conexão de tempo real cai (PRD R3, CT-10). */
export const POLLING_INTERVAL_MS = 10_000;
