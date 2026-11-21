'use client';

import type { AdminOrganizerRequest } from '@nova/schemas';
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { Check, Inbox, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminOrganizerRequests, useReviewOrganizerRequest } from '@/shared/api/hooks/admin';
import { useT } from '@/shared/i18n/react';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { ReasonModal } from '../common/ReasonModal';
import { adminRolesMessages } from './messages';

/**
 * Fila de pedidos para virar organizador (US-ADM-03): perfil, histórico de participação e justificativa.
 * Aprovar aceita um recado opcional; recusar exige o motivo. Nos dois casos a pessoa é notificada.
 */
export function OrganizerRequestsQueue() {
  const t = useT(adminRolesMessages, 'OrganizerRequestsQueue');
  const toast = useToast();
  const requests = useAdminOrganizerRequests();
  const review = useReviewOrganizerRequest();
  const [deciding, setDeciding] = useState<{ request: AdminOrganizerRequest; action: 'approve' | 'reject' } | null>(null);

  if (requests.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (requests.isError) return <ErrorState description={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />;
  if (requests.data.length === 0) {
    return <EmptyState icon={<Inbox className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />;
  }

  function decide(reason: string) {
    if (!deciding) return;
    const { request, action } = deciding;
    review.mutate(
      { requestId: request.id, action, reason },
      {
        onSuccess: () => {
          toast.success(action === 'approve' ? t('aprovado') : t('recusado'), action === 'approve' ? t('aprovadoDescricao', { nome: request.nickname }) : t('recusadoDescricao', { nome: request.nickname }));
          setDeciding(null);
        },
        onError: (error) => toast.error(t('erroDecisao'), errorMessage(error)),
      },
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3" aria-label={t('lista')}>
        {requests.data.map((request) => (
          <li key={request.id}>
            <Card className="flex flex-col gap-3" data-testid="organizer-request">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={request.nickname} src={request.avatarUrl} size="lg" />
                  <div className="min-w-0">
                    <Link href={`/admin/usuarios/${request.userId}`} className="font-semibold hover:underline">
                      {request.nickname}
                    </Link>
                    <p className="text-xs text-muted">{t('pedido', { quando: formatRelative(request.createdAt) })}</p>
                  </div>
                </div>
                <StatusPill status={request.status} label={t('status', { status: request.status })} />
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm xs:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted">{t('historico')}</dt>
                  <dd>{t('campeonatosJogados', { count: request.tournamentsPlayed })}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('membroDesde')}</dt>
                  <dd>{formatDate(request.memberSince)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('sancoes')}</dt>
                  <dd>{t('sancoesValor', { count: request.sanctions })}</dd>
                </div>
              </dl>
              <div>
                <h3 className="text-xs font-medium text-muted">{t('justificativa')}</h3>
                <p className="text-sm [overflow-wrap:anywhere]">{request.justification}</p>
              </div>
              {request.reviewReason && (
                <p className="rounded-md bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                  <span className="font-medium">{t('rotuloRevisao', { status: request.status })}</span> {request.reviewReason}
                </p>
              )}
              {request.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setDeciding({ request, action: 'approve' })} iconLeft={<Check className="size-4" aria-hidden />}>
                    {t('aprovar')}<span className="sr-only">{t('pedidoDeSr', { nome: request.nickname })}</span>
                  </Button>
                  <Button variant="secondary" onClick={() => setDeciding({ request, action: 'reject' })} iconLeft={<X className="size-4" aria-hidden />}>
                    {t('recusar')}<span className="sr-only">{t('pedidoDeSr', { nome: request.nickname })}</span>
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      <ReasonModal
        open={deciding !== null}
        onOpenChange={(open) => {
          if (!open) setDeciding(null);
        }}
        title={deciding?.action === 'approve' ? t('aprovarTitulo', { nome: deciding.request.nickname }) : t('recusarTitulo', { nome: deciding?.request.nickname ?? '' })}
        description={
          deciding?.action === 'approve'
            ? t('aprovarDescricao')
            : t('recusarDescricao')
        }
        reasonLabel={deciding?.action === 'approve' ? t('recadoRotulo') : t('motivoRecusa')}
        minLength={deciding?.action === 'approve' ? 0 : 5}
        confirmLabel={deciding?.action === 'approve' ? t('aprovarConfirmar') : t('recusarConfirmar')}
        variant={deciding?.action === 'approve' ? 'primary' : 'danger'}
        loading={review.isPending}
        onConfirm={decide}
      />
    </>
  );
}
