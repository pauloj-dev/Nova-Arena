'use client';

import type { MatchType, ScoringRule } from '@nova/schemas';
import { Select } from '@nova/ui';
import { useState } from 'react';
import { OUTCOME_OPTIONS, pts, signed, type DescribeOptions, type ExampleContext, type ExampleStats } from './describe';
import { NumberField } from './NumberField';
import { buildPreview } from './preview';

interface LivePreviewProps {
  rules: ScoringRule[];
  matchType: MatchType;
  describe: DescribeOptions;
}

/** Prévia ao vivo: a pessoa muda o exemplo e o motor recalcula, com a parcela de cada regra. */
export function LivePreview({ rules, matchType, describe }: LivePreviewProps) {
  const [stats, setStats] = useState<ExampleStats>({});
  const [context, setContext] = useState<Partial<ExampleContext>>({});
  const preview = buildPreview(rules, matchType, describe, { stats, context });
  const match = matchType === 'BATTLE_ROYALE' ? 'queda' : 'partida';

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface-2 p-3 md:p-4">
      <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-4">
        {preview.fields.map((field) =>
          field.kind === 'outcome' ? (
            <Select
              key={field.key}
              label={`${field.label} do exemplo`}
              options={OUTCOME_OPTIONS}
              value={String(preview.stats[field.key] ?? 'win')}
              onChange={(event) => setStats((s) => ({ ...s, [field.key]: event.target.value }))}
            />
          ) : (
            <NumberField
              key={field.key}
              label={`${field.label} do exemplo`}
              min={field.kind === 'placement' ? 1 : 0}
              step={field.kind === 'placement' ? 1 : 'any'}
              value={Number(preview.stats[field.key] ?? 0)}
              onChange={(value) => setStats((s) => ({ ...s, [field.key]: value }))}
            />
          ),
        )}
        {preview.context && (
          <>
            <NumberField
              label={`Número da ${match}`}
              min={1}
              step={1}
              value={preview.context.matchIndex}
              onChange={(matchIndex) => setContext((c) => ({ ...c, matchIndex: Math.max(1, Math.floor(matchIndex)) }))}
            />
            <NumberField
              label={`Total de ${match}s`}
              min={1}
              step={1}
              value={preview.context.matchCount}
              onChange={(matchCount) => setContext((c) => ({ ...c, matchCount: Math.max(1, Math.floor(matchCount)) }))}
            />
          </>
        )}
      </div>

      <p className="rounded-md bg-accent-soft px-4 py-3 text-base text-accent-soft-text" aria-live="polite" aria-atomic="true" data-testid="scoring-example">
        {preview.example} = <strong className="tabular font-bold">{pts(preview.total)}</strong>
      </p>

      {preview.items.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Quanto cada regra somou no exemplo">
          {preview.items.map((item, i) => (
            <li key={`${item.ruleIndex}-${i}`} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-text">{item.label}</span>
              <span className="tabular shrink-0 font-semibold text-text">{signed(item.points)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
