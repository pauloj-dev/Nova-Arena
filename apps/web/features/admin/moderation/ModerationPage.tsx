'use client';

import { REPORT_REASON_LABELS, ReportStatus, type AdminReport, type Dispute } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton, StatusPill, Tabs, useToast } from '@nova/ui';
import { Ban, CheckCircle2, ExternalLink, Eye, Flag, Gavel, MessageSquareWarning, PauseCircle, ThumbsDown, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminReports, useEscalatedDisputes, useHandleReport } from '@/shared/api/hooks/admin-moderation';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { Pager } from '../common/Pager';
import { ReasonModal } from '../common/ReasonModal';
import { UserStatusPill } from '../common/UserBits';
import { SanctionModal, type SanctionType } from '../users/SanctionModal';

const TARGET_LABEL: Record<AdminReport['targetType'], string> = { USER: 'Usuário', TEAM: 'Squad', MATCH: 'Partida', RESULT: 'Resultado' };
const STATUS_LABEL: Record<AdminReport['status'], string> = { OPEN: 'Abertas', IN_REVIEW: 'Em análise', ACTIONED: 'Tratadas', DISMISSED: 'Improcedentes' };
const STATUS_OPTIONS = ReportStatus.options.map((status) => ({ value: status, label: STATUS_LABEL[status] }));

function ReportStatusBadge({ status }: { status: AdminReport['status'] }) {
  if (status === 'OPEN' || status === 'IN_REVIEW') return <StatusPill status={status} />;
  return status === 'ACTIONED' ? (
    <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
      Tratada
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<XCircle className="size-3.5" aria-hidden />}>
      Improcedente
    </Badge>
  );
}

type Action = { kind: 'sanction'; type: SanctionType; report: AdminReport } | { kind: 'dismiss'; report: AdminReport } | null;

function ReportsQueue() {
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
        label="Mostrar"
        placeholder="Todas as denúncias"
        options={STATUS_OPTIONS}
        value={status}
        onChange={(event) => {
          setStatus(event.target.value);
          setPage(1);
        }}
        className="max-w-xs"
      />
      {reports.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Carregando denúncias">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : reports.data.items.length === 0 ? (
        <EmptyState
          icon={<Flag className="size-7" />}
          title={status ? 'Nenhuma denúncia neste filtro' : 'Nenhuma denúncia'}
          description={status ? 'Troque o filtro para ver as outras.' : 'Quando alguém denunciar um usuário, squad, partida ou resultado, a denúncia aparece aqui.'}
          action={
            status ? (
              <Button variant="secondary" onClick={() => setStatus('')}>
                Ver todas
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Denúncias">
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
                        {TARGET_LABEL[report.targetType]}:{' '}
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
                    <ul className="flex flex-wrap gap-2" aria-label="Anexos da denúncia">
                      {report.evidenceUrls.map((url, index) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2 md:min-h-8">
                            <Eye className="size-4" aria-hidden />
                            Anexo {index + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted">
                    Denunciado por {report.reporterNickname} · <time dateTime={report.createdAt} title={formatDateTime(report.createdAt)}>{formatRelative(report.createdAt)}</time>
                  </p>
                  {report.targetUserId && (
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      Responde pelo alvo:
                      <Link href={`/admin/usuarios/${report.targetUserId}`} className="font-semibold hover:underline">
                        {report.targetUserNickname}
                      </Link>
                      {report.targetUserStatus && <UserStatusPill status={report.targetUserStatus} />}
                    </p>
                  )}
                  {report.resolution && (
                    <p className="rounded-md bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                      <span className="font-medium">Decisão{report.handledByNickname ? ` de ${report.handledByNickname}` : ''}:</span> {report.resolution}
                    </p>
                  )}
                  {open && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label={`Ações rápidas para a denúncia sobre ${report.targetLabel}`}>
                      {report.status === 'OPEN' && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={handle.isPending && handle.variables?.reportId === report.id && handle.variables.status === 'IN_REVIEW'}
                          onClick={() => handle.mutate({ reportId: report.id, status: 'IN_REVIEW' }, { onError: (error) => toast.error('Não foi possível atualizar a denúncia', errorMessage(error)) })}
                          iconLeft={<Eye className="size-4" aria-hidden />}
                        >
                          Marcar em análise
                        </Button>
                      )}
                      {canSanction && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'sanction', type: 'WARNING', report })} iconLeft={<MessageSquareWarning className="size-4" aria-hidden />}>
                            Advertir
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'sanction', type: 'SUSPENSION', report })} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
                            Suspender
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setAction({ kind: 'sanction', type: 'BAN', report })} iconLeft={<Ban className="size-4" aria-hidden />}>
                            Banir
                          </Button>
                        </>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => setAction({ kind: 'dismiss', report })} iconLeft={<ThumbsDown className="size-4" aria-hidden />}>
                        Improcedente
                      </Button>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {reports.data && <Pager page={reports.data.page} pageCount={reports.data.pageCount} total={reports.data.total} onPageChange={setPage} label="Paginação das denúncias" />}

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
        title="Marcar como improcedente"
        description="A denúncia é fechada sem sanção. Quem denunciou recebe a explicação."
        reasonLabel="Explicação para quem denunciou"
        confirmLabel="Fechar como improcedente"
        loading={handle.isPending}
        onConfirm={(resolution) => {
          if (action?.kind !== 'dismiss') return;
          handle.mutate(
            { reportId: action.report.id, status: 'DISMISSED', resolution },
            {
              onSuccess: () => {
                toast.success('Denúncia fechada como improcedente', 'Quem denunciou foi avisado.');
                setAction(null);
              },
              onError: (error) => toast.error('Não foi possível fechar a denúncia', errorMessage(error)),
            },
          );
        }}
      />
    </div>
  );
}

function DisputesQueue() {
  const disputes = useEscalatedDisputes();
  if (disputes.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando disputas">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (disputes.isError) return <ErrorState description={errorMessage(disputes.error)} onRetry={() => void disputes.refetch()} />;
  if (disputes.data.length === 0) {
    return <EmptyState icon={<Gavel className="size-7" />} title="Nenhuma disputa escalada" description="Quando um organizador não consegue resolver um resultado contestado, ele escala a disputa e ela aparece aqui." />;
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Disputas escaladas">
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
              Aberta por {dispute.openedByNickname} · {formatRelative(dispute.createdAt)} · {dispute.messages.length} mensagem(ns)
            </p>
            <Button asChild size="sm" className="self-start">
              <Link href={`/disputas/${dispute.id}`}>
                Abrir a disputa<span className="sr-only">: {dispute.matchLabel}</span>
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
  const disputes = useEscalatedDisputes();
  const count = disputes.data?.length ?? 0;
  return (
    <PageContainer>
      <PageHeader title="Moderação" description="Denúncias da comunidade e disputas que os organizadores escalaram. Toda decisão fica na auditoria e quem denunciou é avisado." />
      <Tabs
        label="Filas da moderação"
        defaultValue={initialTab === 'disputas' ? 'disputas' : 'denuncias'}
        items={[
          { value: 'denuncias', label: 'Denúncias', content: <ReportsQueue /> },
          {
            value: 'disputas',
            label: (
              <span className="inline-flex items-center gap-2">
                Disputas escaladas
                {count > 0 && (
                  <Badge tone="danger">
                    {count}
                    <span className="sr-only"> na fila</span>
                  </Badge>
                )}
              </span>
            ),
            content: <DisputesQueue />,
          },
        ]}
      />
    </PageContainer>
  );
}
