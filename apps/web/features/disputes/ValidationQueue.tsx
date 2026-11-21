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
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';
import { EvidenceGallery } from './evidence/EvidenceGallery';
import { scoreLine } from './scoreForm';
import { useLiveResultQueues } from './useLiveResultQueues';

const RejectSchema = z.object({ reason: z.string().trim().min(3, { error: () => getT(messages, 'ValidationQueue')('informeMotivo') }) });
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
  const t = useT(messages, 'ValidationQueue');
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
        onSuccess: () => success(t('aprovadoTitulo'), t('aprovadoDescricao', { partida: submission.matchLabel })),
        onError: (e) => error(t('erroAprovar'), errorMessage(e)),
        onSettled: () => setBusyId(null),
      },
    );
  }

  return (
    <section aria-labelledby="fila-validacao" className="flex flex-col gap-4">
      <div>
        <h2 id="fila-validacao" className="text-lg">
          {t('titulo')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('descricao')}</p>
      </div>

      {queue.isPending ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : queue.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(queue.error)} onRetry={() => void queue.refetch()} />
      ) : queue.data.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="size-7" />}
          title={t('vazioTitulo')}
          description={t('vazioDescricao')}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('titulo')}>
          {queue.data.map((submission) => {
            const busy = busyId === submission.id;
            return (
              <li key={submission.id}>
                <Card>
                  <article aria-label={submission.matchLabel} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 text-base [overflow-wrap:anywhere]">{submission.matchLabel}</h3>
                      {submission.status === 'CONFIRMED' ? <StatusPill status="CONFIRMED" label={t('confirmado')} /> : <StatusPill status="PENDING" label={t('semResposta')} />}
                    </div>
                    <p className="tabular text-xl font-bold text-text [overflow-wrap:anywhere]">{scoreLine(submission, matchOf(submission))}</p>
                    <p className="text-sm text-muted">
                      {t('enviadoPor', { nick: submission.submittedByNickname, data: formatDateTime(submission.createdAt) })}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <p className="text-sm font-semibold text-text">{t('prints')}</p>
                      <EvidenceGallery urls={submission.evidenceUrls} label={t('print')} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" loading={busy} disabled={review.isPending && !busy} iconLeft={<Check className="size-4" aria-hidden />} onClick={() => approve(submission)}>
                        {t('aprovar')}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={review.isPending} iconLeft={<X className="size-4" aria-hidden />} onClick={() => setRejecting(submission)}>
                        {t('recusar')}
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
  const t = useT(messages, 'RejectDialog');
  const review = useReviewSubmission();
  const { success, error } = useToast();
  const form = useForm<RejectValues>({ resolver: zodResolver(RejectSchema), defaultValues: { reason: '' } });

  const submit = form.handleSubmit(({ reason }) => {
    review.mutate(
      { submissionId: submission.id, input: { action: 'reject', reason } },
      {
        onSuccess: () => {
          success(t('recusadoTitulo'), t('recusadoDescricao'));
          onClose();
        },
        onError: (e) => error(t('erro'), errorMessage(e)),
      },
    );
  });

  const reasonField = form.register('reason');

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('titulo')}
      description={submission.matchLabel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={review.isPending}>
            {t('voltar')}
          </Button>
          <Button type="submit" form="reject-submission-form" variant="danger" loading={review.isPending}>
            {t('recusar')}
          </Button>
        </>
      }
    >
      <form id="reject-submission-form" onSubmit={(e) => void submit(e)} noValidate>
        <Textarea label={t('motivo')} required rows={3} maxLength={500} hint={t('motivoDica')} error={form.formState.errors.reason?.message} {...reasonField} />
      </form>
    </Modal>
  );
}
