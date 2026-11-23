/**
 * Resultados offline (issue 125): o lançamento de queda BR e de duelo continua sem rede. O envio fica guardado
 * neste aparelho (IndexedDB) e vai sozinho quando a conexão volta, com a **mesma** chave de idempotência do
 * formulário — se a primeira tentativa chegou ao servidor e só a resposta se perdeu, o servidor devolve o resultado
 * já gravado em vez de lançar de novo.
 *
 * Funções puras + um armazenamento trocável (IndexedDB no navegador, memória nos testes e onde não houver IndexedDB).
 */
import type { SubmitResultInput } from '@nova/schemas';
import { ApiError } from '@/shared/api/client';
import { getT } from '@/shared/i18n/core';
import { messages } from '../../messages';

export type PendingStatus = 'PENDING' | 'SENDING' | 'CONFLICT' | 'ERROR';

export interface PendingResult {
  /** A própria chave de idempotência (uma por envio). */
  idempotencyKey: string;
  matchId: string;
  tournamentId: string;
  stageId: string;
  /** Nome da partida para a lista ("Fase · Grupo · Queda 2"). */
  label: string;
  payload: SubmitResultInput;
  createdAt: string;
  status: PendingStatus;
  error: string | null;
  attempts: number;
}

export interface ResultStore {
  list(): Promise<PendingResult[]>;
  put(item: PendingResult): Promise<void>;
  remove(key: string): Promise<void>;
}

export function memoryStore(): ResultStore {
  const items = new Map<string, PendingResult>();
  return {
    list: async () => [...items.values()].map((i) => structuredClone(i)),
    put: async (item) => void items.set(item.idempotencyKey, structuredClone(item)),
    remove: async (key) => void items.delete(key),
  };
}

const DB_NAME = 'nova-arena-offline';
const STORE = 'pending-results';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Falha no IndexedDB'));
  });
}

/** IndexedDB do navegador (sobrevive a recarregar a página e a fechar o navegador). */
export function indexedDbStore(factory: IDBFactory): ResultStore {
  let opening: Promise<IDBDatabase> | null = null;
  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'idempotencyKey' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error ?? new Error('Falha ao abrir o IndexedDB'));
      };
    });
    return opening;
  };
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    list: async () => request((await tx('readonly')).getAll() as IDBRequest<PendingResult[]>),
    put: async (item) => void (await request((await tx('readwrite')).put(item))),
    remove: async (key) => void (await request((await tx('readwrite')).delete(key))),
  };
}

let shared: ResultStore | null = null;

/** O armazenamento deste navegador (IndexedDB quando existe; senão, memória). */
export function defaultStore(): ResultStore {
  shared ??= typeof indexedDB !== 'undefined' ? indexedDbStore(indexedDB) : memoryStore();
  return shared;
}

/** Só para testes: troca o armazenamento compartilhado. */
export function setDefaultStore(store: ResultStore | null): void {
  shared = store;
}

// ── Avisos para as telas ──────────────────────────────────────────
const listeners = new Set<() => void>();
export function onQueueChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function changed(): void {
  listeners.forEach((l) => l());
}

export async function enqueue(store: ResultStore, item: Omit<PendingResult, 'createdAt' | 'status' | 'error' | 'attempts'>, now = new Date()): Promise<PendingResult> {
  const record: PendingResult = { ...item, createdAt: now.toISOString(), status: 'PENDING', error: null, attempts: 0 };
  await store.put(record);
  changed();
  return record;
}

export async function discard(store: ResultStore, key: string): Promise<void> {
  await store.remove(key);
  changed();
}

/** Devolve para a fila um item com erro (ex.: depois de a pessoa retomar o campeonato pausado). */
export async function retry(store: ResultStore, key: string): Promise<void> {
  const item = (await store.list()).find((i) => i.idempotencyKey === key);
  if (!item) return;
  await store.put({ ...item, status: 'PENDING', error: null });
  changed();
}

/** Falha de rede (o `fetch` nem chegou ao servidor): o envio continua na fila. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'NetworkError');
}

/** Aviso de conflito: outra pessoa lançou o resultado antes de a conexão voltar. */
export function conflictMessage(): string {
  return getT(messages, 'queue')('conflito');
}

/** O que fazer com o item depois de uma tentativa que falhou. */
export function classifyFailure(error: unknown): { status: PendingStatus; message: string | null; stop: boolean } {
  if (error instanceof ApiError) {
    // Resultado já lançado e este envio não é correção: alguém lançou antes de a conexão voltar.
    if (error.code === 'CORRECTION_REASON_REQUIRED') return { status: 'CONFLICT', message: conflictMessage(), stop: false };
    if (error.status >= 500 || error.status === 429) return { status: 'PENDING', message: getT(messages, 'queue')('servidorSemResposta'), stop: false };
    return { status: 'ERROR', message: error.message, stop: false };
  }
  // Sem rede: para a fila (as próximas também falhariam) e espera a conexão voltar.
  return { status: 'PENDING', message: null, stop: true };
}

export interface FlushReport {
  sent: PendingResult[];
  conflicts: PendingResult[];
  errors: PendingResult[];
  kept: number;
}

let flushing: Promise<FlushReport> | null = null;

/**
 * Envia a fila, um por vez, na ordem em que foi guardada. Só um envio da fila por vez nesta aba (várias telas
 * podem pedir ao mesmo tempo). Itens em conflito ou com erro ficam para a pessoa decidir.
 */
export function flushQueue(store: ResultStore, send: (item: PendingResult) => Promise<unknown>): Promise<FlushReport> {
  flushing ??= (async () => {
    const report: FlushReport = { sent: [], conflicts: [], errors: [], kept: 0 };
    const items = (await store.list()).filter((i) => i.status === 'PENDING' || i.status === 'SENDING').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let stopped = false;
    for (const item of items) {
      if (stopped) {
        report.kept += 1;
        continue;
      }
      await store.put({ ...item, status: 'SENDING', attempts: item.attempts + 1 });
      changed();
      try {
        await send(item);
        await store.remove(item.idempotencyKey);
        report.sent.push(item);
      } catch (error) {
        const outcome = classifyFailure(error);
        const next = { ...item, status: outcome.status, error: outcome.message, attempts: item.attempts + 1 };
        await store.put(next);
        if (outcome.status === 'CONFLICT') report.conflicts.push(next);
        else if (outcome.status === 'ERROR') report.errors.push(next);
        else report.kept += 1;
        stopped = outcome.stop;
      }
      changed();
    }
    return report;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
