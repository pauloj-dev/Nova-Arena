'use client';

import type { StandingRow } from '@nova/schemas';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
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

/** Classificação de duelos: Pos, Equipe, J, V, E, D, Saldo e Pts. */
export function StandingsTable({ rows, caption, participantHeader, highlightRegistrationId, drawSeed, className }: StandingsTableProps) {
  const t = useT(messages, 'StandingsTable');
  const columns: StandingsColumn[] = [
    { key: 'played', header: t('jogosAbrev'), title: t('jogos'), width: 'w-10', cell: (r) => r.played },
    { key: 'wins', header: t('vitoriasAbrev'), title: t('vitorias'), width: 'w-10', cell: (r) => r.wins },
    { key: 'draws', header: t('empatesAbrev'), title: t('empates'), width: 'w-10', cell: (r) => r.draws },
    { key: 'losses', header: t('derrotasAbrev'), title: t('derrotas'), width: 'w-10', cell: (r) => r.losses },
    { key: 'diff', header: t('saldo'), title: t('saldo'), width: 'w-16', cell: (r) => formatDiff(r.scoreDiff) },
  ];
  return (
    <StandingsGrid
      rows={rows}
      caption={caption}
      participantHeader={participantHeader ?? t('equipe')}
      columns={columns}
      points={{ header: t('pontosAbrev'), title: t('pontos'), cell: (r) => formatPoints(r.points) }}
      extraDetails={(r) => [{ label: t('proContra'), value: `${r.scoreFor} / ${r.scoreAgainst}` }]}
      highlightRegistrationId={highlightRegistrationId}
      drawSeed={drawSeed}
      className={className}
    />
  );
}
