'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateSubmissionInput, type Match } from '@nova/schemas';
import { Button, Modal, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateSubmission } from '@/shared/api/hooks/disputes';
import { EvidenceUpload } from '@/features/evidence/EvidenceUpload';
import { ScoreFields } from './ScoreFields';
import { ScoreFormSchema, scoreProblems, toResultInput, type ScoreField, type ScoreFormValues, type Side } from './scoreForm';
import { useTiebreakField } from './useTiebreakField';

const FORM_ID = 'submit-result-form';
export const MAX_EVIDENCE = 3;

interface SubmitResultDialogProps {
  match: Match;
  sides: [Side, Side];
  mineRegistrationId: string;
  onClose: () => void;
}

/** "Enviar resultado": placar dos dois lados, desempate quando empata em mata-mata e print obrigatório. */
export function SubmitResultDialog({ match, sides, mineRegistrationId, onClose }: SubmitResultDialogProps) {
  const { success, error } = useToast();
  const create = useCreateSubmission(match.id);
  const tiebreak = useTiebreakField(match.tournamentId);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const form = useForm<ScoreFormValues>({ resolver: zodResolver(ScoreFormSchema) });
  const [a, b] = useWatch({ control: form.control, name: ['a', 'b'] });

  const submit = form.handleSubmit((values) => {
    const problems = Object.entries(scoreProblems(match, values, tiebreak.field)) as [ScoreField, string][];
    for (const [field, message] of problems) form.setError(field, { message });
    // O mesmo contrato da API confere o que vai ser enviado (print obrigatório — PRD §16.5).
    const parsed = CreateSubmissionInput.safeParse({ ...toResultInput(match, sides, values, tiebreak.field), evidenceUrls });
    const evidenceIssue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === 'evidenceUrls')?.message;
    setEvidenceError(evidenceIssue);
    if (problems.length > 0 || !parsed.success) return;

    create.mutate(parsed.data, {
      onSuccess: () => {
        success('Resultado enviado', 'Agora o adversário confirma ou contesta. Depois a organização valida.');
        onClose();
      },
      onError: (e) => {
        if (e instanceof ApiError && e.fieldErrors.evidenceUrls) setEvidenceError(e.fieldErrors.evidenceUrls);
        error('Não foi possível enviar o resultado', errorMessage(e));
      },
    });
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Enviar resultado"
      description={`${match.roundLabel}: ${sides[0].name} x ${sides[1].name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={create.isPending} disabled={uploading || tiebreak.isLoading}>
            Enviar resultado
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
        <ScoreFields match={match} sides={sides} mineRegistrationId={mineRegistrationId} register={form.register} errors={form.formState.errors} a={a} b={b} tiebreak={tiebreak.field} />
        <EvidenceUpload
          label="Print do resultado"
          required
          hint="A tela final da partida, com o placar e os nomes dos dois lados. PNG, JPG ou WebP de até 5 MB."
          purpose="evidence"
          max={MAX_EVIDENCE}
          value={evidenceUrls}
          onChange={(urls) => {
            setEvidenceUrls(urls);
            if (urls.length > 0) setEvidenceError(undefined);
          }}
          onBusyChange={setUploading}
          error={evidenceError}
        />
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
          O adversário tem 30 minutos para confirmar ou contestar. O resultado só vale depois que a organização validar. Enviar resultado falso pode gerar desclassificação.
        </p>
      </form>
    </Modal>
  );
}
