'use client';

import type { Game, GameMode, StageInput } from '@nova/schemas';
import { Button, EmptyState, Modal } from '@nova/ui';
import { ListTree, Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useT } from '@/shared/i18n/react';
import { newStageKey, withStageKeys, type StageDraft } from '../lib/draft';
import { defaultStage, normalizeStages, suggestedFormat, suggestedStages } from '../lib/formats';
import { computeStageFlow, validateStages } from '../validation';
import { messages } from './messages';
import { moveItem, SortableList, useSortableRow } from './Sortable';
import { StageCard, type StageCardProps } from './StageCard';

export interface StageBuilderProps {
  value: StageDraft[];
  onChange: (stages: StageDraft[]) => void;
  game: Game | null;
  mode: GameMode | null;
  maxParticipants: number;
  /** Quem está editando: enxerga os próprios modelos de pontuação personalizados. */
  userId: string | null;
  /** Fases que já começaram (não podem mudar). */
  lockedStageIds?: string[];
}

function SortableStage(props: Omit<StageCardProps<StageDraft>, 'sortable'>) {
  const sortable = useSortableRow(props.stage.key, props.locked || props.total < 2);
  return <StageCard {...props} sortable={sortable} />;
}

/**
 * Linha do tempo de fases (issue #23): arrastar e soltar ou botões para reordenar, adicionar,
 * duplicar e remover. A validação entre fases aparece na fase e no campo certos, enquanto se edita.
 */
export function StageBuilder({ value, onChange, game, mode, maxParticipants, userId, lockedStageIds = [] }: StageBuilderProps) {
  const t = useT(messages, 'StageBuilder');
  const stageName = (stage: StageInput, index: number) => stage.name.trim() || t('faseNome', { n: index + 1 });
  const [expandedKey, setExpandedKey] = useState<string | null>(() => value[0]?.key ?? null);
  const [removing, setRemoving] = useState<string | null>(null);
  const issues = useMemo(() => validateStages(value, { maxParticipants, game, mode }), [value, maxParticipants, game, mode]);
  const flow = useMemo(() => computeStageFlow(value, maxParticipants), [value, maxParticipants]);

  if (!game || !mode) {
    return <EmptyState icon={<ListTree className="size-7" />} title={t('escolhaJogoTitulo')} description={t('escolhaJogoDescricao')} />;
  }

  const commit = (stages: StageDraft[]) => onChange(normalizeStages(stages));
  const isLocked = (stage: StageDraft) => stage.id !== undefined && lockedStageIds.includes(stage.id);

  function add() {
    if (!game || !mode) return;
    const stage: StageDraft = { ...defaultStage(suggestedFormat(game, mode), { game, mode, userId }, { isLast: true, seeding: value.length === 0 ? 'RANDOM' : 'RANKED' }), key: newStageKey() };
    if (value.length > 0) stage.name = t('faseNome', { n: value.length + 1 });
    commit([...value, stage]);
    setExpandedKey(stage.key);
  }
  function applySuggestion() {
    const stages = withStageKeys(suggestedStages({ game, mode, userId, maxParticipants }));
    commit(stages);
    setExpandedKey(stages[0]?.key ?? null);
  }
  function duplicate(index: number) {
    const source = value[index];
    if (!source) return;
    const copy: StageDraft = { ...source, id: undefined, key: newStageKey(), name: t('copia', { nome: stageName(source, index) }).slice(0, 60) };
    commit([...value.slice(0, index + 1), copy, ...value.slice(index + 1)]);
    setExpandedKey(copy.key);
  }
  function move(from: number, to: number) {
    // Fase que já começou não sai do lugar, nem deixa outra passar na frente dela.
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    if (value.slice(lo, hi + 1).some(isLocked)) return;
    commit(moveItem(value, from, to));
  }

  const removingStage = value.find((s) => s.key === removing);
  const removingIndex = value.findIndex((s) => s.key === removing);

  if (value.length === 0) {
    return (
      <EmptyState
        icon={<ListTree className="size-7" />}
        title={t('nenhumaFaseTitulo')}
        description={t('nenhumaFaseDescricao', { jogo: game.name, modo: mode.name })}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button iconLeft={<Sparkles className="size-4" aria-hidden />} onClick={applySuggestion}>
              {t('usarSugestao')}
            </Button>
            <Button variant="secondary" iconLeft={<Plus className="size-4" aria-hidden />} onClick={add}>
              {t('adicionarFase')}
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted" role="status">
        {t('resumo', { count: value.length, pendencias: issues.length })}
      </p>
      <SortableList ids={value.map((s) => s.key)} labelOf={(key) => stageName(value.find((s) => s.key === key) ?? value[0]!, value.findIndex((s) => s.key === key))} onMove={move}>
        <ol className="flex flex-col gap-3" aria-label={t('fasesAria')}>
          {value.map((stage, index) => (
            <SortableStage
              key={stage.key}
              stage={stage}
              index={index}
              total={value.length}
              flow={flow[index]}
              issues={issues.filter((i) => i.stageIndex === index)}
              game={game}
              mode={mode}
              userId={userId}
              nextStageName={value[index + 1] ? stageName(value[index + 1]!, index + 1) : null}
              locked={isLocked(stage)}
              expanded={expandedKey === stage.key}
              onToggle={() => setExpandedKey((current) => (current === stage.key ? null : stage.key))}
              onChange={(next) => onChange(value.map((s) => (s.key === stage.key ? next : s)))}
              onMove={(to) => move(index, to)}
              onDuplicate={() => duplicate(index)}
              onRemove={() => setRemoving(stage.key)}
            />
          ))}
        </ol>
      </SortableList>
      <div>
        <Button variant="secondary" iconLeft={<Plus className="size-4" aria-hidden />} onClick={add}>
          {t('adicionarFase')}
        </Button>
      </div>

      <Modal
        open={removingStage !== undefined}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title={t('removerTitulo')}
        description={removingStage ? t('removerDescricao', { nome: stageName(removingStage, removingIndex) }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('voltar')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                commit(value.filter((s) => s.key !== removing));
                setRemoving(null);
              }}
            >
              {t('removerFase')}
            </Button>
          </>
        }
      />
    </div>
  );
}
