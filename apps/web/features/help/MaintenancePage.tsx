'use client';

import type { SiteBannerItem } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { CalendarClock, CheckCircle2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useSiteBanner } from '@/shared/api/hooks/admin-tournaments';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';

function Window({ item }: { item: SiteBannerItem }) {
  const t = useT(messages, 'MaintenancePage');
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4" data-testid="maintenance-window">
      <p className="flex flex-wrap items-center gap-2 font-semibold text-text">
        {item.ongoing ? <StatusPill status="PAUSED" label={t('pillEmAndamento')} /> : <StatusPill status="SCHEDULED" label={t('pillProgramada')} />}
        {item.title}
      </p>
      <p className="text-sm text-text">{item.body}</p>
      {item.startsAt && item.endsAt && (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {item.ongoing ? t('previsaoDeVolta', { data: formatDateTime(item.endsAt) }) : t('janela', { inicio: formatDateTime(item.startsAt, { withZone: false }), fim: formatDateTime(item.endsAt) })}
        </p>
      )}
    </li>
  );
}

/**
 * Página de manutenção (issue 110, RNF-05): mostra a manutenção em andamento, as programadas (que aparecem
 * no aviso do topo do site 48 h antes) ou que está tudo funcionando. É também para onde o site aponta durante
 * uma janela de manutenção.
 */
export function MaintenancePage() {
  const banners = useSiteBanner();
  const t = useT(messages, 'MaintenancePage');
  const windows = (banners.data ?? []).filter((b) => b.kind === 'MAINTENANCE');
  const ongoing = windows.filter((w) => w.ongoing);
  const scheduled = windows.filter((w) => !w.ongoing);

  return (
    <PageContainer narrow>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      {banners.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : banners.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(banners.error)} onRetry={() => void banners.refetch()} />
      ) : (
        <>
          <Card className="flex items-start gap-4" data-testid="service-status">
            {ongoing.length > 0 ? (
              <Wrench className="mt-1 size-8 shrink-0 text-warning-soft-text" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-1 size-8 shrink-0 text-primary-text" aria-hidden />
            )}
            <div className="flex flex-col gap-1">
              <h2 className="text-lg">{ongoing.length > 0 ? t('emManutencao') : t('tudoFuncionando')}</h2>
              <p className="text-sm text-muted">
                {ongoing.length > 0
                  ? t('emManutencaoDescricao')
                  : scheduled.length > 0
                    ? t('programadaDescricao')
                    : t('nenhumaDescricao')}
              </p>
            </div>
          </Card>

          {ongoing.length > 0 && (
            <section aria-labelledby="em-andamento" className="flex flex-col gap-3">
              <h2 id="em-andamento" className="text-lg">
                {t('emAndamento')}
              </h2>
              <ul className="flex flex-col gap-2">
                {ongoing.map((w) => (
                  <Window key={w.id} item={w} />
                ))}
              </ul>
            </section>
          )}

          {scheduled.length > 0 && (
            <section aria-labelledby="programadas" className="flex flex-col gap-3">
              <h2 id="programadas" className="text-lg">
                {t('programadas')}
              </h2>
              <ul className="flex flex-col gap-2">
                {scheduled.map((w) => (
                  <Window key={w.id} item={w} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <Link href="/">{t('voltarAoInicio')}</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/contato">{t('falarComSuporte')}</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
