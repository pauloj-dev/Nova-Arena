'use client';

import { useController, useFormContext } from 'react-hook-form';
import { withStageKeys, type WizardValues } from '../../lib/draft';
import { normalizeStages } from '../../lib/formats';
import { FormatAssistant } from '../../stage-builder/FormatAssistant';
import { StageBuilder } from '../../stage-builder/StageBuilder';
import { useT } from '@/shared/i18n/react';
import { useWizard } from '../context';
import { messages } from '../messages';

/** Passo 4 — Fases: o `StageBuilder` ligado ao formulário do assistente. */
export function StagesStep() {
  const { control } = useFormContext<WizardValues>();
  const { field } = useController({ control, name: 'stages' });
  const { game, mode, values, userId, lockedStageIds } = useWizard();
  const t = useT(messages, 'StagesStep');
  const intro = t.rich('intro', { vagas: values.maxParticipants, strong: (chunks) => <strong className="text-text">{chunks}</strong> });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {intro}
      </p>
      <FormatAssistant game={game} mode={mode} userId={userId} maxParticipants={values.maxParticipants} hasStages={field.value.length > 0} onApply={(stages) => field.onChange(normalizeStages(withStageKeys(stages)))} />
      <StageBuilder value={field.value} onChange={field.onChange} game={game} mode={mode} maxParticipants={values.maxParticipants} userId={userId} lockedStageIds={lockedStageIds} />
    </div>
  );
}
