'use client';

import type { StandingRow } from '@nova/schemas';
import { RankTable, type RankColumn, type RankRow } from './RankTable';

/** "desistiu", "desclassificado", "eliminado" ou nada. */
export function outLabel(row: Pick<StandingRow, 'status' | 'eliminated'>): string | null {
  if (row.status === 'WITHDRAWN') return 'desistiu';
  if (row.status === 'DISQUALIFIED') return 'desclassificado';
  if (row.eliminated) return 'eliminado';
  return null;
}

export function toRankRow(row: StandingRow): RankRow & { source: StandingRow } {
  return { key: row.registrationId, position: row.position, name: row.name, tag: row.tag, qualifying: row.qualifying, out: outLabel(row), tiebreakNote: row.tiebreakNote, points: row.points, source: row };
}

type DuelRow = ReturnType<typeof toRankRow>;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

const DUEL_COLUMNS: RankColumn<DuelRow>[] = [
  { key: 'played', header: 'J', label: 'Jogos', cell: (r) => r.source.played },
  { key: 'wins', header: 'V', label: 'Vitórias', cell: (r) => r.source.wins },
  { key: 'draws', header: 'E', label: 'Empates', cell: (r) => r.source.draws },
  { key: 'losses', header: 'D', label: 'Derrotas', cell: (r) => r.source.losses },
  { key: 'diff', header: 'Saldo', label: 'Saldo', cell: (r) => signed(r.source.scoreDiff), width: 'md:w-16' },
];

export interface StandingsTableProps {
  rows: StandingRow[];
  caption: string;
  /** "Equipe" (padrão) ou "Participante". */
  nameHeader?: string;
  highlightRegistrationId?: string | null;
  version?: unknown;
}

/** Classificação de duelos (pontos corridos, grupos, suíço): Pos, Equipe, J, V, E, D, Saldo, Pts. */
export function StandingsTable({ rows, caption, nameHeader = 'Equipe', highlightRegistrationId, version }: StandingsTableProps) {
  return <RankTable caption={caption} nameHeader={nameHeader} rows={rows.map(toRankRow)} columns={DUEL_COLUMNS} highlightKey={highlightRegistrationId} version={version} />;
}
