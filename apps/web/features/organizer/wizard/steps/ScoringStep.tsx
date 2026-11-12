'use client';

import { Button, Card, EmptyState } from '@nova/ui';
import { Calculator } from 'lucide-react';
import { useController, useFormContext } from 'react-hook-form';
import { stageTitle, type WizardValues } from '../../lib/draft';
import { StageScoring } from '../../stage-builder/StageScoring';
import { useWizard } from '../context';

/** Passo 5 — Pontuação: revisão do modelo e do desempate de cada fase, com a prévia. */
export function ScoringStep() {
  const { control } = useFormContext<WizardValues>();
  const { field } = useController({ control, name: 'stages' });
  const { game, mode, userId, issues, lockedStageIds, goToStep } = useWizard();
  const stages = field.value;

  if (!game || !mode || stages.length === 0) {
    return (
      <EmptyState
        icon={<Calculator className="size-7" />}
        title="Monte as fases primeiro"
        description="A pontuação é definida por fase. Volte ao passo Fases para criar pelo menos uma."
        action={<Button onClick={() => goToStep(3)}>Ir para Fases</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Cada fase tem a própria pontuação. Os pontos são sempre calculados pela Nova Arena a partir do resultado lançado — ninguém digita pontos.</p>
      {stages.map((stage, index) => {
        const messages = (kind: 'scoring' | 'tiebreakers') => issues.filter((i) => i.field === `stages.${index}.${kind}`).map((i) => i.message.replace(/^[^:]+: /, ''));
        const locked = stage.id !== undefined && lockedStageIds.includes(stage.id);
        return (
          <Card key={stage.key} className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-text">
              <span className="text-muted">Fase {index + 1} · </span>
              {stageTitle(stage, index)}
            </h3>
            <StageScoring
              stage={stage}
              onChange={(next) => field.onChange(stages.map((s) => (s.key === stage.key ? next : s)))}
              game={game}
              mode={mode}
              userId={userId}
              stageName={stage.name.trim() || `Fase ${index + 1}`}
              scoringIssues={messages('scoring')}
              tiebreakerIssues={messages('tiebreakers')}
              disabled={locked}
            />
          </Card>
        );
      })}
    </div>
  );
}
