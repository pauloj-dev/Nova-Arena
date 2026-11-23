'use client';

import { REPORT_REASON_LABELS, ReportStatus, type AdminReport, type Dispute } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton, StatusPill, Tabs, useToast } from '@nova/ui';
import { Ban, CheckCircle2, ExternalLink, Eye, Flag, Gavel, MessageSquareWarning, PauseCircle, ThumbsDown, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminReports, useEscalatedDisputes, useHandleReport } from '@/shared/api/hooks/admin-moderation';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { Pager } from '../common/Pager';
import { ReasonModal } from '../common/ReasonModal';
import { UserStatusPill } from '../common/UserBits';
import { SanctionModal, type SanctionType } from '../users/SanctionModal';
import { FraudAlertsQueue, useOpenFraudAlerts } from '../fraud/FraudAlertsQueue';
import { adminModerationMessages } from './messages';

function ReportStatusBadge({ status }: { status: AdminReport['status'] }) {
  const t = useT(adminModerationMessages, 'ReportStatusBadge');
  if (status === 'OPEN' || status === 'IN_REVIEW') return <StatusPill status={status} />;
  return status === 'ACTIONED' ? (
    <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
      {t('tratada')}
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<XCircle className="size-3.5" aria-hidden />}>
      {t('improcedente')}
    </Badge>
  );
}

type Action = { kind: 'sanction'; type: SanctionType; report: AdminReport } | { kind: 'dismiss'; report: AdminReport } | null;

function ReportsQueue() {
  const t = useT(adminModerationMessages, 'ReportsQueue');
  const statusOptions = ReportStatus.options.map((value) => ({ value, label: t(`filtro.${value}`) }));
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const reports = useAdminReports({ status, page });
  const handle = useHandleReport();
  const [action, setAction] = useState<Action>(null);

  if (reports.isError) return <ErrorState description={errorMessage(reports.error)} onRetry={() => void reports.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <Select
        label={t('mostrar')}
        placeholder={t('todas')}
        options={statusOptions}
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setPage(1);
        }}
        className="max-w-xs"
      />
      {reports.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : reports.data.items.length === 0 ? (
        <EmptyState
          icon={<Flag className="size-7" />}
          title={status ? t('nenhumaFiltro') : t('nenhuma')}
          description={status ? t('trocarFiltro') : t('nenhumaDescricao')}
          action={
            status ? (
              <Button variant="secondary" onClick={() => setStatus('')}>
                {t('verTodas')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('lista')}>
          {reports.data.items.map((report) => {
            const open = report.status === 'OPEN' || report.status === 'IN_REVIEW';
            const canSanction = open && report.targetUserId !== null && report.targetUserStatus !== 'BANNED' && report.targetUserStatus !== 'MERGED' && report.targetUserStatus !== 'DELETED';
            return (
              <li key={report.id}>
                <Card className="flex flex-col gap-3" data-testid="report">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold [overflow-wrap:anywhere]">{REPORT_REASON_LABELS[report.reason]}</p>
                      <p className="text-sm text-muted [overflow-wrap:anywhere]">
                        {t(`alvo.${report.targetType}`)}:{' '}
                        {report.targetLink ? (
                          <Link href={report.targetLink} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">
                            {report.targetLabel}
                            <ExternalLink className="size-3.5" aria-hidden />
                          </Link>
                        ) : (
                          <span className="text-text">{report.targetLabel}</span>
                        )}
                      </p>
                    </div>
                    <ReportStatusBadge status={report.status} />
                  </div>
                  <p className="text-sm [overflow-wrap:anywhere]">{report.description}</p>
                  {report.evidenceUrls.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label={t('anexos')}>
                      {report.evidenceUrls.map((url, index) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2 md:min-h-8">
                            <Eye className="size-4" aria-hidden />
                            {t('anexo', { n: String(index + 1) })}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted">
                    {t('denunciadoPor', { nome: report.reporterNickname })}
                    <time dateTime={report.createdAt} title={formatDateTime(report.createdAt)}>{formatRelative(report.createdAt)}</time>
                  </p>
                  {report.targetUserId && (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      {t('respondePeloAlvo')}
                      <Link href={`/admin/usuarios/${report.targetUserId}`} className="font-semibold hover:underline">
                        {report.targetUserNickname}
                      </Link>
                      {report.targetUserStatus && <UserStatusPill status={report.targetUserStatus} />}
                    </p>
                  )}
                  {report.resolution && (
                    <p className="rounded-md bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                      <span className="font-medium">{t('decisao', { temAutor: report.handledByNickname ? 'sim' : 'nao', autor: report.handledByNickname ?? '' })}</span> {report.resolution}
                    </p>
                  )}
                  {open && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label={t('acoesRapidas', { alvo: report.targetLabel })}>
                      {report.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={handle.isPending && handle.variables?.reportId === report.id && handle.variables.status === 'IN_REVIEW'}
                          onClick={() => handle.mutate({ reportId: report.id, status: 'IN_REVIEW' }, { onError: (error) => toast.error(t('toastErroAtualizar'), errorMessage(error)) })}
                          iconLeft={<Eye className="size-4" aria-hidden />}
                        >
                          {t('marcarAnalise')}
                        </Button>
                      )}
                      {canSanction && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'sanction', type: 'WARNING', report })} iconLeft={<MessageSquareWarning className="size-4" aria-hidden />}>
                            {t('advertir')}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'sanction', type: 'SUSPENSION', report })} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
                            {t('suspender')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setAction({ kind: 'sanction', type: 'BAN', report })} iconLeft={<Ban className="size-4" aria-hidden />}>
                            {t('banir')}
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'dismiss', report })} iconLeft={<ThumbsDown className="size-4" aria-hidden />}>
                        {t('improcedente')}
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {reports.data && <Pager page={reports.data.page} pageCount={reports.data.pageCount} total={reports.data.total} onPageChange={setPage} label={t('paginacao')} />}

      {action?.kind === 'sanction' && action.report.targetUserId && (
        <SanctionModal
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          type={action.type}
          reportId={action.report.id}
          targets={[{ id: action.report.targetUserId, nickname: action.report.targetUserNickname ?? action.report.targetLabel }]}
        />
      )}
      <ReasonModal
        open={action?.kind === 'dismiss'}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={t('improcedenteTitulo')}
        description={t('improcedenteDescricao')}
        reasonLabel={t('explicacao')}
        confirmLabel={t('fecharImprocedente')}
        loading={handle.isPending}
        onConfirm={(resolution) => {
          if (action?.kind !== 'dismiss') return;
          handle.mutate(
            { reportId: action.report.id, status: 'DISMISSED', resolution },
            {
              onSuccess: () => {
                toast.success(t('toastFechada'), t('toastFechadaDetalhe'));
                setAction(null);
              },
              onError: (error) => toast.error(t('toastErroFechar'), errorMessage(error)),
            },
          );
        }}
      />
    </div>
  );
}

function DisputesQueue() {
  const t = useT(adminModerationMessages, 'DisputesQueue');
  const disputes = useEscalatedDisputes();
  if (disputes.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (disputes.isError) return <ErrorState description={errorMessage(disputes.error)} onRetry={() => void disputes.refetch()} />;
  if (disputes.data.length === 0) {
    return <EmptyState icon={<Gavel className="size-7" />} title={t('nenhuma')} description={t('nenhumaDescricao')} />;
  }
  return (
    <ul className="flex flex-col gap-3" aria-label={t('lista')}>
      {disputes.data.map((dispute: Dispute) => (
        <li key={dispute.id}>
          <Card className="flex flex-col gap-2" data-testid="dispute">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold [overflow-wrap:anywhere]">{dispute.matchLabel}</p>
                <p className="text-sm text-muted [overflow-wrap:anywhere]">{dispute.tournamentName}</p>
              </div>
              <StatusPill status="ESCALATED" />
            </div>
            <p className="text-sm [overflow-wrap:anywhere]">{dispute.reason}</p>
            <p className="text-xs text-muted">
              {t('abertaPor', { nome: dispute.openedByNickname, quando: formatRelative(dispute.createdAt), n: String(dispute.messages.length) })}
            </p>
            <Button asChild size="sm" className="self-start">
              <Link href={`/disputas/${dispute.id}`}>
                {t('abrir')}
                <span className="sr-only">{t('abrirSr', { partida: dispute.matchLabel })}</span>
              </Link>
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Moderação (ADM-07): fila de denúncias com ações rápidas e disputas escaladas pelos organizadores. */
export function ModerationPage({ initialTab }: { initialTab?: string }) {
  const t = useT(adminModerationMessages, 'ModerationPage');
  const disputes = useEscalatedDisputes();
  const count = disputes.data?.length ?? 0;
  const openAlerts = useOpenFraudAlerts();
  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <Tabs
        label={t('filas')}
        defaultValue={initialTab === 'disputas' || initialTab === 'alertas' ? initialTab : 'denuncias'}
        items={[
          { value: 'denuncias', label: t('denuncias'), content: <ReportsQueue /> },
          {
            value: 'disputas',
            label: (
              <span className="inline-flex items-center gap-2">
                {t('disputas')}
                {count > 0 && (
                  <Badge tone="danger">
                    {count}
                    <span className="sr-only">{t('naFila')}</span>
                  </Badge>
                )}
              </span>
            ),
            content: <DisputesQueue />,
          },
          {
            value: 'alertas',
            label: (
              <span className="inline-flex items-center gap-2">
                {/* Rótulo curto: as três abas cabem em 360 px. */}
                <span>
                  {t('alertas')}
                  <span className="sr-only">{t('alertasSr')}</span>
                </span>
                {openAlerts > 0 && (
                  <Badge tone="danger">
                    {openAlerts}
                    <span className="sr-only">{t('abertos')}</span>
                  </Badge>
                )}
              </span>
            ),
            content: <FraudAlertsQueue />,
          },
        ]}
      />
    </PageContainer>
  );
}
