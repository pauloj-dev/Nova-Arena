'use client';

import type { Standings, Tournament } from '@nova/schemas';
import { EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { ListOrdered } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useStandings } from '@/shared/api/hooks/competition';
import { useMyRegistration } from '@/shared/api/hooks/registrations';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { bracketStages } from './BracketTab';
import { StageSelect } from './StageSelect';
import { BRDropTable } from './standings/BRDropTable';
import { GroupTable } from './standings/GroupTable';
import { StandingsTable } from './standings/StandingsTable';

/** Fases com tabela de classificação (tudo o que não é chave de mata-mata). */
export function standingsStages(t: Pick<Tournament, 'stages'>) {
  const bracket = new Set(bracketStages(t).map((s) => s.id));
  return [...t.stages].sort((a, b) => a.order - b.order).filter((s) => !bracket.has(s.id));
}

function nameHeaderFor(t: Pick<Tournament, 'participantType'>, s: Standings): string {
  if (t.participantType === 'SOLO') return 'Participante';
  return s.matchType === 'BATTLE_ROYALE' ? 'Squad' : 'Equipe';
}

export function StandingsContent({ standings: s, tournament: t, highlightRegistrationId }: { standings: Standings; tournament: Pick<Tournament, 'participantType'>; highlightRegistrationId?: string | null }) {
  if (s.overall.length === 0) {
    return <EmptyState icon={<ListOrdered className="size-7" />} title="A classificação ainda não começou" description="A tabela aparece aqui assim que a fase começar e sair o primeiro resultado." />;
  }
  const nameHeader = nameHeaderFor(t, s);
  const br = s.matchType === 'BATTLE_ROYALE';
  const grouped = s.groups.length > 1;
  return (
    <div className="flex flex-col gap-6">
      {grouped
        ? s.groups.map((g) => <GroupTable key={g.groupId ?? g.name} group={g} matchType={s.matchType} nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={s.updatedAt} />)
        : br
          ? <BRDropTable rows={s.overall} caption="Classificação" nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={s.updatedAt} />
          : <StandingsTable rows={s.overall} caption="Classificação" nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={s.updatedAt} />}
      {grouped && br && (
        <section className="flex flex-col gap-2">
          <h3 className="text-base">Geral (todas as salas)</h3>
          <BRDropTable rows={s.overall} caption="Classificação geral" nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={s.updatedAt} />
        </section>
      )}
      <p className="text-xs text-muted">
        Atualizada em {formatDateTime(s.updatedAt)}.{s.drawUsed && s.drawSeed && ` Houve empate decidido por sorteio (semente ${s.drawSeed}, registrada para conferência).`}
      </p>
    </div>
  );
}

/** Aba "Classificação" da página do campeonato. */
export function StandingsTab({ tournament: t }: { tournament: Tournament }) {
  const stages = standingsStages(t);
  const [stageId, setStageId] = useState(stages[0]?.id ?? '');
  const stage = stages.find((s) => s.id === stageId) ?? stages[0];
  const standings = useStandings(stage?.id);
  const { user } = useSession();
  const mine = useMyRegistration(t.id, { enabled: Boolean(user) });

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg">Classificação</h2>
      <StageSelect stages={stages} value={stage?.id ?? ''} onChange={setStageId} />
      {standings.isPending ? (
        <div role="status" aria-label="Carregando a classificação" className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : standings.isError ? (
        <ErrorState title="Não foi possível carregar a classificação" description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} />
      ) : (
        <StandingsContent standings={standings.data} tournament={t} highlightRegistrationId={mine.data?.id ?? null} />
      )}
    </section>
  );
}
