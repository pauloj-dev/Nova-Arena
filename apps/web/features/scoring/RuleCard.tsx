'use client';

import type { MatchType, ScoringRule } from '@nova/schemas';
import { Select } from '@nova/ui';
import { AlertCircle, Trash2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useT } from '@/shared/i18n/react';
import { BONUS_OP_LABELS, describeRule, RULE_TYPE_INFO, RULE_TYPES, ruleStatOptions, statInfo, type DescribeOptions } from './describe';
import { NumberField } from './NumberField';
import { messages } from './messages';
import { changeRuleType } from './rules';
import { TableRuleFields } from './TableRuleFields';
import type { RuleType } from './types';

interface RuleCardProps {
  index: number;
  rule: ScoringRule;
  matchType: MatchType;
  describe: DescribeOptions;
  errors: string[];
  /** Alça de arrastar e botões de subir/descer, vindos da lista reordenável. */
  controls: ReactNode;
  onChange: (rule: ScoringRule) => void;
  onRemove: () => void;
}

type MultiplierScope = 'all' | 'last' | 'one';

function multiplierScope(rule: Extract<ScoringRule, { type: 'MULTIPLIER' }>): MultiplierScope {
  const target = rule.when?.matchIndex;
  if (target === undefined) return 'all';
  return target === 'last' ? 'last' : 'one';
}

/** Um cartão por regra: tipo, campos daquele tipo, a frase que a explica e os erros do motor. */
export function RuleCard({ index, rule, matchType, describe, errors, controls, onChange, onRemove }: RuleCardProps) {
  const t = useT(messages, 'RuleCard');
  const titleId = useId();
  const number = index + 1;
  const tipo = matchType === 'BATTLE_ROYALE' ? 'br' : 'outro';
  const typeOptions = RULE_TYPES.map((value) => ({ value, label: RULE_TYPE_INFO[value].label }));
  const opOptions = (Object.keys(BONUS_OP_LABELS) as Array<keyof typeof BONUS_OP_LABELS>).map((value) => ({ value, label: BONUS_OP_LABELS[value] }));

  const stats = ruleStatOptions(matchType, describe).map((s) => ({ value: s.key, label: s.label }));
  if ('stat' in rule && !stats.some((s) => s.value === rule.stat)) {
    // Estatística cadastrada antes e que este tipo de partida não oferece: continua visível para a pessoa decidir.
    stats.push({ value: rule.stat, label: t('foraDoTipo', { estatistica: statInfo(rule.stat, describe).label }) });
  }

  const statSelect = 'stat' in rule && (
    <Select label={t('estatistica')} options={stats} value={rule.stat} onChange={(event) => onChange({ ...rule, stat: event.target.value })} />
  );

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-3 p-3 md:p-4">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <div className="min-w-48 flex-1">
          <p id={titleId} className="text-sm font-semibold text-text">
            {t('titulo', { numero: number, tipo: RULE_TYPE_INFO[rule.type].label })}
          </p>
          <p className="text-sm text-muted">{describeRule(rule, describe)}</p>
        </div>
        <div className="ml-auto flex items-center">
          {controls}
          <button
            type="button"
            aria-label={t('remover', { numero: number })}
            onClick={onRemove}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent md:size-8"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Select
          label={t('tipoDeRegra')}
          options={typeOptions}
          value={rule.type}
          hint={RULE_TYPE_INFO[rule.type].hint}
          onChange={(event) => onChange(changeRuleType(rule, event.target.value as RuleType, matchType, describe.extraStats))}
          className={rule.type === 'OUTCOME' || rule.type === 'MULTIPLIER' ? 'md:col-span-2' : undefined}
        />

        {rule.type === 'PER_UNIT' && (
          <>
            {statSelect}
            <NumberField label={t('pontosPorUnidade')} step="any" value={rule.points} onChange={(points) => onChange({ ...rule, points })} />
          </>
        )}

        {rule.type === 'TABLE' && (
          <>
            {statSelect}
            <TableRuleFields
              table={rule.table}
              onChange={(table) => onChange({ ...rule, table })}
              placement={rule.stat === 'placement'}
              statName={statInfo(rule.stat, describe).many}
            />
          </>
        )}

        {rule.type === 'OUTCOME' && (
          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <NumberField label={t('vitoria')} step="any" value={rule.win} onChange={(win) => onChange({ ...rule, win })} />
            <NumberField label={t('empate')} step="any" value={rule.draw} onChange={(draw) => onChange({ ...rule, draw })} />
            <NumberField label={t('derrota')} step="any" value={rule.loss} onChange={(loss) => onChange({ ...rule, loss })} />
          </div>
        )}

        {rule.type === 'BONUS' && (
          <>
            {statSelect}
            <NumberField label={t('valorDeReferencia')} step="any" value={rule.value} onChange={(value) => onChange({ ...rule, value })} />
            <Select label={t('condicao')} options={opOptions} value={rule.op} onChange={(event) => onChange({ ...rule, op: event.target.value as typeof rule.op })} />
            <NumberField label={t('pontosDeBonus')} step="any" value={rule.points} onChange={(points) => onChange({ ...rule, points })} />
          </>
        )}

        {rule.type === 'CAP' && (
          <>
            {statSelect}
            <NumberField label={t('maximoDePontos')} min={0} step="any" value={rule.max} onChange={(max) => onChange({ ...rule, max })} hint={t('maximoDica', { tipo })} />
          </>
        )}

        {rule.type === 'MULTIPLIER' && (
          <>
            <NumberField label={t('fator')} min={0} step="any" value={rule.factor} onChange={(factor) => onChange({ ...rule, factor })} />
            <Select
              label={t('valePara')}
              value={multiplierScope(rule)}
              options={[
                { value: 'all', label: t('todas', { tipo }) },
                { value: 'last', label: t('soAUltima', { tipo }) },
                { value: 'one', label: t('umaEspecifica', { tipo }) },
              ]}
              onChange={(event) => {
                const scope = event.target.value as MultiplierScope;
                if (scope === 'all') onChange({ type: 'MULTIPLIER', factor: rule.factor });
                else onChange({ type: 'MULTIPLIER', factor: rule.factor, when: { matchIndex: scope === 'last' ? 'last' : 1 } });
              }}
            />
            {typeof rule.when?.matchIndex === 'number' && (
              <NumberField
                label={t('numeroDaPartida', { tipo })}
                min={1}
                step={1}
                value={rule.when.matchIndex}
                onChange={(matchIndex) => onChange({ ...rule, when: { matchIndex: Math.max(1, Math.floor(matchIndex)) } })}
              />
            )}
          </>
        )}
      </div>

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
