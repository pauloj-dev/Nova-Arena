'use client';

import { Button, Card, useToast } from '@nova/ui';
import { AlertTriangle, CloudOff, Eye, Hourglass, Loader2, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from '../../messages';
import type { PendingResult, PendingStatus, ResultStore } from './queue';
import { usePendingResults } from './usePendingResults';

const STATUS: Record<PendingStatus, { icon: typeof Hourglass; className: string }> = {
  PENDING: { icon: Hourglass, className: 'bg-warning-soft text-warning-soft-text' },
  SENDING: { icon: Loader2, className: 'bg-info-soft text-info-soft-text' },
  CONFLICT: { icon: AlertTriangle, className: 'bg-danger-soft text-danger-soft-text' },
  ERROR: { icon: XCircle, className: 'bg-danger-soft text-danger-soft-text' },
};

function PendingPill({ status }: { status: PendingStatus }) {
  const t = useT(messages, 'PendingResultsPanel');
  const s = STATUS[status];
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.className}`} data-testid="pending-status">
      <Icon className={`size-3.5 ${status === 'SENDING' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      {t(`status.${status}`)}
    </span>
  );
}

/** A conexão do navegador (atualiza nos eventos `online`/`offline`). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine !== false,
    () => true,
  );
}

function summary(entries: PendingResult['payload']['entries']): string {
  const t = getT(messages, 'PendingResultsPanel');
  return entries
    .map((e) => (e.absent ? t('ausente') : e.placement !== undefined ? t('colocacaoKills', { placement: String(e.placement), kills: String(e.kills ?? 0) }) : `${e.score ?? '—'}`))
    .join(' · ');
}

export interface PendingResultsPanelProps {
  tournamentId: string;
  /** Abre a partida (para ver o resultado que já foi lançado). */
  onOpenMatch: (matchId: string) => void;
  store?: ResultStore;
  send?: (item: PendingResult) => Promise<unknown>;
}

/**
 * "Resultados pendentes de envio" (issue 125): o que foi lançado sem rede neste aparelho. Vai sozinho quando a
 * conexão volta; conflito (outra pessoa já lançou) e erro ficam para a organização decidir.
 */
export function PendingResultsPanel({ tournamentId, onOpenMatch, store, send }: PendingResultsPanelProps) {
  const { success, error } = useToast();
  const online = useOnline();
  const t = useT(messages, 'PendingResultsPanel');
  const [confirming, setConfirming] = useState<string | null>(null);
  const queue = usePendingResults({
    tournamentId,
    store,
    send,
    onFlushed: (report) => {
      if (report.sent.length > 0) success(t('enviados', { count: report.sent.length }), t('tabelaAtualizada'));
      if (report.conflicts.length > 0) error(t('conflitoTitulo'), t('conflitoDescricao'));
      if (report.errors.length > 0) error(t('naoAceitoTitulo'), t('naoAceitoDescricao'));
    },
  });

  if (queue.items.length === 0) return null;
  const waiting = queue.items.filter((i) => i.status === 'PENDING').length;

  return (
    <Card className="flex flex-col gap-3 border-warning" data-testid="pending-results">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg">
            <CloudOff className="size-5 shrink-0 text-warning-soft-text" aria-hidden />
            {t('titulo')}
          </h2>
          <p className="text-sm text-muted" role="status" aria-live="polite">
            {online
              ? waiting > 0
                ? t('conexaoDeVolta')
                : t('precisamDecisao')
              : t('semConexao')}
          </p>
        </div>
        {waiting > 0 && (
          <Button size="sm" variant="secondary" disabled={!online} loading={queue.flushing} iconLeft={<Send className="size-4" aria-hidden />} onClick={() => void queue.flush()}>
            {t('enviarAgora')}
          </Button>
        )}
      </div>
      <ul className="flex flex-col gap-2" aria-label={t('lista')}>
        {queue.items.map((item) => (
          <li key={item.idempotencyKey} className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="pending-item" data-match={item.matchId}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm font-semibold break-words text-text">{item.label}</span>
              <PendingPill status={item.status} />
            </div>
            <p className="tabular text-xs break-words text-muted">
              {t('guardadoEm', { summary: summary(item.payload.entries), when: formatDateTime(item.createdAt) })}
            </p>
            {item.status === 'CONFLICT' && (
              <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t('conflito')}
              </p>
            )}
            {item.status === 'ERROR' && item.error && (
              <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-danger">
                <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {item.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {item.status === 'CONFLICT' && (
                <Button size="sm" variant="secondary" iconLeft={<Eye className="size-4" aria-hidden />} onClick={() => onOpenMatch(item.matchId)}>
                  {t('verAtual')}
                </Button>
              )}
              {item.status === 'ERROR' && (
                <Button size="sm" variant="secondary" disabled={!online} iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => void queue.retry(item.idempotencyKey)}>
                  {t('tentarDeNovo')}
                </Button>
              )}
              {item.status !== 'SENDING' &&
                (confirming === item.idempotencyKey ? (
                  <>
                    <Button size="sm" variant="danger" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => void queue.discard(item.idempotencyKey)}>
                      {t('confirmarDescarte')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      {t('manter')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={t('descartarRotulo', { label: item.label })} onClick={() => setConfirming(item.idempotencyKey)}>
                    {t('descartar')}
                  </Button>
                ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
