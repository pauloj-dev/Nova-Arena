'use client';

import type { Standings } from '@nova/schemas';
import { cn } from '@nova/ui';
import { Crosshair } from 'lucide-react';
import { BRStandingsTable } from './BRStandingsTable';
import { GroupTable } from './GroupTable';
import { StandingsTable } from './StandingsTable';

export interface MvpRankingProps {
  mvp: Standings['mvp'];
  /** Quantos jogadores mostrar. Padrão: 10. */
  limit?: number;
  className?: string;
}

/** Ranking de MVP da fase: kills por jogador (RN-03), quando a organização lança por jogador. */
export function MvpRanking({ mvp, limit = 10, className }: MvpRankingProps) {
  if (mvp.length === 0) return null;
  return (
    <section className={cn('flex flex-col gap-2', className)} aria-labelledby="mvp-title">
      <h4 id="mvp-title" className="flex items-center gap-1.5 text-base">
        <Crosshair className="size-4 text-muted" aria-hidden />
        Ranking de MVP
      </h4>
      <ol className="flex flex-col rounded-lg border border-border bg-surface" aria-label="Jogadores com mais kills">
        {mvp.slice(0, limit).map((player, i) => (
          <li key={player.userId} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0">
            <span className="tabular w-6 shrink-0 text-center text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{player.nickname}</span>
              {player.teamName && <span className="block truncate text-xs text-muted">{player.teamName}</span>}
            </span>
            <span className="tabular shrink-0">
              {player.kills} <span className="font-sans text-xs font-normal text-muted">kills</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export interface StageStandingsProps {
  standings: Standings;
  /** "Equipe", "Squad" ou "Jogador". Padrão: "Squad" em Battle Royale, "Equipe" nos demais. */
  participantHeader?: string;
  highlightRegistrationId?: string | null;
  className?: string;
}

/**
 * A classificação de uma fase, do jeito certo para o formato: uma tabela por grupo quando há
 * grupos, tabela de Battle Royale (acumulado / por queda) ou de duelos, e o ranking de MVP.
 */
export function StageStandings({ standings, participantHeader, highlightRegistrationId, className }: StageStandingsProps) {
  const drawSeed = standings.drawUsed ? standings.drawSeed : null;
  const header = participantHeader ?? (standings.matchType === 'BATTLE_ROYALE' ? 'Squad' : 'Equipe');
  const Table = standings.matchType === 'BATTLE_ROYALE' ? BRStandingsTable : StandingsTable;
  const grouped = standings.groups.length > 1;
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {grouped ? (
        <GroupTable groups={standings.groups} matchType={standings.matchType} participantHeader={header} highlightRegistrationId={highlightRegistrationId} drawSeed={drawSeed} />
      ) : (
        <Table rows={standings.overall} caption="Classificação da fase" participantHeader={header} highlightRegistrationId={highlightRegistrationId} drawSeed={drawSeed} />
      )}
      <MvpRanking mvp={standings.mvp} />
    </div>
  );
}
