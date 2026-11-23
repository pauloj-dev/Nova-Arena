/** Cliente do Ably (issue #97) com um SDK falso: estado da conexão, entrega por canal, token com a partida e reconexão. */
import type { RealtimeEvent } from '@nova/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AblyRealtimeClient, type AblyChannelLike, type AblyLike, type AblyMessageLike, type TokenFetcher } from './ably-client';

class FakeAbly implements AblyLike {
  private readonly stateListeners: ((change: { current: string }) => void)[] = [];
  readonly subscribed = new Map<string, Set<(m: AblyMessageLike) => void>>();
  readonly authorizations: unknown[] = [];
  /** Canais que o token atual permite (o falso recusa a assinatura dos outros, como o Ably). */
  allowed = new Set<string>(['tournament:t1', 'user:u1']);
  closed = false;

  constructor(private readonly fetchToken: TokenFetcher) {}

  connection = { state: 'connecting', on: (listener: (change: { current: string }) => void) => void this.stateListeners.push(listener) };

  channels = {
    get: (name: string): AblyChannelLike => ({
      subscribe: async (listener: (m: AblyMessageLike) => void) => {
        if (!this.allowed.has(name)) throw new Error('sem permissão para o canal');
        const set = this.subscribed.get(name) ?? new Set();
        set.add(listener);
        this.subscribed.set(name, set);
      },
      unsubscribe: (listener?: (m: AblyMessageLike) => void) => {
        if (listener) this.subscribed.get(name)?.delete(listener);
      },
      detach: async () => undefined,
    }),
    release: (name: string) => void this.subscribed.delete(name),
  };

  auth = {
    authorize: async () => {
      const token = await this.fetchToken();
      this.authorizations.push(token);
      return token;
    },
  };

  close() {
    this.closed = true;
  }

  go(state: string) {
    this.connection.state = state;
    this.stateListeners.forEach((l) => l({ current: state }));
  }

  emit(channel: string, data: unknown) {
    this.subscribed.get(channel)?.forEach((l) => l({ data }));
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const TOKEN = { keyName: 'app.key', capability: '{}', timestamp: 1, nonce: 'n', mac: 'm' };

describe('AblyRealtimeClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let fake: FakeAbly;
  const make = () =>
    new AblyRealtimeClient(async (fetchToken) => {
      fake = new FakeAbly(fetchToken);
      return fake;
    });

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_MOCK', 'none');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json(TOKEN));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('estado da conexão: conectando → conectado → caiu (polling) → reconectado', async () => {
    const client = make();
    const seen: string[] = [];
    client.onStatusChange((s) => seen.push(s));
    await flush();
    expect(client.getStatus()).toBe('connecting');
    fake.go('connected');
    fake.go('disconnected');
    fake.go('connecting');
    fake.go('connected');
    fake.go('suspended');
    expect(seen).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
  });

  it('Ably fora desde o início (token recusado a cada tentativa): fica em "caiu" e o polling não recomeça (CT-10)', async () => {
    const client = make();
    const seen: string[] = [];
    client.onStatusChange((s) => seen.push(s));
    await flush();
    fake.go('disconnected');
    fake.go('connecting');
    fake.go('disconnected');
    fake.go('connecting');
    expect(client.getStatus()).toBe('disconnected');
    expect(seen).toEqual(['disconnected']);
  });

  it('entrega só os eventos do contrato, só para quem assinou o canal; sair do canal para de entregar', async () => {
    const client = make();
    const got: RealtimeEvent[] = [];
    const sub = client.subscribe('tournament:t1', (e) => got.push(e));
    await flush();
    fake.emit('tournament:t1', { type: 'standings.updated', stageId: 's1' });
    fake.emit('tournament:t1', { type: 'nao.existe' });
    fake.emit('tournament:t2', { type: 'standings.updated', stageId: 's2' });
    expect(got).toEqual([{ type: 'standings.updated', stageId: 's1' }]);
    sub.unsubscribe();
    await flush();
    fake.emit('tournament:t1', { type: 'standings.updated', stageId: 's1' });
    expect(got).toHaveLength(1);
  });

  it('canal de partida: pede um token que inclua a partida antes de assinar', async () => {
    const client = make();
    await flush();
    fake.allowed.add('match:m1');
    const got: RealtimeEvent[] = [];
    client.subscribe('match:m1', (e) => got.push(e));
    await flush();
    await flush();
    expect(fake.authorizations).toHaveLength(1);
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe('/api/v1/realtime/token');
    expect(JSON.parse(init.body as string)).toEqual({ channels: ['match:m1'] });
    fake.emit('match:m1', { type: 'lobby.revealed', matchId: 'm1' });
    expect(got).toEqual([{ type: 'lobby.revealed', matchId: 'm1' }]);
  });

  it('canal sem permissão (ex.: user de outra pessoa): a assinatura é recusada sem quebrar a tela', async () => {
    const client = make();
    const got: RealtimeEvent[] = [];
    client.subscribe('user:u2', (e) => got.push(e));
    await flush();
    fake.emit('user:u2', { type: 'session.revoked', reason: 'BANNED' });
    expect(got).toEqual([]);
  });

  it('sessão mudou: pede outro token; fechar encerra a conexão', async () => {
    const client = make();
    await flush();
    client.refreshAuth();
    await flush();
    expect(fake.authorizations).toHaveLength(1);
    client.close();
    await flush();
    expect(fake.closed).toBe(true);
  });

  it('SDK não carregou (rede bloqueando o Ably): fica em "caiu" e a tela vai para o polling (CT-10)', async () => {
    const client = new AblyRealtimeClient(async () => {
      throw new Error('bloqueado');
    });
    await flush();
    expect(client.getStatus()).toBe('disconnected');
  });
});
