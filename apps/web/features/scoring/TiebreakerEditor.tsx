'use client';

import type { Tiebreaker } from '@nova/schemas';
import { Switch } from '@nova/ui';
import { AlertCircle } from 'lucide-react';
import type { DescribeOptions } from './describe';
import { SortableItem, SortableList } from './Sortable';
import { ALL_TIEBREAKERS, isFixedTiebreaker, moveTiebreaker, normalizeTiebreakers, tiebreakerHint, tiebreakerLabel, tiebreakersFor, toggleTiebreaker } from './tiebreakers';

interface TiebreakerEditorProps {
  value: Tiebreaker[];
  onChange: (value: Tiebreaker[]) => void;
  describe: DescribeOptions;
  errors?: string[];
}

/**
 * Ordem dos critérios de desempate (PRD §10.6). Os ligados ficam em cima, na ordem em que valem;
 * "pontos" é sempre o primeiro e "sorteio", quando ligado, o último. Para ligar, aparecem só os
 * critérios que fazem sentido no tipo de partida; um critério já ligado nunca some sozinho.
 */
export function TiebreakerEditor({ value, onChange, describe, errors = [] }: TiebreakerEditorProps) {
  const enabled = normalizeTiebreakers(value);
  const offered = describe.matchType ? tiebreakersFor(describe.matchType) : ALL_TIEBREAKERS;
  const disabled = offered.filter((t) => !enabled.includes(t));
  const label = (id: string) => tiebreakerLabel(id as Tiebreaker, describe);

  return (
    <div className="flex flex-col gap-3">
      <SortableList
        ids={enabled}
        itemName={label}
        isLocked={(id) => isFixedTiebreaker(id as Tiebreaker)}
        onMove={(from, to) => {
          const moved = enabled[from];
          if (moved) onChange(moveTiebreaker(enabled, moved, to));
        }}
        aria-label="Critérios de desempate em uso, na ordem em que valem"
      >
        {enabled.map((tiebreaker, i) => (
          <SortableItem key={tiebreaker} id={tiebreaker} compact>
            {(controls) => (
              <div className="flex items-center gap-1 px-3">
                <Switch
                  className="min-w-0 flex-1"
                  label={`${i + 1}. ${label(tiebreaker)}`}
                  hint={tiebreakerHint(tiebreaker, describe.matchType) ?? undefined}
                  checked
                  disabled={tiebreaker === 'points'}
                  onCheckedChange={(on) => onChange(toggleTiebreaker(enabled, tiebreaker, on))}
                />
                {controls}
              </div>
            )}
          </SortableItem>
        ))}
      </SortableList>

      {disabled.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Critérios de desempate desligados">
          {disabled.map((tiebreaker) => (
            <li key={tiebreaker} className="rounded-lg border border-dashed border-border-strong px-3">
              <Switch
                label={<span className="text-muted">{label(tiebreaker)}</span>}
                hint={tiebreakerHint(tiebreaker) ?? undefined}
                checked={false}
                onCheckedChange={(on) => onChange(toggleTiebreaker(enabled, tiebreaker, on))}
              />
            </li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-xs font-medium text-danger">
          {errors.map((message) => (
            <li key={message} className="flex items-start gap-1">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
