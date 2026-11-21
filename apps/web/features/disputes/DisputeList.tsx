'use client';

import type { Dispute } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { Scale } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useTournamentDisputes } from '@/shared/api/hooks/disputes';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';
import { useLiveResultQueues } from './useLiveResultQueues';

export interface DisputeListProps {
  tournamentId: string;
}

/** Disputas do campeonato, para o staff: as abertas primeiro. Cada uma abre em `/disputas/[id]`. */
export function DisputeList({ tournamentId }: DisputeListProps) {
  const t = useT(messages, 'DisputeList');
  const disputes = useTournamentDisputes(tournamentId);
  useLiveResultQueues(tournamentId);
  const open = disputes.data?.filter((d) => d.status !== 'RESOLVED').length ?? 0;

  return (
    <section aria-labelledby="lista-disputas" className="flex flex-col gap-4">
      <div>
        <h2 id="lista-disputas" className="text-lg">
          {t('titulo')}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {disputes.data ? t('aguardando', { count: open }) : t('descricao')}
        </p>
      </div>

      {disputes.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : disputes.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(disputes.error)} onRetry={() => void disputes.refetch()} />
      ) : disputes.data.length === 0 ? (
        <EmptyState icon={<Scale className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('lista')}>
          {disputes.data.map((dispute) => (
            <li key={dispute.id}>
              <DisputeRow dispute={dispute} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DisputeRow({ dispute }: { dispute: Dispute }) {
  const t = useT(messages, 'DisputeList');
  return (
    <Card>
      <article aria-label={t('disputa', { partida: dispute.matchLabel })} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 text-base [overflow-wrap:anywhere]">{dispute.matchLabel}</h3>
          <StatusPill status={dispute.status} />
        </div>
        <p className="text-sm text-muted">
          {t('contestadoPor', { nick: dispute.openedByNickname, data: formatDateTime(dispute.createdAt) })}
        </p>
        <p className="line-clamp-2 text-sm text-text [overflow-wrap:anywhere]">{dispute.reason}</p>
        <Button asChild variant={dispute.status === 'RESOLVED' ? 'ghost' : 'secondary'} size="sm" className="self-start">
          <Link href={`/disputas/${dispute.id}`}>{dispute.status === 'RESOLVED' ? t('verHistorico') : t('abrir')}</Link>
        </Button>
      </article>
    </Card>
  );
}
