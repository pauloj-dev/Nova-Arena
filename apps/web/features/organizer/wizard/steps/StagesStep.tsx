'use client';

import { useController, useFormContext } from 'react-hook-form';
import type { WizardValues } from '../../lib/draft';
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
      <StageBuilder value={field.value} onChange={field.onChange} game={game} mode={mode} maxParticipants={values.maxParticipants} userId={userId} lockedStageIds={lockedStageIds} />
    </div>
  );
}
