'use client';

import type { StandingRow, Standings } from '@nova/schemas';
import { cn, StatusPill } from '@nova/ui';
import { ArrowUpCircle } from 'lucide-react';
import { formatDiff, formatPoints } from '@/features/brackets/standingsText';
import { useFlip } from '@/features/brackets/useFlip';
import type { StandingsPage } from './telao';

interface Column {
  id: string;
  header: string;
  /** Nome completo para leitor de tela quando o cabeçalho é abreviado. */
  title?: string;
  cell: (row: StandingRow) => string | number;
}

function columnsFor(matchType: Standings['matchType']): Column[] {
  if (matchType === 'BATTLE_ROYALE') {
    return [
      { id: 'played', header: 'Quedas', cell: (r) => r.played },
      { id: 'booyahs', header: 'Booyahs', cell: (r) => r.booyahs },
      { id: 'kills', header: 'Kills', cell: (r) => r.kills },
    ];
  }
  return [
    { id: 'played', header: 'J', title: 'Jogos', cell: (r) => r.played },
    { id: 'wins', header: 'V', title: 'Vitórias', cell: (r) => r.wins },
    { id: 'draws', header: 'E', title: 'Empates', cell: (r) => r.draws },
    { id: 'losses', header: 'D', title: 'Derrotas', cell: (r) => r.losses },
    { id: 'diff', header: 'Saldo', cell: (r) => formatDiff(r.scoreDiff) },
  ];
}

export interface TelaoStandingsProps {
  page: StandingsPage;
  matchType: Standings['matchType'];
  transparent: boolean;
}

/** Classificação em fonte grande. Linhas que trocam de posição deslizam (sem animação com menos movimento). */
export function TelaoStandings({ page, matchType, transparent }: TelaoStandingsProps) {
  const register = useFlip<HTMLTableRowElement>(page.rows.map((r) => r.registrationId));
  const columns = columnsFor(matchType);
  const participant = matchType === 'BATTLE_ROYALE' ? 'Squad' : 'Participante';
  const anyQualifying = page.rows.some((r) => r.qualifying);

  return (
    <div className={cn('flex flex-col gap-3', transparent && 'rounded-xl bg-surface/90 p-3 shadow-lg')}>
      <table className="w-full table-fixed border-separate border-spacing-y-1.5 text-lg md:text-2xl xl:text-3xl" data-testid="telao-tabela">
        <caption className="sr-only">{`Classificação · ${page.label}`}</caption>
        <thead>
          <tr className="text-left text-sm uppercase tracking-wide text-muted md:text-base xl:text-lg">
            <th scope="col" className="w-16 px-3 py-1 md:w-24">
              Pos.
            </th>
            <th scope="col" className="px-3 py-1">
              {participant}
            </th>
            {columns.map((c) => (
              <th key={c.id} scope="col" className="hidden w-24 px-3 py-1 text-right md:table-cell xl:w-32">
                {c.title ? <abbr title={c.title} className="no-underline">{c.header}</abbr> : c.header}
              </th>
            ))}
            <th scope="col" className="w-20 px-3 py-1 text-right md:w-32">
              Pontos
            </th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => {
            const out = row.status !== 'ACTIVE' || row.eliminated;
            return (
              <tr key={row.registrationId} ref={register(row.registrationId)} data-testid="telao-linha" data-registration={row.registrationId} className={cn('bg-surface', out && 'text-muted')}>
                <td className={cn('rounded-l-lg border-l-4 px-3 py-2 font-bold md:py-3', row.qualifying ? 'border-accent' : 'border-transparent')}>
                  <span className="tabular">{row.position}º</span>
                </td>
                <td className="px-3 py-2 md:py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-semibold">{row.name}</span>
                    {row.tag && <span className="tabular shrink-0 text-base text-muted md:text-xl">[{row.tag}]</span>}
                    {row.qualifying && (
                      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent-soft-text md:text-base">
                        <ArrowUpCircle className="size-5" aria-hidden />
                        <span className="hidden lg:inline">Classifica</span>
                        <span className="sr-only lg:hidden">Classifica</span>
                      </span>
                    )}
                    {row.status !== 'ACTIVE' && <StatusPill status={row.status} className="shrink-0" />}
                  </span>
                </td>
                {columns.map((c) => (
                  <td key={c.id} className="tabular hidden px-3 py-2 text-right md:table-cell md:py-3">
                    {c.cell(row)}
                  </td>
                ))}
                <td className="tabular rounded-r-lg px-3 py-2 text-right font-bold md:py-3">{formatPoints(row.points)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anyQualifying && (
        <p className="flex items-center gap-2 text-base text-muted md:text-lg">
          <ArrowUpCircle className="size-5 text-accent" aria-hidden />
          Zona de classificação para a próxima fase
        </p>
      )}
    </div>
  );
}
