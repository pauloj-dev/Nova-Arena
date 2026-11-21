'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateSubmissionInput, type Match } from '@nova/schemas';
import { Button, Modal, useToast } from '@nova/ui';
import { ScanText } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateSubmission } from '@/shared/api/hooks/disputes';
import { EvidenceUpload } from '@/features/evidence/EvidenceUpload';
import { ScoreFields } from './ScoreFields';
import { ScoreFormSchema, scoreProblems, toResultInput, type ScoreField, type ScoreFormValues, type Side } from './scoreForm';
import { useTiebreakField } from './useTiebreakField';
import { focusOcrConfirm, OcrConfirm, OcrDialog, OcrMark, type OcrValues } from '@/features/ocr/OcrDialog';
import type { Recognizer } from '@/features/ocr/recognize';
import { useFlag } from '@/shared/flags/useFlag';

const FORM_ID = 'submit-result-form';
export const MAX_EVIDENCE = 3;

interface SubmitResultDialogProps {
  match: Match;
  sides: [Side, Side];
  mineRegistrationId: string;
  onClose: () => void;
  /** Troca o reconhecimento do print (testes). */
  recognize?: Recognizer;
}

/** "Enviar resultado": placar dos dois lados, desempate quando empata em mata-mata e print obrigatório. */
export function SubmitResultDialog({ match, sides, mineRegistrationId, onClose, recognize }: SubmitResultDialogProps) {
  const { success, error } = useToast();
  const create = useCreateSubmission(match.id);
  const tiebreak = useTiebreakField(match.tournamentId);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceError, setEvidenceError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const form = useForm<ScoreFormValues>({ resolver: zodResolver(ScoreFormSchema) });
  const [a, b] = useWatch({ control: form.control, name: ['a', 'b'] });
  // Leitura do print (issue 123, flag `resultOcr`): o placar lido fica marcado até a pessoa mudar, e enviar pede conferência.
  const ocrEnabled = useFlag('resultOcr');
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrApplied, setOcrApplied] = useState<{ a?: number; b?: number }>({});
  const [ocrChecked, setOcrChecked] = useState(false);
  const [ocrError, setOcrError] = useState<string | undefined>();
  const ocrConfirmId = useId();
  const marked = [ocrApplied.a !== undefined && ocrApplied.a === a, ocrApplied.b !== undefined && ocrApplied.b === b] as const;
  const ocrPending = marked.filter(Boolean).length;

  function applyOcr(values: OcrValues) {
    const next = { a: values[sides[0].registrationId]?.score, b: values[sides[1].registrationId]?.score };
    if (next.a !== undefined) form.setValue('a', next.a, { shouldDirty: true });
    if (next.b !== undefined) form.setValue('b', next.b, { shouldDirty: true });
    setOcrApplied(next);
    setOcrChecked(false);
    setOcrError(undefined);
  }

  const submit = form.handleSubmit((values) => {
    const problems = Object.entries(scoreProblems(match, values, tiebreak.field)) as [ScoreField, string][];
    for (const [field, message] of problems) form.setError(field, { message });
    // O mesmo contrato da API confere o que vai ser enviado (print obrigatório — PRD §16.5).
    const parsed = CreateSubmissionInput.safeParse({ ...toResultInput(match, sides, values, tiebreak.field), evidenceUrls });
    const evidenceIssue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === 'evidenceUrls')?.message;
    setEvidenceError(evidenceIssue);
    if (problems.length > 0 || !parsed.success) return;
    if (ocrPending > 0 && !ocrChecked) {
      setOcrError('Marque que conferiu o placar lido do print antes de enviar.');
      focusOcrConfirm(ocrConfirmId);
      return;
    }

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
        {ocrEnabled && (
          <div>
            <Button type="button" variant="secondary" size="sm" iconLeft={<ScanText className="size-4" aria-hidden />} onClick={() => setOcrOpen(true)}>
              Ler o print
            </Button>
          </div>
        )}
        <ScoreFields match={match} sides={sides} mineRegistrationId={mineRegistrationId} register={form.register} errors={form.formState.errors} a={a} b={b} tiebreak={tiebreak.field} />
        {ocrPending > 0 && (
          <div className="grid grid-cols-2 gap-3 -mt-3">
            {marked.map((on, i) => (on ? <OcrMark key={i} /> : <span key={i} />))}
          </div>
        )}
        {ocrPending > 0 && (
          <OcrConfirm
            id={ocrConfirmId}
            count={ocrPending}
            checked={ocrChecked}
            onCheckedChange={(checked) => {
              setOcrChecked(checked);
              if (checked) setOcrError(undefined);
            }}
            error={ocrError}
          />
        )}
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
      {ocrEnabled && (
        <OcrDialog
          open={ocrOpen}
          onClose={() => setOcrOpen(false)}
          kind="duel"
          bestOf={match.bestOf}
          candidates={sides.map((side) => ({ registrationId: side.registrationId, name: side.name, tag: match.participants.find((p) => p.registrationId === side.registrationId)?.tag ?? null }))}
          onApply={applyOcr}
          recognize={recognize}
        />
      )}
    </Modal>
  );
}
