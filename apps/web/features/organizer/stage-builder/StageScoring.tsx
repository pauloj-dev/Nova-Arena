'use client';

import { computePoints, DEFAULT_SCORING_MODELS } from '@nova/engine';
import type { Game, GameMode, ScoringModel, StageInput } from '@nova/schemas';
import { Button, Modal, Select, useToast } from '@nova/ui';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { ScoringModelEditor, ScoringPreview, type ScoringDraft } from '@/features/scoring/ScoringModelEditor';
import { errorMessage } from '@/shared/api/client';
import { useSaveCustomScoringModel } from '@/shared/api/hooks/organizer';
import { compatibleScoringModels, DEFAULT_TIEBREAKERS, isBattleRoyaleStage, stageMatchType } from '../lib/formats';
import { MATCH_TYPE_LABEL } from '../lib/labels';
import { IssueList } from './IssueList';
import { TiebreakerList } from './TiebreakerList';

interface StageScoringProps<T extends StageInput> {
  stage: T;
  onChange: (stage: T) => void;
  game: Game;
  mode: GameMode;
  userId: string | null;
  stageName: string;
  scoringIssues: string[];
  tiebreakerIssues: string[];
  disabled?: boolean;
}

function modelLabel(model: ScoringModel): string {
  if (model.ownerId !== null) return `${model.name} (personalizado)`;
  return model.isDefault ? `${model.name} (padrão)` : model.name;
}

/** Quanto vale a última queda com o multiplicador da fase — a conta é do motor, nunca da tela (RN-01). */
function lastDropExample(model: ScoringModel, multiplier: number): string | null {
  if (multiplier <= 1) return null;
  const stats = { kills: 7, placement: 1 };
  const normal = computePoints(stats, model.rules).total;
  const last = computePoints(stats, model.rules, { multiplier }).total;
  return `Na última queda (×${String(multiplier).replace('.', ',')}), 7 kills + 1º lugar valem ${last} pts em vez de ${normal}.`;
}

interface CustomDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: Game;
  base: ScoringModel | null;
  initial: ScoringDraft;
  /** Modelo personalizado meu: salvar atualiza em vez de criar outro. */
  editingId: string | undefined;
  onSaved: (model: ScoringModel) => void;
}

function CustomScoringDialog({ open, onOpenChange, game, base, initial, editingId, onSaved }: CustomDialogProps) {
  const [draft, setDraft] = useState<ScoringDraft>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useSaveCustomScoringModel();
  const { success } = useToast();

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Personalizar pontuação"
      description={base ? `Começamos pelo modelo "${base.name}". O que você mudar aqui vale só para os seus campeonatos.` : 'Monte as regras desta fase. O modelo vale só para os seus campeonatos.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setErrors([]);
              save.mutate(
                { id: editingId, input: { gameId: game.id, name: draft.name, matchType: draft.matchType, rules: draft.rules, tiebreakers: draft.tiebreakers } },
                {
                  onSuccess: (model) => {
                    success('Pontuação personalizada salva');
                    onSaved(model);
                    onOpenChange(false);
                  },
                  onError: (e) => setErrors([errorMessage(e)]),
                },
              );
            }}
          >
            Salvar pontuação
          </Button>
        </>
      }
    >
      <ScoringModelEditor value={draft} onChange={setDraft} extraStats={game.extraStatFields} hideName lockMatchType errors={errors} />
    </Modal>
  );
}

/** Pontuação de uma fase: modelo (do catálogo ou personalizado), prévia e ordem de desempate. */
export function StageScoring<T extends StageInput>({ stage, onChange, game, mode, userId, stageName, scoringIssues, tiebreakerIssues, disabled }: StageScoringProps<T>) {
  const [customOpen, setCustomOpen] = useState(false);
  const matchType = stageMatchType(stage.format, stage.config, mode);
  const models = compatibleScoringModels(game, matchType, userId);
  const selected = models.find((m) => m.id === stage.scoringModelId) ?? null;
  const isMine = selected !== null && selected.ownerId !== null && selected.ownerId === userId;
  const example = selected && isBattleRoyaleStage(stage.format, stage.config) ? lastDropExample(selected, stage.config.lastDropMultiplier) : null;

  // Sem modelo no catálogo do jogo para este tipo de partida, o editor parte do modelo padrão do motor.
  const engineDefault = DEFAULT_SCORING_MODELS.find((m) => m.matchType === matchType && m.gameSlug === game.slug) ?? DEFAULT_SCORING_MODELS.find((m) => m.matchType === matchType);
  const initialDraft: ScoringDraft = {
    name: isMine && selected ? selected.name : `${stageName} · pontuação personalizada`.slice(0, 80),
    matchType,
    rules: selected?.rules ?? engineDefault?.rules ?? [],
    tiebreakers: selected?.tiebreakers ?? engineDefault?.tiebreakers ?? DEFAULT_TIEBREAKERS[matchType],
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Select
          label="Modelo de pontuação"
          hint={`Modelos de ${game.name} para ${MATCH_TYPE_LABEL[matchType]}.`}
          disabled={disabled}
          value={selected?.id ?? ''}
          placeholder={selected ? undefined : 'Escolha um modelo…'}
          options={models.map((m) => ({ value: m.id, label: modelLabel(m) }))}
          onChange={(e) => {
            const model = models.find((m) => m.id === e.target.value);
            // Trocar o modelo traz junto a ordem de desempate dele; a pessoa ajusta abaixo se quiser.
            if (model) onChange({ ...stage, scoringModelId: model.id, tiebreakers: model.tiebreakers });
          }}
        />
        <IssueList messages={scoringIssues} />
        {selected && (
          <div className="rounded-md border border-border bg-surface-2 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Como os pontos são contados</p>
            <ScoringPreview rules={selected.rules} matchType={matchType} extraStats={game.extraStatFields} />
            {example && <p className="mt-2 text-sm text-muted">{example}</p>}
          </div>
        )}
        {models.length === 0 && (
          <p className="text-sm text-muted">
            {game.name} ainda não tem modelo de pontuação para {MATCH_TYPE_LABEL[matchType]}. Crie o seu em &quot;Personalizar pontuação&quot;.
          </p>
        )}
        {!disabled && (
          <div>
            <Button variant="secondary" size="sm" iconLeft={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setCustomOpen(true)}>
              {isMine ? 'Editar pontuação personalizada' : 'Personalizar pontuação'}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h4 className="text-sm font-semibold text-text">Critérios de desempate</h4>
          <p className="text-xs text-muted">Quando duas equipes empatam em pontos, vale a ordem abaixo. Arraste ou use as setas.</p>
        </div>
        <IssueList messages={tiebreakerIssues} />
        <TiebreakerList value={stage.tiebreakers} onChange={(tiebreakers) => onChange({ ...stage, tiebreakers })} matchType={matchType} stageName={stageName} disabled={disabled} />
      </div>

      {customOpen && (
        <CustomScoringDialog
          open={customOpen}
          onOpenChange={setCustomOpen}
          game={game}
          base={selected}
          initial={initialDraft}
          editingId={isMine ? selected?.id : undefined}
          onSaved={(model) => onChange({ ...stage, scoringModelId: model.id, tiebreakers: model.tiebreakers })}
        />
      )}
    </div>
  );
}
