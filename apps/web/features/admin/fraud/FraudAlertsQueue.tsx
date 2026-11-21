'use client';

import { FRAUD_ALERT_LABELS, FraudAlertKind, FraudAlertStatus, type FraudAlert, type FraudSeverity } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton, useToast } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Fingerprint, Gamepad2, Network, ShieldAlert, ThumbsDown, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useFraudAlerts, useReviewFraudAlert } from '@/shared/api/hooks/admin-fraud';
import { useT } from '@/shared/i18n/react';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';
import { Pager } from '../common/Pager';
import { ReasonModal } from '../common/ReasonModal';
import { UserStatusPill } from '../common/UserBits';
import { adminFraudMessages } from './messages';

const KIND_ICON: Record<FraudAlert['kind'], ReactNode> = {
  MULTI_ACCOUNT_IP: <Network className="size-4" aria-hidden />,
  MULTI_ACCOUNT_DEVICE: <Fingerprint className="size-4" aria-hidden />,
  DUPLICATE_GAME_ID: <Gamepad2 className="size-4" aria-hidden />,
  MASS_ADMIN_ACTION: <ShieldAlert className="size-4" aria-hidden />,
};
const SEVERITY_TONE: Record<FraudSeverity, 'danger' | 'warning' | 'neutral'> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };
const KIND_OPTIONS = FraudAlertKind.options.map((value) => ({ value, label: FRAUD_ALERT_LABELS[value] }));

function AlertStatusBadge({ status }: { status: FraudAlert['status'] }) {
  const t = useT(adminFraudMessages, 'AlertStatusBadge');
  if (status === 'OPEN') {
    return (
      <Badge tone="warning" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
        {t('aberto')}
      </Badge>
    );
  }
  return status === 'ACTIONED' ? (
    <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
      {t('tratado')}
    </Badge>
  ) : (
    <Badge tone="neutral" icon={<XCircle className="size-3.5" aria-hidden />}>
      {t('improcedente')}
    </Badge>
  );
}

type Review = { alert: FraudAlert; status: 'ACTIONED' | 'DISMISSED' } | null;

/**
 * Fila de alertas antifraude (issue #114): várias contas por IP/aparelho, ID de jogo repetido e ações administrativas
 * em massa (só o Super Admin vê estas). Cada alerta leva às contas envolvidas; fechar pede a explicação (auditada).
 */
export function FraudAlertsQueue() {
  const t = useT(adminFraudMessages, 'FraudAlertsQueue');
  const statusOptions = FraudAlertStatus.options.map((value) => ({ value, label: t(`filtro.${value}`) }));
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const alerts = useFraudAlerts({ status: status || undefined, kind: kind || undefined, page });
  const review = useReviewFraudAlert();
  const [action, setAction] = useState<Review>(null);

  if (alerts.isError) return <ErrorState description={errorMessage(alerts.error)} onRetry={() => void alerts.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('explicacao')}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Select
          label={t('situacao')}
          placeholder={t('todos')}
          options={statusOptions}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
        <Select
          label={t('tipo')}
          placeholder={t('todosTipos')}
          options={KIND_OPTIONS}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPage(1);
          }}
          className="sm:max-w-xs"
        />
      </div>
      {alerts.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : alerts.data.items.length === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="size-7" />}
          title={status === 'OPEN' ? t('nenhumAberto') : t('nenhumFiltro')}
          description={status === 'OPEN' ? t('nenhumAbertoDescricao') : t('trocarFiltro')}
          action={
            status || kind ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setStatus('');
                  setKind('');
                }}
              >
                {t('verTodos')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('lista')}>
          {alerts.data.items.map((alert) => (
            <li key={alert.id}>
              <Card className="flex flex-col gap-3" data-testid="fraud-alert">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="inline-flex items-center gap-2 font-semibold">
                    {KIND_ICON[alert.kind]}
                    {FRAUD_ALERT_LABELS[alert.kind]}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={SEVERITY_TONE[alert.severity]}>{t('gravidade', { nivel: alert.severity })}</Badge>
                    <AlertStatusBadge status={alert.status} />
                  </div>
                </div>
                <p className="text-sm [overflow-wrap:anywhere]">{alert.summary}</p>
                {alert.actor && (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {t('admin')}
                    <Link href={`/admin/usuarios/${alert.actor.id}`} className="font-semibold hover:underline">
                      {alert.actor.nickname}
                    </Link>
                    <UserStatusPill status={alert.actor.status} />
                  </p>
                )}
                {alert.users.length > 0 && (
                  <ul className="flex flex-wrap gap-2" aria-label={t('contas')}>
                    {alert.users.map((user) => (
                      <li key={user.id}>
                        <Link href={`/admin/usuarios/${user.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-3 text-sm font-medium hover:bg-surface-2 md:min-h-8">
                          {user.nickname}
                          {user.status !== 'ACTIVE' && <UserStatusPill status={user.status} />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted">
                  {t('vistoPrimeira')}
                  <time dateTime={alert.firstSeenAt} title={formatDateTime(alert.firstSeenAt)}>{formatRelative(alert.firstSeenAt)}</time>
                  {alert.occurrences > 1 && (
                    <>
                      {' '}
                      {t('repetiu', { n: String(alert.occurrences) })}
                      <time dateTime={alert.lastSeenAt} title={formatDateTime(alert.lastSeenAt)}>{formatRelative(alert.lastSeenAt)}</time>
                    </>
                  )}
                </p>
                {alert.resolution && (
                  <p className="rounded-md bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                    <span className="font-medium">{t('decisao', { temAutor: alert.reviewedByNickname ? 'sim' : 'nao', autor: alert.reviewedByNickname ?? '' })}</span> {alert.resolution}
                  </p>
                )}
                {alert.status === 'OPEN' && (
                  <div className="flex flex-wrap gap-2" role="group" aria-label={t('acoes', { tipo: FRAUD_ALERT_LABELS[alert.kind] })}>
                    <Button size="sm" onClick={() => setAction({ alert, status: 'ACTIONED' })} iconLeft={<CheckCircle2 className="size-4" aria-hidden />}>
                      {t('marcarTratado')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setAction({ alert, status: 'DISMISSED' })} iconLeft={<ThumbsDown className="size-4" aria-hidden />}>
                      {t('improcedente')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {alerts.data && <Pager page={alerts.data.page} pageCount={alerts.data.pageCount} total={alerts.data.total} onPageChange={setPage} label={t('paginacao')} />}

      <ReasonModal
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        title={action?.status === 'ACTIONED' ? t('tituloTratado') : t('tituloImprocedente')}
        description={t('modalDescricao')}
        reasonLabel={t('decidido')}
        confirmLabel={action?.status === 'ACTIONED' ? t('marcarTratado') : t('fecharImprocedente')}
        loading={review.isPending}
        onConfirm={(resolution) => {
          if (!action) return;
          review.mutate(
            { alertId: action.alert.id, status: action.status, resolution },
            {
              onSuccess: () => {
                toast.success(action.status === 'ACTIONED' ? t('toastTratado') : t('toastImprocedente'));
                setAction(null);
              },
              onError: (error) => toast.error(t('toastErro'), errorMessage(error)),
            },
          );
        }}
      />
    </div>
  );
}

/** Contador de alertas abertos para a aba (some quando não há nenhum). */
export function useOpenFraudAlerts(): number {
  const alerts = useFraudAlerts({ status: 'OPEN' });
  return alerts.data?.openCount ?? 0;
}
