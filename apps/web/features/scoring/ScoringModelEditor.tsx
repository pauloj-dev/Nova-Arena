'use client';

import type { ExtraStatField, MatchType, ScoringRule } from '@nova/schemas';
import { Button, cn, Input, Select } from '@nova/ui';
import { AlertCircle, Plus } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { describeModel, MATCH_TYPE_LABELS, MATCH_TYPE_OPTIONS, pts, RULE_TYPE_INFO, RULE_TYPES, type DescribeOptions } from './describe';
import { LivePreview } from './LivePreview';
import { buildPreview } from './preview';
import { RuleCard } from './RuleCard';
import { changeMatchType, moveItem, newRule } from './rules';
import { SortableItem, SortableList } from './Sortable';
import { TiebreakerEditor } from './TiebreakerEditor';
import type { RuleType, ScoringDraft } from './types';
import { groupErrors, NAME_ERROR, validateDraft } from './validation';

export type { ScoringDraft } from './types';

export interface ScoringModelEditorProps {
  value: ScoringDraft;
  onChange: (value: ScoringDraft) => void;
  /** Estatísticas extras do jogo (ex.: pênaltis), oferecidas nas regras. */
  extraStats?: ExtraStatField[];
  /** Esconde o campo de nome (quando o modelo é editado dentro de uma fase). */
  hideName?: boolean;
  /** Trava o tipo de partida (dentro de uma fase, ele vem do formato). */
  lockMatchType?: boolean;
  /** Erros vindos de fora (ex.: da API ao salvar). Somam-se aos que o motor aponta enquanto a pessoa edita. */
  errors?: string[];
  /** Como o placar se chama neste jogo, no plural ("coroas", "gols", "frames"). Sem isso, aparece "placar". */
  scoreLabel?: string;
  className?: string;
}

const TYPE_OPTIONS = RULE_TYPES.map((value) => ({ value, label: RULE_TYPE_INFO[value].label }));

function ErrorList({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul role="alert" className="flex flex-col gap-1 rounded-md bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
      {messages.map((message) => (
        <li key={message} className="flex items-start gap-1.5">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message}
        </li>
      ))}
    </ul>
  );
}

/**
 * Editor visual de modelo de pontuação (PRD §11): regras, ordem de desempate e prévia ao vivo.
 * Componente controlado. Toda conta de pontos e toda validação vêm de `@nova/engine`.
 */
export function ScoringModelEditor({ value, onChange, extraStats, hideName = false, lockMatchType = false, errors, scoreLabel, className }: ScoringModelEditorProps) {
  const baseId = useId();
  const [newType, setNewType] = useState<RuleType>('PER_UNIT');
  const [nameTouched, setNameTouched] = useState(false);

  // Identificadores estáveis das regras (elas não têm `id`): é o que mantém foco e arrasto ao reordenar.
  const [order, setOrder] = useState(() => ({ ids: value.rules.map((_, i) => `${baseId}r${i}`), next: value.rules.length }));
  if (order.ids.length !== value.rules.length) {
    // As regras mudaram por fora (outro modelo carregado, troca do tipo de partida): recomeça a numeração.
    setOrder({ ids: value.rules.map((_, i) => `${baseId}r${order.next + i}`), next: order.next + value.rules.length });
  }
  const ids = order.ids.length === value.rules.length ? order.ids : value.rules.map((_, i) => `${baseId}r${order.next + i}`);

  const describe: DescribeOptions = useMemo(() => ({ matchType: value.matchType, extraStats, scoreLabel }), [value.matchType, extraStats, scoreLabel]);

  const grouped = useMemo(() => {
    // Sem campo de nome na tela, não faz sentido cobrar o nome aqui: quem embute o editor cuida disso.
    const draft = hideName && value.name.trim() === '' ? { ...value, name: 'Modelo da fase' } : value;
    return groupErrors([...validateDraft(draft), ...(errors ?? [])]);
  }, [value, hideName, errors]);
  const showNameError = nameTouched || Boolean(errors?.includes(NAME_ERROR));

  const setRules = (rules: ScoringRule[]) => onChange({ ...value, rules });

  function addRule() {
    setOrder((o) => ({ ids: [...o.ids, `${baseId}r${o.next}`], next: o.next + 1 }));
    setRules([...value.rules, newRule(newType, value.matchType, extraStats, value.rules)]);
  }
  function removeRule(index: number) {
    setOrder((o) => ({ ...o, ids: o.ids.filter((_, i) => i !== index) }));
    setRules(value.rules.filter((_, i) => i !== index));
  }
  function moveRule(from: number, to: number) {
    setOrder((o) => ({ ...o, ids: moveItem(o.ids, from, to) }));
    setRules(moveItem(value.rules, from, to));
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {(!hideName || !lockMatchType) && (
        <div className="grid gap-3 md:grid-cols-2">
          {!hideName && (
            <Input
              label="Nome do modelo"
              required
              value={value.name}
              placeholder="Ex.: Padrão (kill 1, Booyah 3)"
              error={showNameError ? (grouped.name ?? undefined) : undefined}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              onBlur={() => setNameTouched(true)}
            />
          )}
          {!lockMatchType && (
            <Select
              label="Tipo de partida"
              options={MATCH_TYPE_OPTIONS}
              value={value.matchType}
              hint="Ao trocar, ficam só as regras que valem para o novo tipo."
              onChange={(event) => onChange(changeMatchType(value, event.target.value as MatchType, extraStats))}
            />
          )}
        </div>
      )}
      {lockMatchType && !hideName && (
        <p className="text-sm text-muted">
          Tipo de partida: <strong className="text-text">{MATCH_TYPE_LABELS[value.matchType]}</strong>
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby={`${baseId}-rules`}>
        <div>
          <h3 id={`${baseId}-rules`} className="text-base font-semibold text-text">
            Regras
          </h3>
          <p className="text-sm text-muted">Cada regra transforma uma estatística da partida em pontos. Limites e multiplicadores entram por último.</p>
        </div>

        <ErrorList messages={grouped.general} />

        {value.rules.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong p-4 text-center text-sm text-muted">Nenhuma regra ainda. Escolha um tipo abaixo e adicione a primeira.</p>
        ) : (
          <SortableList ids={ids} itemName={(id) => `regra ${ids.indexOf(id) + 1}`} onMove={moveRule} aria-label="Regras do modelo">
            {value.rules.map((rule, index) => {
              const id = ids[index] ?? `${baseId}r-${index}`;
              return (
                <SortableItem key={id} id={id}>
                  {(controls) => (
                    <RuleCard
                      index={index}
                      rule={rule}
                      matchType={value.matchType}
                      describe={describe}
                      errors={grouped.byRule[index] ?? []}
                      controls={controls}
                      onChange={(next) => setRules(value.rules.map((r, i) => (i === index ? next : r)))}
                      onRemove={() => removeRule(index)}
                    />
                  )}
                </SortableItem>
              );
            })}
          </SortableList>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border-strong p-3">
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <Select label="Tipo da nova regra" options={TYPE_OPTIONS} value={newType} onChange={(event) => setNewType(event.target.value as RuleType)} className="md:flex-1" />
            <Button variant="secondary" onClick={addRule} iconLeft={<Plus className="size-4" aria-hidden />}>
              Adicionar regra
            </Button>
          </div>
          <p className="text-xs text-muted">{RULE_TYPE_INFO[newType].hint}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby={`${baseId}-preview`}>
        <div>
          <h3 id={`${baseId}-preview`} className="text-base font-semibold text-text">
            Prévia
          </h3>
          <p className="text-sm text-muted">Mude o exemplo para conferir a conta. O cálculo é o mesmo que vale no campeonato.</p>
        </div>
        <LivePreview rules={value.rules} matchType={value.matchType} describe={describe} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby={`${baseId}-tiebreakers`}>
        <div>
          <h3 id={`${baseId}-tiebreakers`} className="text-base font-semibold text-text">
            Critérios de desempate
          </h3>
          <p className="text-sm text-muted">Quando duas equipes empatam em pontos, vale o primeiro critério da lista que as separar.</p>
        </div>
        <TiebreakerEditor value={value.tiebreakers} onChange={(tiebreakers) => onChange({ ...value, tiebreakers })} describe={describe} errors={grouped.tiebreakers} />
      </section>
    </div>
  );
}

export interface ScoringPreviewProps {
  rules: ScoringRule[];
  matchType: MatchType;
  extraStats?: ExtraStatField[];
  /** Como o placar se chama neste jogo, no plural ("coroas", "gols", "frames"). */
  scoreLabel?: string;
  className?: string;
}

/** Prévia somente leitura: resumo das regras e um exemplo calculado pelo motor ("7 kills + 1º lugar = 10 pts"). */
export function ScoringPreview({ rules, matchType, extraStats, scoreLabel, className }: ScoringPreviewProps) {
  if (rules.length === 0) return <p className={cn('text-sm text-muted', className)}>Nenhuma regra cadastrada.</p>;
  const describe: DescribeOptions = { matchType, extraStats, scoreLabel };
  const preview = buildPreview(rules, matchType, describe);
  return (
    <div className={cn('flex flex-col gap-2 text-sm', className)}>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-text">
        {describeModel(rules, describe).map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ul>
      <p className="text-muted">
        Exemplo:{' '}
        <span className="text-text" data-testid="scoring-example">
          {preview.example} = <strong className="tabular font-bold">{pts(preview.total)}</strong>
        </span>
      </p>
    </div>
  );
}
