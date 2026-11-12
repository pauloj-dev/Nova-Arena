'use client';

import { Button, ErrorState, Input, Select, useToast } from '@nova/ui';
import { Download, FilterX } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAuditLogs, useAuditMeta, useExportAuditCsv, type AuditFilters } from '@/shared/api/hooks/admin-audit';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatNumber } from '../common/format';
import { Pager } from '../common/Pager';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { AuditTimeline, entityTypeLabel } from './AuditTimeline';

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

  function download() {
    exportCsv.mutate(applied, {
      onSuccess: ({ blob, filename }) => {
        saveBlob(blob, filename);
        toast.success('Auditoria exportada', `${filename} com ${formatNumber(logs.data?.total ?? 0)} registro(s).`);
      },
      onError: (error) => toast.error('Não foi possível exportar', errorMessage(error)),
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Auditoria"
        description="Tudo o que foi feito de sensível na plataforma: quem, o quê, quando, por quê e o antes e depois. Os registros não podem ser alterados nem apagados."
        actions={
          <Button variant="secondary" onClick={download} loading={exportCsv.isPending} disabled={invalidRange} iconLeft={<Download className="size-4" aria-hidden />}>
            Exportar CSV
          </Button>
        }
      />

      <form role="search" aria-label="Filtros da auditoria" className="grid grid-cols-1 items-end gap-3 xs:grid-cols-2 lg:grid-cols-5" onSubmit={(event) => event.preventDefault()}>
        <Input label="Quem fez" type="search" placeholder="Apelido" value={filters.actor} onChange={(event) => set('actor', event.target.value)} autoComplete="off" />
        <Select label="Ação" placeholder="Todas as ações" options={meta.data?.actions ?? []} value={filters.action} onChange={(event) => set('action', event.target.value)} />
        <Select
          label="Recurso"
          placeholder="Todos os recursos"
          options={(meta.data?.entityTypes ?? []).map((type) => ({ value: type, label: entityTypeLabel(type) }))}
          value={filters.entityType}
          onChange={(event) => set('entityType', event.target.value)}
        />
        <Input label="De" type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set('from', event.target.value)} />
        <Input label="Até" type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set('to', event.target.value)} error={invalidRange ? 'A data final vem depois da inicial' : undefined} />
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" role="status" aria-live="polite">
          {logs.isPending ? 'Carregando registros…' : logs.isError ? '' : `${formatNumber(logs.data.total)} registro(s)${dirty ? ' com estes filtros' : ''}, do mais recente para o mais antigo.`}
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
            Limpar filtros
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
                {dirty ? 'Nenhum registro combina com estes filtros.' : 'Nenhuma ação registrada ainda. Convites, sanções, trocas de responsável e mudanças de configuração aparecem aqui.'}
              </p>
            }
          />
          {logs.data && <Pager page={logs.data.page} pageCount={logs.data.pageCount} total={logs.data.total} onPageChange={setPage} label="Paginação da auditoria" />}
        </>
      )}
    </PageContainer>
  );
}
