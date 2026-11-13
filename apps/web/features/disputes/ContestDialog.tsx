'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { OpenDisputeInput, type ResultSubmission } from '@nova/schemas';
import { Button, Modal, Textarea, useToast } from '@nova/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useContestSubmission } from '@/shared/api/hooks/disputes';
import { EvidenceUploader } from './evidence/EvidenceUploader';

const FORM_ID = 'contest-result-form';
const ReasonSchema = OpenDisputeInput.pick({ reason: true });
type ReasonValues = z.infer<typeof ReasonSchema>;

interface ContestDialogProps {
  submission: ResultSubmission;
  /** Placar enviado, já em texto ("Bianca 2 x 1 Caio"). */
  summary: string;
  onClose: () => void;
}

/** "Contestar": motivo e prova obrigatória (PRD §16.5). Abre a disputa e leva até ela. */
export function ContestDialog({ submission, summary, onClose }: ContestDialogProps) {
  const router = useRouter();
  const { success, error } = useToast();
  const contest = useContestSubmission();
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const form = useForm<ReasonValues>({ resolver: zodResolver(ReasonSchema), defaultValues: { reason: '' } });

  function checkEvidence(): boolean {
    const parsed = OpenDisputeInput.shape.evidenceUrls.safeParse(evidenceUrls);
    setEvidenceError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    return parsed.success;
  }

  const submit = form.handleSubmit(
    (values) => {
      if (!checkEvidence()) return;
      contest.mutate(
        { submissionId: submission.id, input: { reason: values.reason, evidenceUrls } },
        {
          onSuccess: (dispute) => {
            success('Resultado contestado', 'A organização vai analisar as provas dos dois lados.');
            onClose();
            router.push(`/disputas/${dispute.id}`);
          },
          onError: (e) => {
            if (e instanceof ApiError) {
              if (e.fieldErrors.reason) form.setError('reason', { message: e.fieldErrors.reason });
              if (e.fieldErrors.evidenceUrls) setEvidenceError(e.fieldErrors.evidenceUrls);
            }
            error('Não foi possível contestar', errorMessage(e));
          },
        },
      );
    },
    // Motivo inválido: mostra também a falta da prova, de uma vez.
    () => void checkEvidence(),
  );

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Contestar resultado"
      description={`Placar enviado por ${submission.submittedByNickname}: ${summary}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={contest.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" loading={contest.isPending} disabled={uploading}>
            Contestar resultado
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
        <Textarea label="O que está errado?" required rows={4} maxLength={1000} hint="Diga qual foi o placar real e o que o print do adversário não mostra." error={form.formState.errors.reason?.message} {...form.register('reason')} />
        <EvidenceUploader
          label="Prova"
          required
          hint="Obrigatória: print da tela final ou do histórico da partida. PNG, JPG ou WebP de até 5 MB."
          purpose="evidence"
          max={3}
          value={evidenceUrls}
          onChange={(urls) => {
            setEvidenceUrls(urls);
            if (urls.length > 0) setEvidenceError(undefined);
          }}
          onBusyChange={setUploading}
          error={evidenceError}
        />
        <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">Ao contestar, a partida fica em disputa e a tabela não muda até a organização decidir.</p>
      </form>
    </Modal>
  );
}
