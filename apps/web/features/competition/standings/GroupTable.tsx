'use client';

import type { Standings } from '@nova/schemas';
import { BRDropTable } from './BRDropTable';
import { StandingsTable } from './StandingsTable';

export interface GroupTableProps {
  group: Standings['groups'][number];
  matchType: Standings['matchType'];
  /** Nome do lado: "Squad", "Equipe" ou "Participante". */
  nameHeader?: string;
  highlightRegistrationId?: string | null;
  version?: unknown;
  /** Nível do título (padrão h3). */
  headingLevel?: 'h3' | 'h4';
}

/** Um grupo (ou sala BR) com título e a tabela certa para o tipo de partida. */
export function GroupTable({ group, matchType, nameHeader, highlightRegistrationId, version, headingLevel: Heading = 'h3' }: GroupTableProps) {
  const caption = `Classificação — ${group.name}`;
  return (
    <section className="flex flex-col gap-2">
      <Heading className="text-base">{group.name}</Heading>
      {matchType === 'BATTLE_ROYALE' ? (
        <BRDropTable rows={group.rows} caption={caption} nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={version} />
      ) : (
        <StandingsTable rows={group.rows} caption={caption} nameHeader={nameHeader} highlightRegistrationId={highlightRegistrationId} version={version} />
      )}
    </section>
  );
}
