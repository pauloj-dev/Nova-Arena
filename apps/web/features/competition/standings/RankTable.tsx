'use client';

import { Badge, cn } from '@nova/ui';
import { ArrowUpCircle, ChevronDown, Info } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Fragment, useId, useRef, useState, type ReactNode } from 'react';
import { useFlip } from './useFlip';

/** Uma linha genérica: duelo e BR usam a mesma casca (cabeçalho fixo, zona, desempate, celular). */
export interface RankRow {
  key: string;
  position: number | null;
  name: string;
  tag: string | null;
  qualifying: boolean;
  /** Fora da disputa (eliminado, desistiu, desclassificado, ausente). */
  out: string | null;
  tiebreakNote: string | null;
  points: number;
}

export interface RankColumn<R extends RankRow> {
  key: string;
  /** Texto curto no cabeçalho (ex.: "V"). */
  header: string;
  /** Nome completo, lido pelo leitor de tela e no `title` (ex.: "Vitórias"). */
  label: string;
  cell: (row: R) => ReactNode;
  /** Largura no desktop (padrão `md:w-12`). O nome fica com o que sobrar. */
  width?: string;
}

export interface RankTableProps<R extends RankRow> {
  caption: string;
  /** "Equipe", "Squad" ou "Participante". */
  nameHeader: string;
  rows: R[];
  /** Colunas entre o nome e os pontos. No celular elas vão para a linha expansível. */
  columns: RankColumn<R>[];
  highlightKey?: string | null;
  /** Muda quando a classificação é recalculada (dispara a animação de troca de posição). */
  version?: unknown;
}

function PositionCell({ row }: { row: RankRow }) {
  const content = (
    <span className="flex items-center gap-1">
      {row.qualifying && <ArrowUpCircle className="size-4 shrink-0 text-primary-text" aria-hidden />}
      <span className="tabular font-semibold">{row.position ?? '–'}</span>
    </span>
  );
  const zone = row.qualifying ? <span className="sr-only">, zona de classificação</span> : null;
  if (!row.tiebreakNote) {
    return (
      <>
        {content}
        {zone}
      </>
    );
  }
  return (
    <Popover.Root>
      <Popover.Trigger
        className="-mx-1 flex min-h-11 items-center gap-1 rounded-md px-1 underline decoration-dotted underline-offset-4 hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-accent md:min-h-8"
        aria-label={`${row.position}º lugar${row.qualifying ? ', zona de classificação' : ''}. Ver como foi o desempate`}
      >
        {content}
        <Info className="size-3.5 shrink-0 text-muted" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="start" sideOffset={6} collisionPadding={16} className="z-50 max-w-72 rounded-lg border border-border bg-surface p-3 text-sm shadow-lg animate-fade-in">
          <p className="font-semibold">Por que {row.name} está em {row.position}º?</p>
          <p className="mt-1 text-muted">{row.tiebreakNote}</p>
          <Popover.Arrow className="fill-surface" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function NameCell({ row, mine }: { row: RankRow; mine: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className={cn('min-w-0 truncate', row.out ? 'text-muted' : 'font-medium')} title={row.name}>
        {row.name}
      </span>
      {row.tag && <span className="tabular hidden shrink-0 text-xs text-muted xs:inline">[{row.tag}]</span>}
      {mine && (
        <Badge tone="accent" className="shrink-0">
          Você
        </Badge>
      )}
      {row.out && <span className="shrink-0 text-xs text-muted">({row.out})</span>}
    </span>
  );
}

const th = 'sticky top-14 z-10 border-b border-border bg-surface-2 px-2 py-2 text-xs font-semibold text-muted md:top-16 md:px-3';
const td = 'px-2 py-2 md:px-3';

/**
 * Tabela de classificação: cabeçalho fixo ao rolar, zona de classificação (cor + ícone + texto),
 * explicação do desempate ao tocar na posição e, no celular, só Pos, Equipe e Pts com linha expansível.
 */
export function RankTable<R extends RankRow>({ caption, nameHeader, rows, columns, highlightKey, version }: RankTableProps<R>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const baseId = useId();
  useFlip(bodyRef, version ?? rows.map((r) => r.key).join('|'));

  const toggle = (key: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const hasZone = rows.some((r) => r.qualifying);
  const hasTiebreak = rows.some((r) => r.tiebreakNote);

  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed border-separate border-spacing-0 rounded-lg border border-border text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(th, 'w-16 rounded-tl-lg text-left')}>
              <abbr title="Posição" className="no-underline">
                Pos
              </abbr>
            </th>
            <th scope="col" className={cn(th, 'text-left')}>
              {nameHeader}
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn(th, 'hidden text-right md:table-cell', c.width ?? 'md:w-12')}>
                <abbr title={c.label} className="no-underline">
                  {c.header}
                </abbr>
              </th>
            ))}
            <th scope="col" className={cn(th, 'w-14 text-right md:rounded-tr-lg')}>
              <abbr title="Pontos" className="no-underline">
                Pts
              </abbr>
            </th>
            <th scope="col" className={cn(th, 'w-12 rounded-tr-lg md:hidden')}>
              <span className="sr-only">Detalhes</span>
            </th>
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((row, index) => {
            const mine = Boolean(highlightKey) && row.key === highlightKey;
            const expanded = open.has(row.key);
            const detailId = `${baseId}-${index}`;
            const last = index === rows.length - 1;
            const border = last && !expanded ? '' : 'border-b border-border';
            const rowTone = mine ? 'bg-accent-soft' : row.qualifying ? 'bg-primary-soft/60' : '';
            return (
              <Fragment key={row.key}>
                <tr data-flip-key={row.key} className={cn('relative', rowTone)} aria-current={mine ? 'true' : undefined}>
                  <td className={cn(td, border, 'border-l-4', row.qualifying ? 'border-l-accent' : 'border-l-transparent', last && !expanded && 'rounded-bl-lg')}>
                    <PositionCell row={row} />
                  </td>
                  <th scope="row" className={cn(td, border, 'text-left font-normal')}>
                    <NameCell row={row} mine={mine} />
                  </th>
                  {columns.map((c) => (
                    <td key={c.key} className={cn(td, border, 'tabular hidden text-right md:table-cell')}>
                      {c.cell(row)}
                    </td>
                  ))}
                  <td className={cn(td, border, 'tabular text-right font-bold md:rounded-br-lg')}>{row.points}</td>
                  <td className={cn(border, 'pr-1 text-right md:hidden', last && !expanded && 'rounded-br-lg')}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-expanded={expanded}
                      aria-controls={detailId}
                      aria-label={`${expanded ? 'Esconder' : 'Ver'} detalhes de ${row.name}`}
                      className="inline-flex size-11 items-center justify-center rounded-md text-muted hover:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
                    </button>
                  </td>
                </tr>
                <tr id={detailId} hidden={!expanded} className={cn('md:hidden', rowTone)}>
                  <td colSpan={4} className={cn('px-3 pb-3', !last && 'border-b border-border')}>
                    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs xs:grid-cols-4">
                      {columns.map((c) => (
                        <div key={c.key} className="flex flex-col">
                          <dt className="text-muted">{c.label}</dt>
                          <dd className="tabular font-semibold">{c.cell(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {(hasZone || hasTiebreak) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda">
          {hasZone && (
            <li className="flex items-center gap-1">
              <ArrowUpCircle className="size-3.5 text-primary-text" aria-hidden />
              Zona de classificação: avança para a próxima fase
            </li>
          )}
          {hasTiebreak && (
            <li className="flex items-center gap-1">
              <Info className="size-3.5" aria-hidden />
              Toque na posição para ver o desempate
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
