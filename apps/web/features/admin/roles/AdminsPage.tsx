'use client';

import type { AdminMember, AdminRemovalRequest } from '@nova/schemas';
import { Badge, Button, Card, DataTable, ErrorState, Skeleton, StatusPill, useToast, type Column } from '@nova/ui';
import { Crown, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminRemovalRequests, useAdmins, useReviewAdminRemoval, useRevokeRole } from '@/shared/api/hooks/admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useT } from '@/shared/i18n/react';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { ReasonModal } from '../common/ReasonModal';
import { UserIdentity } from '../common/UserBits';
import { InvitesSection } from './InvitesSection';
import { adminRolesMessages } from './messages';

type AdminsT = ReturnType<typeof useT<(typeof adminRolesMessages)['pt-BR'], 'AdminsPage'>>;

function buildColumns(t: AdminsT): Column<AdminMember>[] {
  return [
    { id: 'admin', header: t('colunaAdministrador'), primary: true, cell: (admin) => <UserIdentity user={admin} /> },
    {
      id: 'role',
      header: t('colunaPapel'),
      cell: (admin) =>
        admin.isSuperAdmin ? (
          <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
            {t('superAdmin')}
          </Badge>
        ) : (
          <Badge tone="accent">{t('administrador')}</Badge>
        ),
    },
    { id: 'since', header: t('colunaDesde'), cell: (admin) => formatDate(admin.adminSince) },
    { id: 'lastSeen', header: t('colunaUltimoAcesso'), cell: (admin) => <span title={formatDate(admin.lastSeenAt)}>{formatRelative(admin.lastSeenAt)}</span> },
    {
      id: 'twoFactor',
      header: t('colunaDoisFatores'),
      cell: (admin) =>
        admin.twoFactorEnabled ? (
          <span className="inline-flex items-center gap-1 text-sm">
            <ShieldCheck className="size-4 text-primary-text" aria-hidden /> {t('doisFatoresAtiva')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <ShieldOff className="size-4" aria-hidden /> {t('doisFatoresPendente')}
          </span>
        ),
    },
  ];
}

function RemovalRequests({ canDecide }: { canDecide: boolean }) {
  const t = useT(adminRolesMessages, 'RemovalRequests');
  const toast = useToast();
  const requests = useAdminRemovalRequests();
  const review = useReviewAdminRemoval();
  if (requests.isPending) return <Skeleton className="h-20 w-full" />;
  if (requests.isError) return <ErrorState description={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />;
  if (requests.data.length === 0) return null;

  function decide(request: AdminRemovalRequest, decision: 'approve' | 'reject') {
    review.mutate(
      { requestId: request.id, decision },
      {
        onSuccess: () => toast.success(decision === 'approve' ? t('aprovado') : t('recusado'), decision === 'approve' ? t('aprovadoDescricao', { nome: request.targetNickname }) : t('recusadoDescricao', { nome: request.targetNickname })),
        onError: (error) => toast.error(t('erroDecisao'), errorMessage(error)),
      },
    );
  }

  const requestLine = (request: AdminRemovalRequest) =>
    t.rich('pediuRemocao', { solicitante: request.requestedByNickname, alvo: request.targetNickname, strong: (chunks) => <strong>{chunks}</strong> });

  return (
    <section aria-labelledby="pedidos-remocao" className="flex flex-col gap-3">
      <div>
        <h2 id="pedidos-remocao" className="text-lg">
          {t('titulo')}
        </h2>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {requests.data.map((request) => (
          <li key={request.id}>
            <Card padding="sm" className="flex flex-col gap-2" data-testid="removal-request">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm [overflow-wrap:anywhere]">
                  {requestLine(request)}
                </p>
                <StatusPill status={request.status} label={t('status', { status: request.status })} />
              </div>
              {request.reason && <p className="text-sm text-muted [overflow-wrap:anywhere]">{t('motivo', { motivo: request.reason })}</p>}
              <p className="text-xs text-muted">
                {t('pedidoEm', { data: formatDate(request.createdAt) })}
                {request.reviewedByNickname && request.reviewedAt && t('decidido', { nome: request.reviewedByNickname, data: formatDate(request.reviewedAt) })}
              </p>
              {request.status === 'PENDING' && canDecide && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" loading={review.isPending && review.variables?.requestId === request.id && review.variables.decision === 'approve'} onClick={() => decide(request, 'approve')}>
                    {t('aprovar')}
                  </Button>
                  <Button size="sm" variant="secondary" loading={review.isPending && review.variables?.requestId === request.id && review.variables.decision === 'reject'} onClick={() => decide(request, 'reject')}>
                    {t('recusar')}
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Administradores (ADM-02): quem tem o papel, último acesso, remoção (RN-11) e convites. */
export function AdminsPage() {
  const t = useT(adminRolesMessages, 'AdminsPage');
  const columns = useMemo(() => buildColumns(t), [t]);
  const toast = useToast();
  const { user: me } = useSession();
  const admins = useAdmins();
  const revoke = useRevokeRole();
  const [removing, setRemoving] = useState<AdminMember | null>(null);
  const iAmSuper = Boolean(me?.roles.includes('SUPER_ADMIN'));

  function confirmRemoval(reason: string) {
    if (!removing) return;
    revoke.mutate(
      { userId: removing.id, role: 'ADMIN', reason },
      {
        onSuccess: (result) => {
          if (result.outcome === 'PENDING_APPROVAL') toast.toast({ title: t('pedidoEnviado'), description: t('pedidoEnviadoDescricao', { nome: removing.nickname }), tone: 'info' });
          else toast.success(t('removido'), t('removidoDescricao', { nome: removing.nickname }));
          setRemoving(null);
        },
        onError: (error) => toast.error(t('erroRemover'), errorMessage(error)),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      {admins.isError ? (
        <ErrorState description={errorMessage(admins.error)} onRetry={() => void admins.refetch()} />
      ) : (
        <DataTable
          caption={t('titulo')}
          columns={columns}
          rows={admins.data ?? []}
          getRowId={(admin) => admin.id}
          loading={admins.isPending}
          rowActions={(admin) =>
            admin.isSuperAdmin ? (
              <span className="text-xs text-muted">{t('naoPodeSerRemovido')}</span>
            ) : admin.id === me?.id ? (
              <span className="text-xs text-muted">{t('eVoce')}</span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setRemoving(admin)} iconLeft={<UserMinus className="size-4" aria-hidden />}>
                {t('remover')}<span className="sr-only">{t('removerSr', { nome: admin.nickname })}</span>
              </Button>
            )
          }
        />
      )}

      <RemovalRequests canDecide={iAmSuper} />
      <InvitesSection defaultRole="ADMIN" />

      <ReasonModal
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? t('modalTituloNome', { nome: removing.nickname }) : t('modalTitulo')}
        description={
          iAmSuper
            ? t('modalDescricaoSuper')
            : t('modalDescricao')
        }
        minLength={0}
        confirmLabel={t('confirmar')}
        variant="danger"
        loading={revoke.isPending}
        onConfirm={confirmRemoval}
      />
    </PageContainer>
  );
}
