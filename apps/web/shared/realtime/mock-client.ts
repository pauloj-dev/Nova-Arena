import type { RealtimeChannel, RealtimeEvent } from '@nova/schemas';
import { subscribeBus } from '@/mocks/bus';
import type { ConnectionStatus, RealtimeClient, Subscription } from './client';

/**
 * Tempo real simulado: escuta os eventos que a API simulada publica.
 * `setOnline(false)` simula a queda da conexão (para o protótipo e para o CT-10):
 * os eventos param de chegar e as telas passam a atualizar por polling.
 */
export class MockRealtimeClient implements RealtimeClient {
  private status: ConnectionStatus = 'connecting';
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly handlers = new Map<RealtimeChannel, Set<(event: RealtimeEvent) => void>>();
  private readonly stopBus: () => void;

  constructor() {
    this.stopBus = subscribeBus(({ channel, event }) => {
      if (this.status !== 'connected') return;
      this.handlers.get(channel)?.forEach((handler) => handler(event));
    });
    // Conecta depois da montagem, como uma conexão de verdade.
    setTimeout(() => this.setStatus('connected'), 0);
  }

  subscribe(channel: RealtimeChannel, handler: (event: RealtimeEvent) => void): Subscription {
    const set = this.handlers.get(channel) ?? new Set();
    set.add(handler);
    this.handlers.set(channel, set);
    return {
      unsubscribe: () => {
        set.delete(handler);
        if (set.size === 0) this.handlers.delete(channel);
      },
    };
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Só no protótipo: derruba ou restabelece a conexão. */
  setOnline(online: boolean): void {
    this.setStatus(online ? 'connected' : 'disconnected');
  }

  close(): void {
    this.stopBus();
    this.handlers.clear();
    this.statusListeners.clear();
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
