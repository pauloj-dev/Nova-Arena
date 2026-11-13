'use client';

import type { StandingRow } from '@nova/schemas';
import { StandingsGrid, type StandingsColumn } from './StandingsGrid';
import { formatDiff, formatPoints } from './standingsText';

export interface StandingsTableProps {
  /** Linhas já na ordem da API (a tela não reordena: o desempate é do servidor). */
  rows: StandingRow[];
  /** Nome acessível da tabela. */
  caption: string;
  /** Cabeçalho da coluna do participante. Padrão: "Equipe". */
  participantHeader?: string;
  /** Inscrição de quem está vendo: a linha dela fica destacada. */
  highlightRegistrationId?: string | null;
  /** Seed do sorteio de desempate (`standings.drawSeed`), mostrada na explicação quando houve sorteio. */
  drawSeed?: string | null;
  className?: string;
}

const DUEL_COLUMNS: StandingsColumn[] = [
  { key: 'played', header: 'J', title: 'Jogos', width: 'w-10', cell: (r) => r.played },
  { key: 'wins', header: 'V', title: 'Vitórias', width: 'w-10', cell: (r) => r.wins },
  { key: 'draws', header: 'E', title: 'Empates', width: 'w-10', cell: (r) => r.draws },
  { key: 'losses', header: 'D', title: 'Derrotas', width: 'w-10', cell: (r) => r.losses },
  { key: 'diff', header: 'Saldo', title: 'Saldo', width: 'w-16', cell: (r) => formatDiff(r.scoreDiff) },
];

/** Classificação de duelos: Pos, Equipe, J, V, E, D, Saldo e Pts. */
export function StandingsTable({ rows, caption, participantHeader = 'Equipe', highlightRegistrationId, drawSeed, className }: StandingsTableProps) {
  return (
    <StandingsGrid
      rows={rows}
      caption={caption}
      participantHeader={participantHeader}
      columns={DUEL_COLUMNS}
      points={{ header: 'Pts', title: 'Pontos', cell: (r) => formatPoints(r.points) }}
      extraDetails={(r) => [{ label: 'Pró / contra', value: `${r.scoreFor} / ${r.scoreAgainst}` }]}
      highlightRegistrationId={highlightRegistrationId}
      drawSeed={drawSeed}
      className={className}
    />
  );
}
