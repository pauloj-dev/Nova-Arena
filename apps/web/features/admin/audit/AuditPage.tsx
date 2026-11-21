'use client';

import { Button, ErrorState, Input, Select, useToast } from '@nova/ui';
import { Download, FilterX } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAuditLogs, useAuditMeta, useExportAuditCsv, type AuditFilters } from '@/shared/api/hooks/admin-audit';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatNumber } from '../common/format';
import { Pager } from '../common/Pager';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { AuditTimeline, entityTypeLabel } from './AuditTimeline';
import { adminAuditMessages } from './messages';

const EMPTY: Required<Pick<AuditFilters, 'actor' | 'action' | 'entityType' | 'from' | 'to'>> = { actor: '', action: '', entityType: '', from: '', to: '' };

/** Entrega o arquivo ao navegador sem tocar no conteúdo (o BOM precisa chegar intacto). */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Auditoria (ADM-08): linha do tempo das ações sensíveis, com antes e depois lado a lado,
 * filtros por quem fez, ação, recurso e período, e exportação em CSV com os mesmos filtros.
 * É somente leitura: nenhum registro pode ser alterado ou apagado.
 */
export function AuditPage() {
  const t = useT(adminAuditMessages, 'AuditPage');
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const actor = useDebouncedValue(filters.actor.trim());
  const applied: AuditFilters = { actor, action: filters.action, entityType: filters.entityType, from: filters.from, to: filters.to };
  const logs = useAuditLogs({ ...applied, page });
  const meta = useAuditMeta();
  const exportCsv = useExportAuditCsv();
  const dirty = Object.values(filters).some((v) => v !== '');
  const invalidRange = Boolean(filters.from && filters.to && filters.to < filters.from);

  function set<K extends keyof typeof EMPTY>(key: K, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  // Um atalho por filtro: o nome do campo fica fora do JSX.
  const setActor = (value: string) => set('actor', value);
  const setAction = (value: string) => set('action', value);
  const setEntityType = (value: string) => set('entityType', value);
  const setFrom = (value: string) => set('from', value);
  const setTo = (value: string) => set('to', value);

  function download() {
    exportCsv.mutate(applied, {
      onSuccess: ({ blob, filename }) => {
        saveBlob(blob, filename);
        toast.success(t('toastExportada'), t('toastExportadaDetalhe', { arquivo: filename, total: formatNumber(logs.data?.total ?? 0) }));
      },
      onError: (error) => toast.error(t('toastErroExportar'), errorMessage(error)),
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao')}
        actions={
          <Button variant="secondary" onClick={download} loading={exportCsv.isPending} disabled={invalidRange} iconLeft={<Download className="size-4" aria-hidden />}>
            {t('exportar')}
          </Button>
        }
      />

      <form role="search" aria-label={t('filtros')} className="grid grid-cols-1 items-end gap-3 xs:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => event.preventDefault()}>
        <Input label={t('quemFez')} type="search" placeholder={t('apelido')} value={filters.actor} onChange={(event) => setActor(event.target.value)} autoComplete="off" />
        <Select label={t('acao')} placeholder={t('todasAcoes')} options={meta.data?.actions ?? []} value={filters.action} onChange={(event) => setAction(event.target.value)} />
        <Select
          label={t('recurso')}
          placeholder={t('todosRecursos')}
          options={(meta.data?.entityTypes ?? []).map((type) => ({ value: type, label: entityTypeLabel(type) }))}
          value={filters.entityType}
          onChange={(event) => setEntityType(event.target.value)}
        />
        <Input label={t('de')} type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFrom(event.target.value)} />
        <Input label={t('ate')} type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setTo(event.target.value)} error={invalidRange ? t('dataInvalida') : undefined} />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {logs.isPending ? t('carregando') : logs.isError ? '' : t('contagem', { total: formatNumber(logs.data.total), filtrado: dirty ? 'sim' : 'nao' })}
        </p>
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY);
              setPage(1);
            }}
            iconLeft={<FilterX className="size-4" aria-hidden />}
          >
            {t('limparFiltros')}
          </Button>
        )}
      </div>

      {logs.isError ? (
        <ErrorState description={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
      ) : (
        <>
          <AuditTimeline
            logs={logs.data?.items}
            loading={logs.isPending}
            expanded
            empty={
              <p className="rounded-lg border border-dashed border-border-strong px-6 py-10 text-center text-sm text-muted">
                {dirty ? t('nenhumFiltro') : t('nenhumaAcao')}
              </p>
            }
          />
          {logs.data && <Pager page={logs.data.page} pageCount={logs.data.pageCount} total={logs.data.total} onPageChange={setPage} label={t('paginacao')} />}
        </>
      )}
    </PageContainer>
  );
}
