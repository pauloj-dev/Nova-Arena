/**
 * Prévia de pontuação. A conta é sempre do motor (`computePoints`); este módulo só monta
 * o exemplo e troca os rótulos técnicos por texto em pt-BR.
 */
import { computePoints } from '@nova/engine';
import type { MatchType, ScoringRule } from '@nova/schemas';
import { describeExample, describeRule, exampleContext, exampleFields, exampleStats, type DescribeOptions, type ExampleContext, type ExampleStats, type StatInfo } from './describe';

export interface PreviewItem {
  ruleIndex: number;
  /** A regra em português: "1 ponto por kill". */
  label: string;
  /** Quanto esta regra somou (ou tirou) no exemplo, segundo o motor. */
  points: number;
}

export interface Preview {
  fields: StatInfo[];
  stats: ExampleStats;
  context: ExampleContext | null;
  /** "7 kills + 1º lugar". */
  example: string;
  total: number;
  items: PreviewItem[];
}

export interface PreviewOverrides {
  stats?: ExampleStats;
  context?: Partial<ExampleContext>;
}

/** Calcula o exemplo de um conjunto de regras. `overrides` são os valores digitados na prévia ao vivo. */
export function buildPreview(rules: readonly ScoringRule[], matchType: MatchType, opts: DescribeOptions = {}, overrides: PreviewOverrides = {}): Preview {
  const describe = { ...opts, matchType };
  const fields = exampleFields(rules, matchType, describe);
  const stats: ExampleStats = { ...exampleStats(rules, matchType) };
  for (const field of fields) {
    const typed = overrides.stats?.[field.key];
    if (typed !== undefined) stats[field.key] = typed;
  }
  const base = exampleContext(rules);
  const context = base ? { ...base, ...overrides.context } : null;

  const result = computePoints(stats, [...rules], context ?? {});
  const items = result.breakdown.map((item) => {
    const rule = rules[item.ruleIndex];
    return { ruleIndex: item.ruleIndex, label: rule ? describeRule(rule, describe) : item.label, points: item.points };
  });

  return { fields, stats, context, example: describeExample(fields, stats, describe, context), total: result.total, items };
}
