'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ResultSubmission } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Modal, Skeleton, StatusPill, Textarea, useToast } from '@nova/ui';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { errorMessage } from '@/shared/api/client';
import { useTournamentMatches } from '@/shared/api/hooks/competition';
import { useReviewSubmission, useTournamentSubmissions } from '@/shared/api/hooks/disputes';
import { formatDateTime } from '@/shared/lib/datetime';
import { EvidenceGallery } from './evidence/EvidenceGallery';
import { scoreLine } from './scoreForm';
import { useLiveResultQueues } from './useLiveResultQueues';

const RejectSchema = z.object({ reason: z.string().trim().min(3, 'Informe o motivo') });
type RejectValues = z.infer<typeof RejectSchema>;

export interface ValidationQueueProps {
  tournamentId: string;
}

/**
 * Fila "Resultados para validar" do organizador: envios confirmados pelo adversário e envios
 * sem resposta no prazo. Aprovar transforma o envio em resultado oficial (pontos calculados
 * pelo servidor); recusar exige motivo e devolve a partida para um novo envio.
 */
export function ValidationQueue({ tournamentId }: ValidationQueueProps) {
  const queue = useTournamentSubmissions(tournamentId);
  const matches = useTournamentMatches(tournamentId);
  const review = useReviewSubmission();
  const { success, error } = useToast();
  const [rejecting, setRejecting] = useState<ResultSubmission | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  useLiveResultQueues(tournamentId);

  const matchOf = (submission: ResultSubmission) => matches.data?.find((m) => m.id === submission.matchId);

  function approve(submission: ResultSubmission) {
    setBusyId(submission.id);
    review.mutate(
      { submissionId: submission.id, input: { action: 'approve' } },
      {
        onSuccess: () => success('Resultado aprovado', `${submission.matchLabel}: o placar agora é oficial e a tabela foi atualizada.`),
        onError: (e) => error('Não foi possível aprovar', errorMessage(e)),
        onSettled: () => setBusyId(null),
      },
    );
  }

  return (
    <section aria-labelledby="fila-validacao" className="flex flex-col gap-4">
      <div>
        <h2 id="fila-validacao" className="text-lg">
          Resultados para validar
        </h2>
        <p className="mt-1 text-sm text-muted">Placares enviados pelos participantes. Confira o print antes de aprovar: o resultado aprovado entra na tabela.</p>
      </div>

      {queue.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Carregando resultados para validar">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : queue.isError ? (
        <ErrorState title="Não foi possível carregar os resultados enviados" description={errorMessage(queue.error)} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-7" />}
          title="Nenhum resultado para validar"
          description="Quando um participante enviar o placar e o adversário confirmar (ou o prazo de 30 minutos passar), o envio aparece aqui."
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Resultados para validar">
          {queue.data.map((submission) => {
            const busy = busyId === submission.id;
            return (
              <li key={submission.id}>
                <Card>
                  <article aria-label={submission.matchLabel} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 text-base [overflow-wrap:anywhere]">{submission.matchLabel}</h3>
                      {submission.status === 'CONFIRMED' ? <StatusPill status="CONFIRMED" label="Confirmado pelo adversário" /> : <StatusPill status="PENDING" label="Sem resposta do adversário" />}
                    </div>
                    <p className="tabular text-xl font-bold text-text [overflow-wrap:anywhere]">{scoreLine(submission, matchOf(submission))}</p>
                    <p className="text-sm text-muted">
                      Enviado por {submission.submittedByNickname} em {formatDateTime(submission.createdAt)}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <p className="text-sm font-semibold text-text">Prints enviados</p>
                      <EvidenceGallery urls={submission.evidenceUrls} label="Print" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" loading={busy} disabled={review.isPending && !busy} iconLeft={<Check className="size-4" aria-hidden />} onClick={() => approve(submission)}>
                        Aprovar
                      </Button>
                      <Button size="sm" variant="secondary" disabled={review.isPending} iconLeft={<X className="size-4" aria-hidden />} onClick={() => setRejecting(submission)}>
                        Recusar
                      </Button>
                    </div>
                  </article>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {rejecting && <RejectDialog submission={rejecting} onClose={() => setRejecting(null)} />}
    </section>
  );
}

function RejectDialog({ submission, onClose }: { submission: ResultSubmission; onClose: () => void }) {
  const review = useReviewSubmission();
  const { success, error } = useToast();
  const form = useForm<RejectValues>({ resolver: zodResolver(RejectSchema), defaultValues: { reason: '' } });

  const submit = form.handleSubmit(({ reason }) => {
    review.mutate(
      { submissionId: submission.id, input: { action: 'reject', reason } },
      {
        onSuccess: () => {
          success('Envio recusado', 'A partida voltou a aguardar resultado e quem enviou foi avisado do motivo.');
          onClose();
        },
        onError: (e) => error('Não foi possível recusar', errorMessage(e)),
      },
    );
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Recusar resultado enviado"
      description={submission.matchLabel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={review.isPending}>
            Voltar
          </Button>
          <Button type="submit" form="reject-submission-form" variant="danger" loading={review.isPending}>
            Recusar envio
          </Button>
        </>
      }
    >
      <form id="reject-submission-form" onSubmit={(e) => void submit(e)} noValidate>
        <Textarea label="Motivo da recusa" required rows={3} maxLength={500} hint="Quem enviou recebe este texto. Ex.: o print não mostra o placar final." error={form.formState.errors.reason?.message} {...form.register('reason')} />
      </form>
    </Modal>
  );
}
