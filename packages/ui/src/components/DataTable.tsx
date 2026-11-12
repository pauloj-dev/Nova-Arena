'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Skeleton } from './Surface';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** Aparece no cartão do celular como título (a primeira coluna com `primary`). */
  primary?: boolean;
  /** Esconde a coluna no cartão do celular. */
  hideOnMobile?: boolean;
  className?: string;
}

export interface SortState {
  id: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  empty?: ReactNode;
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Paginação no servidor. */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  total?: number;
  /** Seleção para ações em lote. */
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  className?: string;
}

const alignClass = { left: 'text-left', right: 'text-right', center: 'text-center' };

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  loading,
  empty,
  sort,
  onSortChange,
  page,
  pageCount,
  onPageChange,
  total,
  selected,
  onSelectedChange,
  bulkActions,
  rowActions,
  className,
}: DataTableProps<T>) {
  const selectable = Boolean(onSelectedChange);
  const sel = selected ?? [];
  const allIds = rows.map(getRowId);
  const allSelected = allIds.length > 0 && allIds.every((id) => sel.includes(id));

  function toggleSort(id: string) {
    if (!onSortChange) return;
    if (sort?.id !== id) onSortChange({ id, dir: 'asc' });
    else if (sort.dir === 'asc') onSortChange({ id, dir: 'desc' });
    else onSortChange(null);
  }
  function toggleRow(id: string) {
    onSelectedChange?.(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {selectable && sel.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent-soft-text" role="status">
          <span className="font-semibold">
            {sel.length} selecionado{sel.length > 1 ? 's' : ''}
          </span>
          {bulkActions}
        </div>
      )}

      {/* Tabela: a partir de 768 px */}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              {selectable && (
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas as linhas"
                    checked={allSelected}
                    onChange={() => onSelectedChange?.(allSelected ? [] : allIds)}
                    className="size-4 accent-(--accent)"
                  />
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.id === c.id;
                const Icon = !active ? ArrowUpDown : sort?.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-3 py-2 font-semibold text-muted', alignClass[c.align ?? 'left'], c.className)}
                  >
                    {c.sortable && onSortChange ? (
                      <button type="button" onClick={() => toggleSort(c.id)} className="inline-flex items-center gap-1 rounded-sm hover:text-text">
                        {c.header}
                        <Icon className="size-3.5" aria-hidden />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowActions && (
                <th scope="col" className="px-3 py-2 text-right font-semibold text-muted">
                  Ações
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-border">
                  <td colSpan={columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} className="px-3 py-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))}
            {!loading &&
              rows.map((row) => {
                const id = getRowId(row);
                return (
                  <tr key={id} className={cn('border-t border-border', sel.includes(id) && 'bg-accent-soft/40')}>
                    {selectable && (
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label="Selecionar linha" checked={sel.includes(id)} onChange={() => toggleRow(id)} className="size-4 accent-(--accent)" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.id} className={cn('px-3 py-2 align-middle', alignClass[c.align ?? 'left'], c.className)}>
                        {c.cell(row)}
                      </td>
                    ))}
                    {rowActions && <td className="px-3 py-2 text-right">{rowActions(row)}</td>}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Cartões: celular */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
        {loading && Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        {!loading &&
          rows.map((row) => {
            const id = getRowId(row);
            return (
              <li key={id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 font-semibold text-text">{primary?.cell(row)}</div>
                  {selectable && (
                    <input type="checkbox" aria-label="Selecionar" checked={sel.includes(id)} onChange={() => toggleRow(id)} className="mt-1 size-5 accent-(--accent)" />
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {columns
                    .filter((c) => c !== primary && !c.hideOnMobile)
                    .map((c) => (
                      <div key={c.id} className="min-w-0">
                        <dt className="text-xs text-muted">{c.header}</dt>
                        <dd className="truncate">{c.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
                {rowActions && <div className="mt-3 flex flex-wrap gap-2">{rowActions(row)}</div>}
              </li>
            );
          })}
      </ul>

      {showEmpty && (empty ?? <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">Nada por aqui ainda.</p>)}

      {page !== undefined && pageCount !== undefined && pageCount > 1 && (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Paginação">
          <span className="text-muted">
            Página {page} de {pageCount}
            {total !== undefined && ` · ${total} no total`}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)} iconLeft={<ChevronLeft className="size-4" aria-hidden />}>
              Anterior
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => onPageChange?.(page + 1)} iconRight={<ChevronRight className="size-4" aria-hidden />}>
              Próxima
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
