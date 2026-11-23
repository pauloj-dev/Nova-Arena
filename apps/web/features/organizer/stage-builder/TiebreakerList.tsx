'use client';

import type { MatchType, Tiebreaker } from '@nova/schemas';
import { cn, Select } from '@nova/ui';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import { TIEBREAKER_SYNONYM, TIEBREAKERS_BY_MATCH_TYPE } from '../lib/formats';
import { useT } from '@/shared/i18n/react';
import { tiebreakerLabel } from '../lib/labels';
import { messages } from './messages';
import { moveItem, SortableList, useSortableRow } from './Sortable';

interface TiebreakerListProps {
  value: Tiebreaker[];
  onChange: (value: Tiebreaker[]) => void;
  matchType: MatchType;
  /** Nome da fase, para os rótulos dos botões. */
  stageName: string;
  disabled?: boolean;
}

const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-40 disabled:hover:bg-transparent md:size-9';

function Row({ tiebreaker, index, total, disabled, onMove, onRemove }: { tiebreaker: Tiebreaker; index: number; total: number; disabled?: boolean; onMove: (to: number) => void; onRemove: () => void }) {
  const { setNode, style, isDragging, handleProps } = useSortableRow(tiebreaker, disabled);
  const t = useT(messages, 'TiebreakerList');
  const label = tiebreakerLabel(tiebreaker);
  return (
    <li ref={setNode} style={style} className={cn('flex flex-wrap items-center gap-x-1 rounded-md border border-border bg-surface p-1', isDragging && 'shadow-md')}>
      <button type="button" className={cn(iconButton, 'cursor-grab touch-none active:cursor-grabbing')} aria-label={t('arrastar', { criterio: label })} disabled={disabled} {...handleProps}>
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="tabular w-6 shrink-0 text-center text-xs text-muted" aria-hidden>
        {t('ordinal', { n: index + 1 })}
      </span>
      <span className="min-w-0 flex-1 text-sm text-text">
        <span className="sr-only">{t('ordinalCriterio', { n: index + 1 })}</span>
        {label}
      </span>
      {/* No celular os botões descem para a segunda linha: o nome do critério não fica espremido. */}
      <span className="flex w-full justify-end md:w-auto">
        <button type="button" className={iconButton} aria-label={t('moverCima', { criterio: label })} disabled={disabled || index === 0} onClick={() => onMove(index - 1)}>
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t('moverBaixo', { criterio: label })} disabled={disabled || index === total - 1} onClick={() => onMove(index + 1)}>
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t('remover', { criterio: label })} disabled={disabled || total === 1} onClick={onRemove}>
          <X className="size-4" aria-hidden />
        </button>
      </span>
    </li>
  );
}

/** Ordem dos critérios de desempate da fase (PRD §10.6): arrastar ou usar os botões. */
export function TiebreakerList({ value, onChange, matchType, stageName, disabled }: TiebreakerListProps) {
  const t = useT(messages, 'TiebreakerList');
  const available = TIEBREAKERS_BY_MATCH_TYPE[matchType].filter((tb) => {
    const synonym = TIEBREAKER_SYNONYM[tb];
    return !value.includes(tb) && !(synonym && value.includes(synonym));
  });
  return (
    <div className="flex flex-col gap-2">
      <SortableList ids={value} labelOf={(id) => tiebreakerLabel(id as Tiebreaker)} onMove={(from, to) => onChange(moveItem(value, from, to))}>
        <ol className="flex flex-col gap-1.5" aria-label={t('listaAria', { fase: stageName })}>
          {value.map((tb, index) => (
            <Row key={tb} tiebreaker={tb} index={index} total={value.length} disabled={disabled} onMove={(to) => onChange(moveItem(value, index, to))} onRemove={() => onChange(value.filter((x) => x !== tb))} />
          ))}
        </ol>
      </SortableList>
      {available.length > 0 && !disabled && (
        <Select
          label={t('adicionar', { fase: stageName })}
          hideLabel
          value=""
          placeholder={t('adicionarPlaceholder')}
          options={available.map((tb) => ({ value: tb, label: tiebreakerLabel(tb) }))}
          onChange={(e) => {
            const tb = e.target.value as Tiebreaker;
            if (tb) onChange([...value, tb]);
          }}
        />
      )}
    </div>
  );
}
