import { RealtimeEvent, RealtimeTokenRequest, type RealtimeChannel } from '@nova/schemas';
import { api, errorMessage } from '../api/client';
import type { ConnectionStatus, RealtimeClient, Subscription } from './client';

/**
 * Tempo real com o Ably (B2.9, issue #97), na mesma interface `RealtimeClient` do protótipo: nenhuma tela muda.
 *
 * - O token vem de `POST /api/v1/realtime/token` (só os canais permitidos para quem está logado); o SDK renova
 *   sozinho antes de vencer e reconecta sozinho quando a rede volta.
 * - Canal de partida (`match:{id}`) precisa estar no token: ao assinar um novo, o cliente pede um token que o
 *   inclua (`auth.authorize`) e só então assina. Se a pessoa não puder ver a partida, a API descarta o canal e o
 *   Ably recusa a assinatura — a tela continua funcionando pela API.
 * - Queda de conexão (ou Ably bloqueado na rede) → `disconnected` → as telas atualizam a cada 10 s (CT-10).
 * - O SDK do Ably só é baixado quando o tempo real está ligado (import dinâmico).
 */

/** O mínimo do SDK do Ably que este cliente usa (permite testar com um falso). */
export interface AblyMessageLike {
  data?: unknown;
}
export interface AblyChannelLike {
  subscribe(listener: (message: AblyMessageLike) => void): unknown;
  unsubscribe(listener?: (message: AblyMessageLike) => void): void;
  detach(): unknown;
}
export interface AblyLike {
  connection: { state: string; on(listener: (change: { current: string }) => void): void };
  channels: { get(name: string): AblyChannelLike; release(name: string): void };
  auth: { authorize(): Promise<unknown> };
  close(): void;
}
/** Devolve o token request assinado (ou lança). */
export type TokenFetcher = () => Promise<unknown>;
export type AblyFactory = (fetchToken: TokenFetcher) => Promise<AblyLike>;

/** Fábrica padrão: o SDK de verdade, com `authCallback` chamando a nossa API. */
export const defaultAblyFactory: AblyFactory = async (fetchToken) => {
  const { Realtime } = await import('ably');
  const client = new Realtime({
    authCallback: (_params, callback) => {
      fetchToken()
        .then((token) => callback(null, token as RealtimeTokenRequest))
        .catch((error: unknown) => callback(errorMessage(error), null));
    },
    // Reconexão rápida quando a rede volta; a fila de mensagens offline não faz sentido (só assinamos).
    disconnectedRetryTimeout: 5_000,
    queueMessages: false,
    closeOnUnload: true,
  });
  return client as unknown as AblyLike;
};

function statusOf(state: string, everConnected: boolean): ConnectionStatus {
  if (state === 'connected') return 'connected';
  if ((state === 'initialized' || state === 'connecting') && !everConnected) return 'connecting';
  return 'disconnected';
}

export class AblyRealtimeClient implements RealtimeClient {
  private status: ConnectionStatus = 'connecting';
  private everConnected = false;
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly handlers = new Map<RealtimeChannel, Set<(event: RealtimeEvent) => void>>();
  private readonly listeners = new Map<RealtimeChannel, (message: AblyMessageLike) => void>();
  /** Canais de partida que entram no pedido de token. */
  private readonly matchChannels = new Set<RealtimeChannel>();
  private readonly ready: Promise<AblyLike | null>;
  private closed = false;

  constructor(factory: AblyFactory = defaultAblyFactory) {
    this.ready = factory(() => api.post('/realtime/token', { channels: [...this.matchChannels] }, { schema: RealtimeTokenRequest }))
      .then((client) => {
        client.connection.on((change) => this.setStatus(statusOf(change.current, this.everConnected)));
        this.setStatus(statusOf(client.connection.state, false));
        if (this.closed) client.close();
        return client;
      })
      .catch(() => {
        // SDK não carregou (rede bloqueando, por exemplo): fica no polling.
        this.setStatus('disconnected');
        return null;
      });
  }

  subscribe(channel: RealtimeChannel, handler: (event: RealtimeEvent) => void): Subscription {
    const set = this.handlers.get(channel) ?? new Set();
    const first = set.size === 0;
    set.add(handler);
    this.handlers.set(channel, set);
    if (first) void this.attach(channel);
    return {
      unsubscribe: () => {
        set.delete(handler);
        if (set.size > 0 || this.handlers.get(channel) !== set) return;
        this.handlers.delete(channel);
        void this.detach(channel);
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

  /** A sessão mudou (entrou, saiu, trocou de conta): pede um token novo, com os canais da pessoa certa. */
  refreshAuth(): void {
    void this.ready.then((client) => client?.auth.authorize()).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    void this.ready.then((client) => client?.close());
    this.handlers.clear();
    this.statusListeners.clear();
  }

  private async attach(channel: RealtimeChannel): Promise<void> {
    const client = await this.ready;
    // Já assinado (saiu e voltou antes de o canal soltar): o ouvinte existente lê os handlers atuais.
    if (!client || !this.handlers.has(channel) || this.listeners.has(channel)) return;
    if (channel.startsWith('match:') && !this.matchChannels.has(channel)) {
      this.matchChannels.add(channel);
      // Token novo já com a partida; sem permissão, a API a descarta e a assinatura abaixo é recusada.
      await client.auth.authorize().catch(() => undefined);
      if (!this.handlers.has(channel)) return;
    }
    if (this.listeners.has(channel)) return;
    const listener = (message: AblyMessageLike) => {
      const parsed = RealtimeEvent.safeParse(message.data);
      if (!parsed.success) return;
      this.handlers.get(channel)?.forEach((h) => h(parsed.data));
    };
    this.listeners.set(channel, listener);
    try {
      await client.channels.get(channel).subscribe(listener);
    } catch {
      // Sem permissão para o canal: a tela continua pela API (e pelo polling, se a conexão cair).
    }
  }

  private async detach(channel: RealtimeChannel): Promise<void> {
    const client = await this.ready;
    // Voltou a assinar antes de soltar: mantém tudo como está.
    if (!client || this.handlers.has(channel)) return;
    const listener = this.listeners.get(channel);
    this.listeners.delete(channel);
    this.matchChannels.delete(channel);
    try {
      const ch = client.channels.get(channel);
      if (listener) ch.unsubscribe(listener);
      await ch.detach();
      client.channels.release(channel);
    } catch {
      // Canal já fora: nada a fazer.
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === 'connected') this.everConnected = true;
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
