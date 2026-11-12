'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ResolveDisputeInput, type Dispute, type Match, type ResultSubmission } from '@nova/schemas';
import { Button, Modal, Textarea, useToast } from '@nova/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useEscalateDispute, useResolveDispute } from '@/shared/api/hooks/disputes';
import { ScoreFields } from './ScoreFields';
import { ScoreFormSchema, scoreLine, scoreProblems, sidesOf, toResultInput, type ScoreField, type ScoreFormValues } from './scoreForm';
import { useTiebreakField } from './useTiebreakField';

/** Confirmação de "Escalar para a administração". */
export function EscalateDialog({ dispute, onClose }: { dispute: Dispute; onClose: () => void }) {
  const escalate = useEscalateDispute(dispute.id);
  const { success, error } = useToast();
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Escalar para a administração"
      description={dispute.matchLabel}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={escalate.isPending}>
            Voltar
          </Button>
          <Button
            loading={escalate.isPending}
            onClick={() =>
              escalate.mutate(undefined, {
                onSuccess: () => {
                  success('Disputa escalada', 'A administração da Nova Arena foi avisada e vai decidir.');
                  onClose();
                },
                onError: (e) => error('Não foi possível escalar', errorMessage(e)),
              })
            }
          >
            Escalar disputa
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">A decisão passa para a administração da Nova Arena. Depois de escalar, a organização do campeonato não resolve mais esta disputa — só acompanha e envia mensagens.</p>
    </Modal>
  );
}

type Outcome = 'keep' | 'correct' | 'none';
const ResolutionSchema = ResolveDisputeInput.pick({ resolution: true });
type ResolutionValues = z.infer<typeof ResolutionSchema>;
const FORM_ID = 'resolve-dispute-form';

interface ResolveDialogProps {
  dispute: Dispute;
  submission: ResultSubmission | undefined;
  match: Match | undefined;
  onClose: () => void;
}

/** "Resolver disputa": a decisão por escrito e o que fazer com o resultado (manter o enviado, lançar o correto ou nenhum). */
export function ResolveDialog({ dispute, submission, match, onClose }: ResolveDialogProps) {
  const resolve = useResolveDispute(dispute.id);
  const { success, error } = useToast();
  const sides = match ? sidesOf(match) : null;
  const tiebreak = useTiebreakField(dispute.tournamentId);
  const [outcome, setOutcome] = useState<Outcome>(submission ? 'keep' : 'correct');
  const form = useForm<ResolutionValues>({ resolver: zodResolver(ResolutionSchema), defaultValues: { resolution: '' } });
  const scores = useForm<ScoreFormValues>({ resolver: zodResolver(ScoreFormSchema) });
  const [a, b] = useWatch({ control: scores.control, name: ['a', 'b'] });

  const options: { value: Outcome; label: string; hint: string; disabled?: boolean }[] = [
    ...(submission ? [{ value: 'keep' as const, label: `Manter o resultado enviado (${scoreLine(submission, match)})`, hint: 'O placar enviado vira o resultado oficial.' }] : []),
    { value: 'correct', label: 'Lançar o resultado correto', hint: 'Informe o placar que vale. Os pontos são calculados pelo sistema.', disabled: !match || !sides },
    { value: 'none', label: 'Não lançar resultado agora', hint: 'O envio é anulado e a partida volta a aguardar resultado.' },
  ];

  const submit = form.handleSubmit(async ({ resolution }) => {
    let result: ResolveDisputeInput['result'];
    if (outcome === 'keep' && submission) {
      // Sem prova nova: o servidor mantém na partida os prints do envio original.
      result = { entries: submission.entries, winnerRegistrationId: submission.winnerRegistrationId, evidenceUrls: [] };
    } else if (outcome === 'correct') {
      if (!match || !sides || !(await scores.trigger())) return;
      const values = scores.getValues();
      const problems = Object.entries(scoreProblems(match, values, tiebreak.field)) as [ScoreField, string][];
      for (const [field, message] of problems) scores.setError(field, { message });
      if (problems.length > 0) return;
      result = { ...toResultInput(match, sides, values, tiebreak.field), evidenceUrls: [] };
    }
    resolve.mutate(
      { resolution, ...(result ? { result } : {}) },
      {
        onSuccess: () => {
          success('Disputa resolvida', result ? 'O resultado oficial foi lançado e os envolvidos foram avisados.' : 'O envio foi anulado e os envolvidos foram avisados.');
          onClose();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.fieldErrors.resolution) form.setError('resolution', { message: e.fieldErrors.resolution });
          error('Não foi possível resolver a disputa', errorMessage(e));
        },
      },
    );
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Resolver disputa"
      description={dispute.matchLabel}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={resolve.isPending}>
            Voltar
          </Button>
          <Button type="submit" form={FORM_ID} loading={resolve.isPending} disabled={tiebreak.isLoading}>
            Resolver disputa
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-text">O que fazer com o resultado?</legend>
          {options.map((o) => (
            <label key={o.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} disabled={o.disabled} onChange={() => setOutcome(o.value)} className="mt-1 size-4 shrink-0 accent-current" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-text [overflow-wrap:anywhere]">{o.label}</span>
                <span className="text-xs text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {outcome === 'correct' && match && sides && <ScoreFields match={match} sides={sides} register={scores.register} errors={scores.formState.errors} a={a} b={b} tiebreak={tiebreak.field} />}

        <Textarea
          label="Decisão"
          required
          rows={4}
          maxLength={1000}
          hint="Explique o que as provas mostram. Os dois lados leem este texto e ele fica registrado na auditoria."
          error={form.formState.errors.resolution?.message}
          {...form.register('resolution')}
        />
      </form>
    </Modal>
  );
}
