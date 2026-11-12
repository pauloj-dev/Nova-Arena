'use client';

import type { Tournament } from '@nova/schemas';
import { ErrorState, Skeleton } from '@nova/ui';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useBracket } from '@/shared/api/hooks/competition';
import { useMyRegistration } from '@/shared/api/hooks/registrations';
import { useSession } from '@/shared/session/useSession';
import { BracketView } from './bracket/BracketView';
import { StageSelect } from './StageSelect';

const BRACKET_FORMATS = new Set(['SINGLE_ELIM', 'DOUBLE_ELIM', 'TEAM_VS_TEAM']);

/** Fases do campeonato que são mata-mata (as que têm chave para desenhar). */
export function bracketStages(t: Pick<Tournament, 'stages'>) {
  return [...t.stages].sort((a, b) => a.order - b.order).filter((s) => BRACKET_FORMATS.has(s.format));
}

/** Aba "Chave" da página do campeonato. */
export function BracketTab({ tournament: t }: { tournament: Tournament }) {
  const stages = bracketStages(t);
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const stage = stages.find((s) => s.id === stageId) ?? stages[0];
  const bracket = useBracket(stage?.id);
  const { user } = useSession();
  const mine = useMyRegistration(t.id, { enabled: Boolean(user) });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg">Chave</h2>
      <StageSelect stages={stages} value={stage?.id ?? ''} onChange={setStageId} />
      {bracket.isPending ? (
        <div role="status" aria-label="Carregando a chave" className="flex flex-col gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : bracket.isError ? (
        <ErrorState title="Não foi possível carregar a chave" description={errorMessage(bracket.error)} onRetry={() => void bracket.refetch()} />
      ) : (
        <BracketView bracket={bracket.data} label={`Chave da fase ${stage?.name ?? ''}`.trim()} highlightRegistrationId={mine.data?.id ?? null} />
      )}
    </section>
  );
}
