'use client';

import type { Standings } from '@nova/schemas';
import { cn, Select } from '@nova/ui';
import { useState } from 'react';
import { BRStandingsTable } from './BRStandingsTable';
import { StandingsTable } from './StandingsTable';

export interface GroupTableProps {
  groups: Standings['groups'];
  /** Tipo de partida da fase: decide entre a tabela de duelos e a de Battle Royale. */
  matchType: Standings['matchType'];
  participantHeader?: string;
  highlightRegistrationId?: string | null;
  drawSeed?: string | null;
  className?: string;
}

/**
 * Uma tabela por grupo. No celular aparece um grupo por vez, com seletor (começa no grupo de quem
 * está vendo); a partir de 768 px, todos os grupos, um abaixo do outro.
 */
export function GroupTable({ groups, matchType, participantHeader, highlightRegistrationId, drawSeed, className }: GroupTableProps) {
  const mineIndex = highlightRegistrationId ? groups.findIndex((g) => g.rows.some((r) => r.registrationId === highlightRegistrationId)) : -1;
  const [picked, setPicked] = useState<string | null>(null);
  const keyOf = (g: Standings['groups'][number], i: number) => g.groupId ?? `grupo-${i}`;
  const fallback = groups[Math.max(0, mineIndex)];
  const selected = picked !== null && groups.some((g, i) => keyOf(g, i) === picked) ? picked : fallback ? keyOf(fallback, Math.max(0, mineIndex)) : '';
  const Table = matchType === 'BATTLE_ROYALE' ? BRStandingsTable : StandingsTable;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {groups.length > 1 && (
        <Select
          label="Grupo"
          className="md:hidden"
          value={selected}
          onChange={(e) => setPicked(e.target.value)}
          options={groups.map((g, i) => ({ value: keyOf(g, i), label: `${g.name}${i === mineIndex ? ' (o seu)' : ''}` }))}
        />
      )}
      {groups.map((g, i) => {
        const key = keyOf(g, i);
        return (
          <section key={key} className={cn('flex-col gap-2', key === selected ? 'flex' : 'hidden md:flex')} aria-label={g.name} data-group={key}>
            <h4 className="text-base">{g.name}</h4>
            <Table rows={g.rows} caption={`Classificação: ${g.name}`} participantHeader={participantHeader} highlightRegistrationId={highlightRegistrationId} drawSeed={drawSeed} />
          </section>
        );
      })}
    </div>
  );
}
