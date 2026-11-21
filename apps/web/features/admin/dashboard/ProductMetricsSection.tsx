'use client';

import type { ProductMetric, ProductMetrics } from '@nova/schemas';
import { Button, Card, cn, Skeleton } from '@nova/ui';
import { AlertTriangle, CheckCircle2, MinusCircle } from 'lucide-react';
import { getFormat, getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatNumber, formatPercent } from '../common/format';
import { adminDashboardMessages } from './messages';

const decimal = (value: number) => getFormat().number(value, { maximumFractionDigits: 1 });

/** Valor no formato da unidade: "8,5 min", "42 s", "83,3%", "+40", "4,2". */
export function formatMetric(value: number, unit: ProductMetric['unit']): string {
  const t = getT(adminDashboardMessages, 'ProductMetricsSection');
  switch (unit) {
    case 'minutes':
      return t('minutos', { valor: decimal(value) });
    case 'seconds':
      return t('segundos', { valor: decimal(value) });
    case 'percent':
      return formatPercent(value);
    case 'score':
      return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
    case 'count':
      return decimal(value);
  }
}

const STATUS: Record<ProductMetric['status'], { icon: typeof CheckCircle2; className: string }> = {
  ok: { icon: CheckCircle2, className: 'bg-accent-soft text-accent-soft-text' },
  attention: { icon: AlertTriangle, className: 'bg-warning-soft text-warning-soft-text' },
  no_data: { icon: MinusCircle, className: 'bg-neutral-soft text-neutral-soft-text' },
};

function MetricItem({ metric }: { metric: ProductMetric }) {
  const t = useT(adminDashboardMessages, 'ProductMetricsSection');
  const status = STATUS[metric.status];
  const Icon = status.icon;
  return (
    <li className="flex min-h-32 flex-col justify-between gap-2 rounded-lg border border-border bg-surface p-4">
      <span className="text-sm font-medium text-muted">{metric.label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular font-display text-2xl font-bold leading-none text-text" data-testid={`metric-${metric.key}`}>
          {metric.value === null ? '—' : formatMetric(metric.value, metric.unit)}
        </span>
        <span className="text-xs text-muted">{t('meta', { alvo: metric.targetLabel })}</span>
      </span>
      <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', status.className)}>
          <Icon className="size-3.5" aria-hidden />
          {t(`status.${metric.status}`)}
        </span>
        <span>{t('casos', { count: metric.sample })}</span>
      </span>
      <span className="text-xs text-muted">{metric.detail}</span>
    </li>
  );
}

export interface ProductMetricsSectionProps {
  data: ProductMetrics | undefined;
  loading: boolean;
  /** A API não respondeu (na API simulada a rota não existe: os números vêm só da API real). */
  failed: boolean;
  onRetry: () => void;
}

/** Metas do produto (PRD §3.2 e §20.1): cada Key Result e o HEART com valor, meta e situação (ícone + texto). */
export function ProductMetricsSection({ data, loading, failed, onRetry }: ProductMetricsSectionProps) {
  const t = useT(adminDashboardMessages, 'ProductMetricsSection');
  const groups: { key: ProductMetric['group']; title: string }[] = [
    { key: 'OKR', title: t('okrs') },
    { key: 'HEART', title: t('heart') },
  ];
  return (
    <Card>
      <section aria-labelledby="metas-do-produto" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="metas-do-produto" className="text-lg">
            {t('titulo')}
          </h2>
          {data && (
            <p className="text-xs text-muted">
              {t('northStar', { count: data.northStar.thisWeek, anterior: formatNumber(data.northStar.lastWeek) })}
            </p>
          )}
        </div>
        {failed ? (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong px-4 py-6 text-sm text-muted">
            <p>{t('falhou')}</p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              {t('tentarDeNovo')}
            </Button>
          </div>
        ) : loading || !data ? (
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label={t('carregando')}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-text">{group.title}</h3>
              <ul className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-3">
                {data.metrics
                  .filter((m) => m.group === group.key)
                  .map((m) => (
                    <MetricItem key={m.key} metric={m} />
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </Card>
  );
}
