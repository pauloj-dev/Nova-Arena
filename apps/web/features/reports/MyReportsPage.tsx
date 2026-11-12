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
import { REPORT_STATUS, REPORT_TARGET_LABELS } from './reportStatus';

/** `/minha-conta/denuncias`: as denúncias que eu fiz, com o status e a resposta da moderação. */
export function MyReportsPage() {
  const reports = useMyReports();
  return (
    <PageContainer>
      <PageHeader title="Denúncias" description="Acompanhe o que você denunciou e a resposta da moderação." />
      <div className="flex max-w-3xl flex-col gap-4">
        {reports.isPending ? (
          <div className="flex flex-col gap-4" role="status" aria-label="Carregando denúncias">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : reports.isError ? (
          <ErrorState title="Não foi possível carregar as suas denúncias" description={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />
        ) : reports.data.length === 0 ? (
          <EmptyState
            icon={<Flag className="size-7" />}
            title="Você não fez nenhuma denúncia"
            description="Viu trapaça, resultado falso ou ofensa? Use o botão “Denunciar” no perfil do jogador, na página do squad ou na partida."
            action={
              <Button asChild variant="secondary">
                <Link href="/campeonatos">Ver campeonatos</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Minhas denúncias">
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
  const status = REPORT_STATUS[report.status];
  return (
    <Card>
      <article className="flex flex-col gap-3" aria-label={`Denúncia sobre ${report.targetLabel}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{REPORT_TARGET_LABELS[report.targetType]}</p>
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
            <dt className="font-semibold text-text">Motivo:</dt>
            <dd className="text-muted">{REPORT_REASON_LABELS[report.reason]}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold text-text">Enviada em:</dt>
            <dd className="text-muted">{formatDateTime(report.createdAt)}</dd>
          </div>
        </dl>

        <p className="whitespace-pre-line text-sm text-text [overflow-wrap:anywhere]">{report.description}</p>
        <EvidenceGallery urls={report.evidenceUrls} label="Anexo" />

        {report.resolution ? (
          <div className="rounded-md bg-surface-2 px-3 py-3 text-sm">
            <p className="font-semibold text-text">Resposta da moderação{report.handledByNickname ? ` (${report.handledByNickname})` : ''}</p>
            <p className="mt-1 whitespace-pre-line text-muted [overflow-wrap:anywhere]">{report.resolution}</p>
            <p className="mt-1 text-xs text-muted">Atualizada em {formatDateTime(report.updatedAt)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted">{status.help}</p>
        )}
      </article>
    </Card>
  );
}
