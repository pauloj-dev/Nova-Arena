'use client';

import type { Dispute } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { Scale } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useTournamentDisputes } from '@/shared/api/hooks/disputes';
import { formatDateTime } from '@/shared/lib/datetime';
import { useLiveResultQueues } from './useLiveResultQueues';

export interface DisputeListProps {
  tournamentId: string;
}

/** Disputas do campeonato, para o staff: as abertas primeiro. Cada uma abre em `/disputas/[id]`. */
export function DisputeList({ tournamentId }: DisputeListProps) {
  const disputes = useTournamentDisputes(tournamentId);
  useLiveResultQueues(tournamentId);
  const open = disputes.data?.filter((d) => d.status !== 'RESOLVED').length ?? 0;

  return (
    <section aria-labelledby="lista-disputas" className="flex flex-col gap-4">
      <div>
        <h2 id="lista-disputas" className="text-lg">
          Disputas
        </h2>
        <p className="mt-1 text-sm text-muted">
          {disputes.data ? (open === 0 ? 'Nenhuma disputa aguardando decisão.' : open === 1 ? '1 disputa aguardando decisão.' : `${open} disputas aguardando decisão.`) : 'Resultados contestados pelos participantes.'}
        </p>
      </div>

      {disputes.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Carregando disputas">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : disputes.isError ? (
        <ErrorState title="Não foi possível carregar as disputas" description={errorMessage(disputes.error)} onRetry={() => void disputes.refetch()} />
      ) : disputes.data.length === 0 ? (
        <EmptyState icon={<Scale className="size-7" />} title="Nenhuma disputa neste campeonato" description="Quando um participante contestar um resultado enviado pelo adversário, a disputa aparece aqui com as provas dos dois lados." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Disputas do campeonato">
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
  return (
    <Card>
      <article aria-label={`Disputa: ${dispute.matchLabel}`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 text-base [overflow-wrap:anywhere]">{dispute.matchLabel}</h3>
          <StatusPill status={dispute.status} />
        </div>
        <p className="text-sm text-muted">
          Contestado por {dispute.openedByNickname} em {formatDateTime(dispute.createdAt)}
        </p>
        <p className="line-clamp-2 text-sm text-text [overflow-wrap:anywhere]">{dispute.reason}</p>
        <Button asChild variant={dispute.status === 'RESOLVED' ? 'ghost' : 'secondary'} size="sm" className="self-start">
          <Link href={`/disputas/${dispute.id}`}>{dispute.status === 'RESOLVED' ? 'Ver histórico' : 'Abrir disputa'}</Link>
        </Button>
      </article>
    </Card>
  );
}
