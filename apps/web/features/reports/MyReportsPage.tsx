'use client';

import { REPORT_REASON_LABELS, type Report } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { Flag } from 'lucide-react';
import Link from 'next/link';
import { EvidenceGallery } from '@/features/disputes/evidence/EvidenceGallery';
import { errorMessage } from '@/shared/api/client';
import { useMyReports } from '@/shared/api/hooks/reports';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
import { reportStatus, reportTargetLabel } from './reportStatus';

/** `/minha-conta/denuncias`: as denúncias que eu fiz, com o status e a resposta da moderação. */
export function MyReportsPage() {
  const reports = useMyReports();
  const t = useT(messages, 'MyReportsPage');
  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <div className="flex max-w-3xl flex-col gap-4">
        {reports.isPending ? (
          <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : reports.isError ? (
          <ErrorState title={t('erro')} description={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />
        ) : reports.data.length === 0 ? (
          <EmptyState
            icon={<Flag className="size-7" />}
            title={t('vazioTitulo')}
            description={t('vazioDescricao')}
            action={
              <Button asChild variant="secondary">
                <Link href="/campeonatos">{t('verCampeonatos')}</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4" aria-label={t('lista')}>
            {reports.data.map((report) => (
              <li key={report.id}>
                <ReportCard report={report} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}

function ReportCard({ report }: { report: Report }) {
  const t = useT(messages, 'MyReportsPage');
  const status = reportStatus(report.status);
  return (
    <Card>
      <article className="flex flex-col gap-3" aria-label={t('cardRotulo', { alvo: report.targetLabel })}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{reportTargetLabel(report.targetType)}</p>
            <h2 className="text-base [overflow-wrap:anywhere]">
              {report.targetLink ? (
                <Link href={report.targetLink} className="text-primary-text underline underline-offset-2">
                  {report.targetLabel}
                </Link>
              ) : (
                report.targetLabel
              )}
            </h2>
          </div>
          <StatusPill status={status.status} label={status.label} />
        </div>

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-text">{t('motivo')}</dt>
            <dd className="text-muted">{REPORT_REASON_LABELS[report.reason]}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-text">{t('enviadaEm')}</dt>
            <dd className="text-muted">{formatDateTime(report.createdAt)}</dd>
          </div>
        </dl>

        <p className="whitespace-pre-line text-sm text-text [overflow-wrap:anywhere]">{report.description}</p>
        <EvidenceGallery urls={report.evidenceUrls} label={t('anexo')} />

        {report.resolution ? (
          <div className="rounded-md bg-surface-2 px-3 py-3 text-sm">
            <p className="font-semibold text-text">{report.handledByNickname ? t('respostaDe', { nick: report.handledByNickname }) : t('resposta')}</p>
            <p className="mt-1 whitespace-pre-line text-muted [overflow-wrap:anywhere]">{report.resolution}</p>
            <p className="mt-1 text-xs text-muted">{t('atualizadaEm', { data: formatDateTime(report.updatedAt) })}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">{status.help}</p>
        )}
      </article>
    </Card>
  );
}
