'use client';

import type { Game, OrganizerTournamentDetail, Stage, StageInput } from '@nova/schemas';
import { Button, Checkbox, Modal, Select, useToast } from '@nova/ui';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useSaveTournament } from '@/shared/api/hooks/organizer';
import { useChangeStageScoring } from '@/shared/api/hooks/organizer-ops';
import { useSession } from '@/shared/session/useSession';
import { newStageKey, type StageDraft } from '../lib/draft';
import { compatibleScoringModels } from '../lib/formats';
import { StageBuilder } from '../stage-builder/StageBuilder';
import { validateStages } from '../validation';
import { byOrder } from './stageUtils';

const toDraft = (s: Stage): StageDraft => ({ key: newStageKey(), id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding });
const toInput = (s: StageDraft): StageInput => ({ id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding });

/**
 * Editar a configuração das fases que ainda não começaram (US-ORG-05), com o mesmo `StageBuilder`
 * do assistente. As fases em andamento ou concluídas aparecem travadas.
 */
export function EditStagesDialog({ tournament: t, game, open, onOpenChange }: { tournament: OrganizerTournamentDetail; game: Game | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useSession();
  const save = useSaveTournament();
  const { success, error } = useToast();
  const [stages, setStages] = useState<StageDraft[]>(() => byOrder(t.stages).map(toDraft));
  const mode = game?.modes.find((m) => m.id === t.gameModeId) ?? null;
  const locked = t.stages.filter((s) => s.status !== 'PENDING').map((s) => s.id);
  const issues = useMemo(() => validateStages(stages, { maxParticipants: t.maxParticipants, game, mode }), [stages, t.maxParticipants, game, mode]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Editar fases"
      description="Você pode mudar formato, pontuação e classificação das fases que ainda não começaram. Fase em andamento só troca a pontuação, pelo botão próprio."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            loading={save.isPending}
            disabled={issues.length > 0 || stages.length === 0}
            onClick={() =>
              save.mutate(
                { id: t.id, input: { stages: stages.map(toInput) } },
                {
                  onSuccess: () => {
                    success('Fases atualizadas');
                    onOpenChange(false);
                  },
                  onError: (e) => error('Não foi possível salvar as fases', errorMessage(e)),
                },
              )
            }
          >
            Salvar fases
          </Button>
        </>
      }
    >
      <StageBuilder value={stages} onChange={setStages} game={game} mode={mode} maxParticipants={t.maxParticipants} userId={user?.id ?? null} lockedStageIds={locked} />
    </Modal>
  );
}

/**
 * Troca do modelo de pontuação de uma fase (RN-02). Com a fase em andamento, exige confirmação:
 * a tabela inteira é recalculada e a troca fica na auditoria.
 */
export function StageScoringDialog({ tournament: t, stage, game, open, onOpenChange }: { tournament: OrganizerTournamentDetail; stage: Stage; game: Game | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useSession();
  const change = useChangeStageScoring(stage.id);
  const { success, error } = useToast();
  const [modelId, setModelId] = useState(stage.scoringModelId);
  const [confirmed, setConfirmed] = useState(false);
  const active = stage.status === 'ACTIVE';

  const current = game?.scoringModels.find((m) => m.id === stage.scoringModelId);
  const options = useMemo(() => {
    if (!game || !current) return [];
    const mine = compatibleScoringModels(game, current.matchType, user?.id ?? null);
    const ownerModels = game.scoringModels.filter((m) => m.matchType === current.matchType && m.ownerId === t.ownerId);
    return [...new Map([...mine, ...ownerModels, current].map((m) => [m.id, m])).values()];
  }, [game, current, user?.id, t.ownerId]);
  const changed = modelId !== stage.scoringModelId;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Pontuação de "${stage.name}"`}
      description={active ? 'A fase está em andamento: trocar o modelo recalcula todos os resultados já lançados.' : 'Escolha o modelo de pontuação desta fase.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            loading={change.isPending}
            disabled={!changed || (active && !confirmed)}
            onClick={() =>
              change.mutate(
                { scoringModelId: modelId },
                {
                  onSuccess: () => {
                    success('Pontuação alterada', active ? 'A tabela da fase foi recalculada com o modelo novo.' : undefined);
                    onOpenChange(false);
                  },
                  onError: (e) => error('Não foi possível trocar a pontuação', errorMessage(e)),
                },
              )
            }
          >
            {active ? 'Trocar e recalcular' : 'Trocar pontuação'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label="Modelo de pontuação" value={modelId} onChange={(e) => setModelId(e.target.value)} options={options.map((m) => ({ value: m.id, label: m.name }))} hint={current ? `Atual: ${current.name}` : undefined} />
        {active && (
          <Checkbox
            label="Entendi que a tabela desta fase será recalculada"
            hint="Os pontos de todas as partidas já lançadas passam a valer pelo modelo novo. A troca fica registrada na auditoria."
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
        )}
      </div>
    </Modal>
  );
}
