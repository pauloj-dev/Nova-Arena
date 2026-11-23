'use client';

import { SubmitResultResponse } from '@nova/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/api/client';
import { keys } from '@/shared/api/keys';
import { defaultStore, discard, enqueue, flushQueue, onQueueChange, retry, type FlushReport, type PendingResult, type ResultStore } from './queue';

/** Envia um item da fila: a mesma rota e a mesma chave de idempotência do lançamento normal. */
export function sendPending(item: PendingResult): Promise<SubmitResultResponse> {
  return api.put(`/matches/${item.matchId}/result`, item.payload, { schema: SubmitResultResponse, headers: { 'Idempotency-Key': item.idempotencyKey } });
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export interface PendingResultsOptions {
  /** Só os itens deste campeonato. */
  tournamentId?: string;
  store?: ResultStore;
  send?: (item: PendingResult) => Promise<unknown>;
  /** Avisado depois de cada rodada de envio da fila (para o toast). */
  onFlushed?: (report: FlushReport) => void;
}

/**
 * Fila de resultados guardados neste aparelho. Envia sozinha quando a conexão volta (evento `online`) e ao montar,
 * se houver rede. Depois de enviar, atualiza as mesmas consultas que o lançamento normal atualiza.
 */
export function usePendingResults({ tournamentId, store = defaultStore(), send = sendPending, onFlushed }: PendingResultsOptions = {}) {
  const qc = useQueryClient();
  const [items, setItems] = useState<PendingResult[]>([]);
  const [flushing, setFlushing] = useState(false);
  // Callbacks da tela mudam a cada render: guardados em ref para não reenviar a fila a cada render.
  const callbacks = useRef({ send, onFlushed });
  useEffect(() => {
    callbacks.current = { send, onFlushed };
  });

  const flush = useCallback(async () => {
    if (!isOnline()) return null;
    setFlushing(true);
    try {
      const report = await flushQueue(store, (item) => callbacks.current.send(item));
      for (const item of report.sent) {
        void qc.invalidateQueries({ queryKey: keys.stages.bracket(item.stageId) });
        void qc.invalidateQueries({ queryKey: keys.stages.standings(item.stageId) });
        void qc.invalidateQueries({ queryKey: keys.stages.preview(item.stageId) });
        void qc.invalidateQueries({ queryKey: ['tournaments', 'matches', item.tournamentId] });
        void qc.invalidateQueries({ queryKey: ['match'] });
      }
      if (report.sent.length + report.conflicts.length + report.errors.length > 0) callbacks.current.onFlushed?.(report);
      return report;
    } catch {
      return null;
    } finally {
      setFlushing(false);
    }
  }, [store, qc]);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      store
        .list()
        .then((all) => alive && setItems(all.filter((i) => !tournamentId || i.tournamentId === tournamentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))))
        .catch(() => alive && setItems([]));
    void refresh();
    const off = onQueueChange(() => void refresh());
    const online = () => void flush();
    window.addEventListener('online', online);
    // Abriu a tela com rede e com algo guardado de antes: tenta enviar já.
    const initial = isOnline() ? setTimeout(() => void flush(), 0) : undefined;
    return () => {
      alive = false;
      clearTimeout(initial);
      off();
      window.removeEventListener('online', online);
    };
  }, [store, tournamentId, flush]);

  return {
    items,
    flushing,
    flush,
    enqueue: (item: Parameters<typeof enqueue>[1]) => enqueue(store, item),
    discard: (key: string) => discard(store, key),
    retry: async (key: string) => {
      await retry(store, key);
      await flush();
    },
  };
}
