import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { classifyFailure, conflictMessage, discard, enqueue, flushQueue, isNetworkError, memoryStore, onQueueChange, retry, type PendingResult } from './queue';

const base = (n: number) => ({
  idempotencyKey: `chave-${n}`,
  matchId: `fase~m${n}`,
  tournamentId: 't1',
  stageId: 'fase',
  label: `Partida ${n}`,
  payload: { entries: [{ registrationId: 'r1', score: 2 }, { registrationId: 'r2', score: 1 }], evidenceUrls: [] },
});

const apiError = (status: number, code?: string) => new ApiError({ type: 'about:blank', title: code === 'CORRECTION_REASON_REQUIRED' ? 'Informe o motivo da correção.' : 'Erro', status, code });

describe('fila de resultados offline', () => {
  it('guarda e envia na ordem em que foi lançado, com a mesma chave de idempotência', async () => {
    const store = memoryStore();
    await enqueue(store, base(1), new Date('2026-11-21T10:00:00Z'));
    await enqueue(store, base(2), new Date('2026-11-21T10:05:00Z'));
    const sent: string[] = [];
    const report = await flushQueue(store, async (item) => void sent.push(`${item.matchId}:${item.idempotencyKey}`));
    expect(sent).toEqual(['fase~m1:chave-1', 'fase~m2:chave-2']);
    expect(report.sent).toHaveLength(2);
    expect(await store.list()).toEqual([]);
  });

  it('resultado já lançado por outra pessoa vira conflito e fica para a organização decidir', async () => {
    const store = memoryStore();
    await enqueue(store, base(1));
    const report = await flushQueue(store, async () => {
      throw apiError(400, 'CORRECTION_REASON_REQUIRED');
    });
    expect(report.conflicts).toHaveLength(1);
    const [item] = await store.list();
    expect(item).toMatchObject({ status: 'CONFLICT', error: conflictMessage(), attempts: 1 });
    // Conflito não é reenviado sozinho.
    const send = vi.fn();
    await flushQueue(store, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('sem rede: para a fila e mantém tudo pendente', async () => {
    const store = memoryStore();
    await enqueue(store, base(1), new Date('2026-11-21T10:00:00Z'));
    await enqueue(store, base(2), new Date('2026-11-21T10:01:00Z'));
    const send = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const report = await flushQueue(store, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(report.kept).toBe(2);
    expect((await store.list()).every((i: PendingResult) => i.status === 'PENDING')).toBe(true);
  });

  it('erro do servidor (5xx) mantém pendente; regra recusada (4xx) vira erro com a mensagem', async () => {
    const store = memoryStore();
    await enqueue(store, base(1), new Date('2026-11-21T10:00:00Z'));
    await enqueue(store, base(2), new Date('2026-11-21T10:01:00Z'));
    const report = await flushQueue(store, async (item) => {
      throw item.matchId.endsWith('m1') ? apiError(503) : new ApiError({ type: 'about:blank', title: 'O campeonato está pausado.', status: 409, code: 'TOURNAMENT_PAUSED' });
    });
    expect(report.kept).toBe(1);
    expect(report.errors).toHaveLength(1);
    const byMatch = Object.fromEntries((await store.list()).map((i) => [i.matchId, i]));
    expect(byMatch['fase~m1']?.status).toBe('PENDING');
    expect(byMatch['fase~m2']).toMatchObject({ status: 'ERROR', error: 'O campeonato está pausado.' });

    await retry(store, 'chave-2');
    expect((await store.list()).find((i) => i.idempotencyKey === 'chave-2')?.status).toBe('PENDING');
  });

  it('avisa as telas a cada mudança e descarta', async () => {
    const store = memoryStore();
    const listener = vi.fn();
    const off = onQueueChange(listener);
    await enqueue(store, base(1));
    await discard(store, 'chave-1');
    off();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await store.list()).toEqual([]);
  });

  it('pedidos ao mesmo tempo compartilham um único envio da fila', async () => {
    const store = memoryStore();
    await enqueue(store, base(1));
    const send = vi.fn(async () => undefined);
    await Promise.all([flushQueue(store, send), flushQueue(store, send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('classifica as falhas', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(apiError(500))).toBe(false);
    expect(classifyFailure(new TypeError('x'))).toMatchObject({ status: 'PENDING', stop: true });
    expect(classifyFailure(apiError(429))).toMatchObject({ status: 'PENDING', stop: false });
  });
});
