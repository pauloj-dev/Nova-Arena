'use client';

import type { StandingRow } from '@nova/schemas';
import { cn } from '@nova/ui';
import { useState } from 'react';
import { StandingsGrid, type StandingsColumn } from './StandingsGrid';
import { formatPoints } from './standingsText';
import type { StandingsTableProps } from './StandingsTable';

export type BRStandingsMode = 'TOTAL' | 'PER_DROP';

export interface BRStandingsTableProps extends StandingsTableProps {
  /** Modo inicial. Padrão: acumulado. */
  defaultMode?: BRStandingsMode;
}

const TOTAL_COLUMNS: StandingsColumn[] = [
  { key: 'booyahs', header: 'Booyahs', title: 'Booyahs', width: 'w-20', cell: (r) => r.booyahs },
  { key: 'kills', header: 'Kills', title: 'Kills', width: 'w-16', cell: (r) => r.kills },
];

/** "2º · 9 K" de uma queda; "–" quando a equipe não jogou ou a queda ainda não tem resultado. */
function dropCell(row: StandingRow, dropIndex: number) {
  const drop = row.perDrop.find((d) => d.dropIndex === dropIndex);
  if (!drop) return <span className="text-muted">–</span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span>{formatPoints(drop.points)}</span>
      <span className="text-[11px] font-normal text-muted">{drop.placement === null ? 'ausente' : `${drop.placement}º · ${drop.kills} K`}</span>
    </span>
  );
}

function dropDetail(drop: StandingRow['perDrop'][number] | undefined): string {
  if (!drop) return '–';
  return drop.placement === null ? 'ausente' : `${drop.placement}º · ${drop.kills} kills · ${formatPoints(drop.points)} pts`;
}

/**
 * Tabela de Battle Royale (Pos, Squad, Booyahs, Kills, Pts) com alternância entre o acumulado
 * e o detalhe por queda (colocação, kills e pontos de cada queda, de `row.perDrop`).
 */
export function BRStandingsTable({ rows, caption, participantHeader = 'Squad', highlightRegistrationId, drawSeed, defaultMode = 'TOTAL', className }: BRStandingsTableProps) {
  const [mode, setMode] = useState<BRStandingsMode>(defaultMode);
  const drops = [...new Set(rows.flatMap((r) => r.perDrop.map((d) => d.dropIndex)))].sort((a, b) => a - b);
  const perDrop = mode === 'PER_DROP';

  const columns: StandingsColumn[] = perDrop ? drops.map((n) => ({ key: `q${n}`, header: `Q${n}`, title: `Queda ${n}`, width: 'w-20', cell: (r) => dropCell(r, n), detail: (r) => dropDetail(r.perDrop.find((d) => d.dropIndex === n)) })) : TOTAL_COLUMNS;
  const option = (value: BRStandingsMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => setMode(value)}
      className={cn('min-h-11 rounded-md px-3 text-sm font-semibold md:min-h-9', mode === value ? 'bg-accent text-on-accent' : 'text-muted hover:bg-neutral-soft hover:text-text')}
    >
      {label}
    </button>
  );

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div role="group" aria-label="Como ver a pontuação" className="flex gap-1 self-start rounded-lg border border-border bg-surface p-1">
        {option('TOTAL', 'Acumulado')}
        {option('PER_DROP', 'Por queda')}
      </div>
      {perDrop && drops.length === 0 && <p className="text-sm text-muted">Nenhuma queda tem resultado ainda. Os números por queda aparecem aqui assim que a primeira for lançada.</p>}
      <StandingsGrid
        rows={rows}
        caption={`${caption} (${perDrop ? 'por queda' : 'acumulado'})`}
        participantHeader={participantHeader}
        columns={columns}
        points={{ header: 'Pts', title: perDrop ? 'Total de pontos' : 'Pontos', cell: (r) => formatPoints(r.points) }}
        extraDetails={perDrop ? undefined : (r) => r.perDrop.map((d) => ({ label: `Queda ${d.dropIndex}`, value: dropDetail(d) }))}
        highlightRegistrationId={highlightRegistrationId}
        drawSeed={drawSeed}
        // Posição + nome (mínimo de 12rem) + 5rem por queda + pontos: com muitas quedas a tabela rola na própria moldura.
        minWidthRem={perDrop ? 19 + drops.length * 5 : undefined}
      />
    </div>
  );
}
