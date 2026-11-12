'use client';

import type { StandingRow } from '@nova/schemas';
import { Tabs } from '@nova/ui';
import { useState } from 'react';
import { RankTable, type RankColumn, type RankRow } from './RankTable';
import { outLabel } from './StandingsTable';

interface BRRow extends RankRow {
  booyahs: number;
  kills: number;
}

const COLUMNS: RankColumn<BRRow>[] = [
  { key: 'booyahs', header: 'Booyahs', label: 'Booyahs', cell: (r) => r.booyahs, width: 'md:w-20' },
  { key: 'kills', header: 'Kills', label: 'Kills', cell: (r) => r.kills, width: 'md:w-16' },
];

/** Linhas do acumulado: a ordem e o desempate vêm do motor. */
export function accumulatedRows(rows: StandingRow[]): BRRow[] {
  return rows.map((r) => ({
    key: r.registrationId,
    position: r.position,
    name: r.name,
    tag: r.tag,
    qualifying: r.qualifying,
    out: outLabel(r),
    tiebreakNote: r.tiebreakNote,
    points: r.points,
    booyahs: r.booyahs,
    kills: r.kills,
  }));
}

/** Linhas de uma queda: ordenadas pela colocação na queda; quem não jogou vai para o fim como "ausente". */
export function dropRows(rows: StandingRow[], dropIndex: number): BRRow[] {
  return rows
    .map((r) => {
      const drop = r.perDrop.find((d) => d.dropIndex === dropIndex);
      return {
        key: r.registrationId,
        position: drop?.placement ?? null,
        name: r.name,
        tag: r.tag,
        qualifying: false,
        out: drop && drop.placement == null ? 'ausente' : outLabel(r),
        tiebreakNote: null,
        points: drop?.points ?? 0,
        booyahs: drop?.placement === 1 ? 1 : 0,
        kills: drop?.kills ?? 0,
      };
    })
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || b.points - a.points);
}

export function dropIndexes(rows: StandingRow[]): number[] {
  return [...new Set(rows.flatMap((r) => r.perDrop.map((d) => d.dropIndex)))].sort((a, b) => a - b);
}

export interface BRDropTableProps {
  rows: StandingRow[];
  caption: string;
  /** "Squad" (padrão), "Equipe" ou "Jogador". */
  nameHeader?: string;
  highlightRegistrationId?: string | null;
  version?: unknown;
}

/** Battle Royale: acumulado e por queda — Pos, Squad, Booyahs, Kills, Pts. */
export function BRDropTable({ rows, caption, nameHeader = 'Squad', highlightRegistrationId, version }: BRDropTableProps) {
  const drops = dropIndexes(rows);
  const [view, setView] = useState('total');

  if (drops.length <= 1) {
    return <RankTable caption={caption} nameHeader={nameHeader} rows={accumulatedRows(rows)} columns={COLUMNS} highlightKey={highlightRegistrationId} version={version} />;
  }
  return (
    <Tabs
      label={`Visão da tabela: ${caption}`}
      value={view}
      onValueChange={setView}
      items={[
        {
          value: 'total',
          label: 'Acumulado',
          content: <RankTable caption={`${caption} — acumulado`} nameHeader={nameHeader} rows={accumulatedRows(rows)} columns={COLUMNS} highlightKey={highlightRegistrationId} version={version} />,
        },
        ...drops.map((d) => ({
          value: `q${d}`,
          label: `Queda ${d}`,
          content: <RankTable caption={`${caption} — queda ${d}`} nameHeader={nameHeader} rows={dropRows(rows, d)} columns={COLUMNS} highlightKey={highlightRegistrationId} version={version} />,
        })),
      ]}
    />
  );
}
