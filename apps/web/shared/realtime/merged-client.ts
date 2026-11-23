import type { RealtimeChannel, RealtimeEvent } from '@nova/schemas';
import type { ConnectionStatus, RealtimeClient, Subscription } from './client';

/**
 * Transição módulo a módulo (preview e staging): o Ably traz os eventos da API real e o barramento do protótipo
 * traz os dos módulos que ainda são simulados. O estado da conexão é o do Ably (é ele que cai de verdade).
 */
export class MergedRealtimeClient implements RealtimeClient {
  constructor(
    private readonly primary: RealtimeClient,
    private readonly secondary: RealtimeClient,
  ) {}

  subscribe(channel: RealtimeChannel, handler: (event: RealtimeEvent) => void): Subscription {
    const a = this.primary.subscribe(channel, handler);
    const b = this.secondary.subscribe(channel, handler);
    return {
      unsubscribe: () => {
        a.unsubscribe();
        b.unsubscribe();
      },
    };
  }

  getStatus(): ConnectionStatus {
    return this.primary.getStatus();
  }

  onStatusChange(listener: (status: ConnectionStatus) => void): () => void {
    return this.primary.onStatusChange(listener);
  }

  refreshAuth(): void {
    this.primary.refreshAuth?.();
  }

  close(): void {
    this.primary.close();
    this.secondary.close();
  }
}
