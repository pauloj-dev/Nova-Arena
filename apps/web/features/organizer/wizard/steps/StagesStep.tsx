'use client';

import { useController, useFormContext } from 'react-hook-form';
import { withStageKeys, type WizardValues } from '../../lib/draft';
import { normalizeStages } from '../../lib/formats';
import { FormatAssistant } from '../../stage-builder/FormatAssistant';
import { StageBuilder } from '../../stage-builder/StageBuilder';
import { useWizard } from '../context';

/** Passo 4 — Fases: o `StageBuilder` ligado ao formulário do assistente. */
export function StagesStep() {
  const { control } = useFormContext<WizardValues>();
  const { field } = useController({ control, name: 'stages' });
  const { game, mode, values, userId, lockedStageIds } = useWizard();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Monte o caminho do campeonato, da primeira fase até a final. As contas são feitas para as <strong className="text-text">{values.maxParticipants} vagas</strong> do passo Inscrições.
      </p>
      <FormatAssistant game={game} mode={mode} userId={userId} maxParticipants={values.maxParticipants} hasStages={field.value.length > 0} onApply={(stages) => field.onChange(normalizeStages(withStageKeys(stages)))} />
      <StageBuilder value={field.value} onChange={field.onChange} game={game} mode={mode} maxParticipants={values.maxParticipants} userId={userId} lockedStageIds={lockedStageIds} />
    </div>
  );
}
