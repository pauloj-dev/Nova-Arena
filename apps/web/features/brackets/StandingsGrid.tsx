'use client';

import type { StandingRow } from '@nova/schemas';
import { Badge, cn, StatusPill } from '@nova/ui';
import { ArrowUpCircle, ChevronDown, Info, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Fragment, useId, useState, type CSSProperties, type ReactNode } from 'react';
import { summarizeChanges } from './standingsText';
import { useFlip } from './useFlip';

/** Uma coluna do meio da tabela (entre a equipe e os pontos). Some no celular e vai para a linha expansível. */
export interface StandingsColumn {
  key: string;
  /** Cabeçalho curto ("J", "V", "Saldo"). */
  header: string;
  /** Nome por extenso, para leitores de tela e para a linha expansível ("Jogos"). */
  title: string;
  /** Classe de largura (`w-10`…). */
  width: string;
  cell: (row: StandingRow) => ReactNode;
  /** Como o valor aparece na linha expansível do celular. Padrão: o mesmo da célula. */
  detail?: (row: StandingRow) => ReactNode;
}

export interface StandingsGridProps {
  rows: StandingRow[];
  /** Nome acessível da tabela ("Classificação do Grupo A"). */
  caption: string;
  /** Cabeçalho da coluna do participante: "Equipe", "Squad" ou "Jogador". */
  participantHeader: string;
  columns: StandingsColumn[];
  /** Última coluna, sempre visível. */
  points: { header: string; title: string; cell: (row: StandingRow) => ReactNode };
  /** Itens extras da linha expansível do celular (ex.: cada queda). */
  extraDetails?: (row: StandingRow) => { label: string; value: ReactNode }[];
  highlightRegistrationId?: string | null;
  /** Seed do sorteio de desempate, quando houve (`standings.drawSeed`). */
  drawSeed?: string | null;
  /**
   * Largura mínima da tabela (em rem) a partir de 768 px, para tabelas com muitas colunas:
   * ela rola dentro da própria moldura em vez de espremer o nome do participante. No celular não vale
   * (as colunas do meio ficam na linha expansível).
   */
  minWidthRem?: number;
  className?: string;
}

const th = 'sticky top-14 z-10 border-b border-border bg-surface-2 px-2 py-2 text-xs font-semibold text-muted md:top-0';

/** Posição. Quando ela foi decidida por desempate, vira um botão que explica o critério (e a seed do sorteio). */
function PositionCell({ row, drawSeed }: { row: StandingRow; drawSeed?: string | null }) {
  if (!row.tiebreakNote) return <span className="tabular flex min-h-11 items-center justify-center px-1 md:min-h-9">{row.position}</span>;
  const byDraw = /sorteio/i.test(row.tiebreakNote);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${row.position}º lugar. Ver como o desempate foi decidido`}
          className="tabular flex min-h-11 w-full items-center justify-center gap-0.5 rounded-md px-1 underline decoration-dotted underline-offset-4 hover:bg-neutral-soft md:min-h-9"
        >
          {row.position}
          <Info className="size-3.5 shrink-0 text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-50 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 rounded-md border border-border bg-surface p-3 text-sm text-text shadow-lg" data-testid="tiebreak-popover">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">Como saiu o {row.position}º lugar</p>
            <Popover.Close aria-label="Fechar explicação" className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft">
              <X className="size-4" aria-hidden />
            </Popover.Close>
          </div>
          <p>{row.tiebreakNote}</p>
          {byDraw && drawSeed && (
            <p className="text-xs text-muted">
              Seed do sorteio: <code className="tabular break-all text-text">{drawSeed}</code>. Com ela o sorteio pode ser refeito e conferido.
            </p>
          )}
          <Popover.Arrow className="fill-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ParticipantCell({ row, mine }: { row: StandingRow; mine: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {row.qualifying && (
        <span className="flex shrink-0 items-center text-primary-soft-text">
          <ArrowUpCircle className="size-4" aria-hidden />
          <span className="sr-only">Classifica: </span>
        </span>
      )}
      <span className={cn('min-w-0 truncate', mine && 'font-bold')}>
        {row.name}
        {row.tag && <span className="tabular ml-1 text-xs text-muted">[{row.tag}]</span>}
      </span>
      {mine && <Badge tone="accent">Você</Badge>}
      {row.status !== 'ACTIVE' && <StatusPill status={row.status} />}
      {row.status === 'ACTIVE' && row.eliminated && <Badge tone="neutral">Eliminado</Badge>}
    </div>
  );
}

/**
 * Base das tabelas de classificação: cabeçalho fixo, zona de classificação destacada (fundo +
 * ícone + legenda), linha de quem está vendo em destaque, explicação do desempate na posição,
 * animação FLIP quando as posições mudam e anúncio resumido por `aria-live`.
 * No celular ficam só posição, participante e pontos; o resto vai para a linha expansível.
 */
export function StandingsGrid({ rows, caption, participantHeader, columns, points, extraDetails, highlightRegistrationId, drawSeed, minWidthRem, className }: StandingsGridProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const baseId = useId();
  const register = useFlip<HTMLTableRowElement>(rows.map((r) => r.registrationId));

  // Guarda a versão anterior para dizer o que mudou (padrão "ajustar estado durante o render").
  const signature = rows.map((r) => `${r.registrationId}:${r.position}:${r.points}`).join('|');
  const [seen, setSeen] = useState({ signature, rows, message: '' });
  if (seen.signature !== signature) setSeen({ signature, rows, message: summarizeChanges(seen.rows, rows, highlightRegistrationId) });

  const anyQualifying = rows.some((r) => r.qualifying);
  const anyTiebreak = rows.some((r) => r.tiebreakNote);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="rounded-lg border border-border bg-surface md:max-h-[40rem] md:overflow-auto" data-testid="standings-table">
        <table
          className={cn('w-full table-fixed border-separate border-spacing-0 text-sm', minWidthRem !== undefined && 'md:min-w-[var(--table-min)]')}
          style={minWidthRem !== undefined ? ({ '--table-min': `${minWidthRem}rem` } as CSSProperties) : undefined}
        >
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'w-14 rounded-tl-lg text-center')}>
                <abbr title="Posição" className="no-underline">
                  Pos
                </abbr>
              </th>
              <th scope="col" className={cn(th, 'text-left')}>
                {participantHeader}
              </th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn(th, c.width, 'hidden text-right md:table-cell')}>
                  <abbr title={c.title} className="no-underline">
                    {c.header}
                  </abbr>
                </th>
              ))}
              <th scope="col" className={cn(th, 'w-14 text-right md:rounded-tr-lg')}>
                <abbr title={points.title} className="no-underline">
                  {points.header}
                </abbr>
              </th>
              <th scope="col" className={cn(th, 'w-11 rounded-tr-lg md:hidden')}>
                <span className="sr-only">Mais números</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mine = row.registrationId === highlightRegistrationId;
              const open = expanded === row.registrationId;
              const detailId = `${baseId}-${row.registrationId}`;
              const out = row.status !== 'ACTIVE';
              const cell = 'border-b border-border px-2 py-0.5';
              const details = [...columns.map((c) => ({ label: c.title, value: (c.detail ?? c.cell)(row) })), ...(extraDetails?.(row) ?? [])];
              return (
                <Fragment key={row.registrationId}>
                  <tr
                    ref={register(row.registrationId)}
                    data-registration-id={row.registrationId}
                    data-qualifying={row.qualifying ? 'true' : undefined}
                    data-mine={mine ? 'true' : undefined}
                    className={cn(row.qualifying && 'bg-primary-soft', mine && !row.qualifying && 'bg-accent-soft', out && 'text-muted')}
                  >
                    <td className={cn(cell, 'px-1 text-center', mine && 'border-l-4 border-l-accent')}>
                      <PositionCell row={row} drawSeed={drawSeed} />
                    </td>
                    <th scope="row" className={cn(cell, 'text-left font-medium')}>
                      <ParticipantCell row={row} mine={mine} />
                    </th>
                    {columns.map((c) => (
                      <td key={c.key} className={cn(cell, 'tabular hidden text-right md:table-cell')}>
                        {c.cell(row)}
                      </td>
                    ))}
                    <td className={cn(cell, 'tabular text-right text-base')} data-col="points">
                      {points.cell(row)}
                    </td>
                    <td className={cn(cell, 'px-0 md:hidden')}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={detailId}
                        aria-label={`${open ? 'Esconder' : 'Ver'} os números de ${row.name}`}
                        onClick={() => setExpanded(open ? null : row.registrationId)}
                        className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-neutral-soft"
                      >
                        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr id={detailId} className="md:hidden">
                      <td colSpan={4} className="border-b border-border bg-surface-2 px-3 py-2">
                        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                          {details.map((d) => (
                            <div key={d.label} className="min-w-0">
                              <dt className="truncate text-muted">{d.label}</dt>
                              <dd className="tabular text-sm">{d.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(anyQualifying || anyTiebreak) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
          {anyQualifying && (
            <li className="flex items-center gap-1.5">
              <span className="flex size-5 items-center justify-center rounded bg-primary-soft text-primary-soft-text">
                <ArrowUpCircle className="size-3.5" aria-hidden />
              </span>
              Classifica para a próxima fase
            </li>
          )}
          {anyTiebreak && (
            <li className="flex items-center gap-1.5">
              <Info className="size-3.5" aria-hidden />
              Toque na posição para ver como o desempate foi decidido
            </li>
          )}
        </ul>
      )}

      {/* Anúncio discreto para leitores de tela quando a tabela muda sozinha. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="standings-announcement">
        {seen.message}
      </p>
    </div>
  );
}
