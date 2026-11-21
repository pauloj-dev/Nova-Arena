'use client';

import type { SystemHealth } from '@nova/schemas';
import { Badge, Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { AlertTriangle, CheckCircle2, FlaskConical, RefreshCw, XCircle } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { isModuleMocked } from '@/shared/api/mode';
import { HEALTH_REFRESH_MS, useSystemHealth } from '@/shared/api/hooks/admin-settings';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { formatNumber } from '../common/format';
import { adminHealthMessages } from './messages';

type ServiceStatus = SystemHealth['services'][number]['status'];

const STATUS: Record<ServiceStatus, { tone: 'primary' | 'warning' | 'danger'; icon: typeof CheckCircle2 }> = {
  ok: { tone: 'primary', icon: CheckCircle2 },
  degraded: { tone: 'warning', icon: AlertTriangle },
  down: { tone: 'danger', icon: XCircle },
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
  const t = useT(adminHealthMessages, 'HealthPage');
  const health = useSystemHealth();
  const h = health.data;
  const worst: ServiceStatus = h?.services.some((s) => s.status === 'down') ? 'down' : h?.services.some((s) => s.status === 'degraded') ? 'degraded' : 'ok';
  const WorstIcon = STATUS[worst].icon;
  const simulated = isModuleMocked('admin-settings');
  const simulatedNote = t.rich('simulado', { strong: (chunks) => <strong>{chunks}</strong> });
  const checkedAt = (iso: string) => t.rich('conferido', { quando: formatDateTime(iso), time: (chunks) => <time dateTime={iso}>{chunks}</time> });

  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao', { segundos: String(HEALTH_REFRESH_MS / 1000) })}
        actions={
          <Button variant="secondary" onClick={() => void health.refetch()} loading={health.isFetching} iconLeft={<RefreshCw className="size-4" aria-hidden />}>
            {t('atualizar')}
          </Button>
        }
      />
      {/* Só quando a saúde vem da API simulada: com a API real, os valores são os de verdade. */}
      {simulated && (
        <p role="note" className="flex items-start gap-2 rounded-lg border border-border-strong bg-warning-soft px-4 py-3 text-sm text-warning-soft-text" data-testid="health-simulated">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{simulatedNote}</span>
        </p>
      )}

      {health.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : health.isError ? (
        <ErrorState description={errorMessage(health.error)} onRetry={() => void health.refetch()} />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2 text-sm" role="status" aria-live="polite">
            <Badge tone={STATUS[worst].tone} icon={<WorstIcon className="size-3.5" aria-hidden />}>
              {t(`geral.${worst}`)}
            </Badge>
            <span className="text-muted">{checkedAt(health.data.checkedAt)}</span>
          </p>

          <section aria-label={t('resumo')} className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            <Metric label={t('versao')} value={health.data.version} hint={t('ambiente', { ambiente: health.data.environment })} />
            {health.data.errorRate !== null ? (
              <Metric label={t('taxaErro')} value={t('taxaErroValor', { taxa: formatNumber(health.data.errorRate) })} hint={t('taxaErroDica')} />
            ) : (
              <Metric
                label={t('errosHora')}
                value={health.data.errorTracking?.eventsLastHour != null ? formatNumber(health.data.errorTracking.eventsLastHour) : '—'}
                hint={health.data.errorTracking?.configured ? t('sentryRecebidos') : t('sentryAusente')}
              />
            )}
            <Metric label={t('tarefasFalha')} value={formatNumber(health.data.failedJobs)} hint={t('tarefasFalhaDica')} />
            <Metric label={t('armazenamento')} value={t('armazenamentoValor', { mb: formatNumber(health.data.storageUsedMb) })} hint={t('armazenamentoDica')} />
          </section>

          <section aria-labelledby="servicos" className="flex flex-col gap-3">
            <h2 id="servicos" className="text-lg">
              {t('servicos')}
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
                          {t(`status.${service.status}`)}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted [overflow-wrap:anywhere]">{service.detail}</p>
                      <p className="tabular text-xs text-muted">{service.latencyMs === null ? t('semLatencia') : t('latencia', { ms: String(service.latencyMs) })}</p>
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
