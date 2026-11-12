'use client';

import type { AdminOrganizerRequest } from '@nova/schemas';
import { Avatar, Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { Check, Inbox, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminOrganizerRequests, useReviewOrganizerRequest } from '@/shared/api/hooks/admin';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { plural } from '../common/format';
import { ReasonModal } from '../common/ReasonModal';

/**
 * Fila de pedidos para virar organizador (US-ADM-03): perfil, histórico de participação e justificativa.
 * Aprovar aceita um recado opcional; recusar exige o motivo. Nos dois casos a pessoa é notificada.
 */
export function OrganizerRequestsQueue() {
  const toast = useToast();
  const requests = useAdminOrganizerRequests();
  const review = useReviewOrganizerRequest();
  const [deciding, setDeciding] = useState<{ request: AdminOrganizerRequest; action: 'approve' | 'reject' } | null>(null);

  if (requests.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Carregando pedidos">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (requests.isError) return <ErrorState description={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />;
  if (requests.data.length === 0) {
    return <EmptyState icon={<Inbox className="size-7" />} title="Nenhum pedido na fila" description="Quando alguém pedir para virar organizador, o pedido aparece aqui com o histórico da conta." />;
  }

  function decide(reason: string) {
    if (!deciding) return;
    const { request, action } = deciding;
    review.mutate(
      { requestId: request.id, action, reason },
      {
        onSuccess: () => {
          toast.success(action === 'approve' ? 'Pedido aprovado' : 'Pedido recusado', action === 'approve' ? `${request.nickname} agora é organizador e foi avisado.` : `${request.nickname} foi avisado do motivo.`);
          setDeciding(null);
        },
        onError: (error) => toast.error('Não foi possível registrar a decisão', errorMessage(error)),
      },
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Pedidos para virar organizador">
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
                    <p className="text-xs text-muted">Pedido {formatRelative(request.createdAt)}</p>
                  </div>
                </div>
                <StatusPill status={request.status} label={request.status === 'PENDING' ? 'Aguardando análise' : request.status === 'APPROVED' ? 'Aprovado' : 'Recusado'} />
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm xs:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted">Histórico de participação</dt>
                  <dd>{plural(request.tournamentsPlayed, 'campeonato jogado', 'campeonatos jogados')}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Na Nova Arena desde</dt>
                  <dd>{formatDate(request.memberSince)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Sanções</dt>
                  <dd>{request.sanctions === 0 ? 'Nenhuma' : plural(request.sanctions, 'sanção', 'sanções')}</dd>
                </div>
              </dl>
              <div>
                <h3 className="text-xs font-medium text-muted">Justificativa</h3>
                <p className="text-sm [overflow-wrap:anywhere]">{request.justification}</p>
              </div>
              {request.reviewReason && (
                <p className="rounded-md bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]">
                  <span className="font-medium">{request.status === 'APPROVED' ? 'Recado da aprovação' : 'Motivo da recusa'}:</span> {request.reviewReason}
                </p>
              )}
              {request.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setDeciding({ request, action: 'approve' })} iconLeft={<Check className="size-4" aria-hidden />}>
                    Aprovar<span className="sr-only"> pedido de {request.nickname}</span>
                  </Button>
                  <Button variant="secondary" onClick={() => setDeciding({ request, action: 'reject' })} iconLeft={<X className="size-4" aria-hidden />}>
                    Recusar<span className="sr-only"> pedido de {request.nickname}</span>
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
        title={deciding?.action === 'approve' ? `Aprovar o pedido de ${deciding.request.nickname}` : `Recusar o pedido de ${deciding?.request.nickname ?? ''}`}
        description={
          deciding?.action === 'approve'
            ? 'A conta vira organizadora, com limite de 3 campeonatos simultâneos e todos os jogos. A pessoa é notificada.'
            : 'A pessoa é notificada com o motivo e pode enviar um novo pedido depois.'
        }
        reasonLabel={deciding?.action === 'approve' ? 'Recado para a pessoa' : 'Motivo da recusa'}
        minLength={deciding?.action === 'approve' ? 0 : 5}
        confirmLabel={deciding?.action === 'approve' ? 'Aprovar pedido' : 'Recusar pedido'}
        variant={deciding?.action === 'approve' ? 'primary' : 'danger'}
        loading={review.isPending}
        onConfirm={decide}
      />
    </>
  );
}
