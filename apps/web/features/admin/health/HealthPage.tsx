'use client';

import type { SystemHealth } from '@nova/schemas';
import { Badge, Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, XCircle } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { HEALTH_REFRESH_MS, useSystemHealth } from '@/shared/api/hooks/admin-settings';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { formatNumber } from '../common/format';

type ServiceStatus = SystemHealth['services'][number]['status'];

const STATUS: Record<ServiceStatus, { label: string; tone: 'primary' | 'warning' | 'danger'; icon: typeof CheckCircle2 }> = {
  ok: { label: 'Funcionando', tone: 'primary', icon: CheckCircle2 },
  degraded: { label: 'Instável', tone: 'warning', icon: AlertTriangle },
  down: { label: 'Fora do ar', tone: 'danger', icon: XCircle },
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <span className="tabular font-display text-xl font-bold [overflow-wrap:anywhere]">{value}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </Card>
  );
}

/** Saúde do sistema (ADM-10): serviços, versão publicada, taxa de erro e tarefas com falha. Atualiza a cada 30 s. */
export function HealthPage() {
  const health = useSystemHealth();
  const h = health.data;
  const worst: ServiceStatus = h?.services.some((s) => s.status === 'down') ? 'down' : h?.services.some((s) => s.status === 'degraded') ? 'degraded' : 'ok';
  const WorstIcon = STATUS[worst].icon;

  return (
    <PageContainer>
      <PageHeader
        title="Saúde do sistema"
        description={`Estado dos serviços da plataforma. Atualiza sozinha a cada ${HEALTH_REFRESH_MS / 1000} segundos.`}
        actions={
          <Button variant="secondary" onClick={() => void health.refetch()} loading={health.isFetching} iconLeft={<RefreshCw className="size-4" aria-hidden />}>
            Atualizar
          </Button>
        }
      />
      <p role="note" className="flex items-start gap-2 rounded-lg border border-border-strong bg-warning-soft px-4 py-3 text-sm text-warning-soft-text" data-testid="health-simulated">
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong>Valores simulados no protótipo.</strong> Latências, taxa de erro e estado dos serviços são gerados pela API simulada. Na versão final vêm do banco, do cache, das filas, do tempo real e do monitoramento de erros.
        </span>
      </p>

      {health.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Carregando a saúde do sistema">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : health.isError ? (
        <ErrorState description={errorMessage(health.error)} onRetry={() => void health.refetch()} />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
            <Badge tone={STATUS[worst].tone} icon={<WorstIcon className="size-3.5" aria-hidden />}>
              {worst === 'ok' ? 'Todos os serviços funcionando' : worst === 'degraded' ? 'Há serviço instável' : 'Há serviço fora do ar'}
            </Badge>
            <span className="text-muted">
              Conferido em <time dateTime={health.data.checkedAt}>{formatDateTime(health.data.checkedAt)}</time>
            </span>
          </p>

          <section aria-label="Resumo" className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            <Metric label="Versão publicada" value={health.data.version} hint={`Ambiente: ${health.data.environment}`} />
            <Metric label="Taxa de erro" value={`${formatNumber(health.data.errorRate)}%`} hint="das requisições, última hora" />
            <Metric label="Tarefas com falha" value={formatNumber(health.data.failedJobs)} hint="filas e tarefas agendadas" />
            <Metric label="Armazenamento em uso" value={`${formatNumber(health.data.storageUsedMb)} MB`} hint="provas, logos e banners" />
          </section>

          <section aria-labelledby="servicos" className="flex flex-col gap-3">
            <h2 id="servicos" className="text-lg">
              Serviços
            </h2>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {health.data.services.map((service) => {
                const status = STATUS[service.status];
                return (
                  <li key={service.key}>
                    <Card padding="sm" className="flex h-full flex-col gap-1" data-testid={`service-${service.key}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{service.name}</span>
                        <Badge tone={status.tone} icon={<status.icon className="size-3.5" aria-hidden />}>
                          {status.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted [overflow-wrap:anywhere]">{service.detail}</p>
                      <p className="tabular text-xs text-muted">{service.latencyMs === null ? 'Sem medição de latência' : `Latência: ${service.latencyMs} ms`}</p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </PageContainer>
  );
}
