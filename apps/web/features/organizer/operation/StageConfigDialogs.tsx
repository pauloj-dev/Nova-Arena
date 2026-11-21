'use client';

import type { Game, OrganizerTournamentDetail, Stage, StageInput } from '@nova/schemas';
import { Button, Checkbox, Modal, Select, useToast } from '@nova/ui';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useSaveTournament } from '@/shared/api/hooks/organizer';
import { useChangeStageScoring } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { newStageKey, type StageDraft } from '../lib/draft';
import { compatibleScoringModels } from '../lib/formats';
import { StageBuilder } from '../stage-builder/StageBuilder';
import { validateStages } from '../validation';
import { messages } from './messages';
import { byOrder } from './stageUtils';

const toDraft = (s: Stage): StageDraft => ({ key: newStageKey(), id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding });
const toInput = (s: StageDraft): StageInput => ({ id: s.id, name: s.name, format: s.format, scoringModelId: s.scoringModelId, config: s.config, qualification: s.qualification, tiebreakers: s.tiebreakers, seeding: s.seeding });

/**
 * Editar a configuração das fases que ainda não começaram (US-ORG-05), com o mesmo `StageBuilder`
 * do assistente. As fases em andamento ou concluídas aparecem travadas.
 */
export function EditStagesDialog({ tournament, game, open, onOpenChange }: { tournament: OrganizerTournamentDetail; game: Game | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useSession();
  const save = useSaveTournament();
  const t = useT(messages, 'StageConfigDialogs');
  const { success, error } = useToast();
  const [stages, setStages] = useState<StageDraft[]>(() => byOrder(tournament.stages).map(toDraft));
  const mode = game?.modes.find((m) => m.id === tournament.gameModeId) ?? null;
  const locked = tournament.stages.filter((s) => s.status !== 'PENDING').map((s) => s.id);
  const issues = useMemo(() => validateStages(stages, { maxParticipants: tournament.maxParticipants, game, mode }), [stages, tournament.maxParticipants, game, mode]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('editarTitulo')}
      description={t('editarDescricao')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={issues.length > 0 || stages.length === 0}
            onClick={() =>
              save.mutate(
                { id: tournament.id, input: { stages: stages.map(toInput) } },
                {
                  onSuccess: () => {
                    success(t('fasesAtualizadas'));
                    onOpenChange(false);
                  },
                  onError: (e) => error(t('erroFases'), errorMessage(e)),
                },
              )
            }
          >
            {t('salvarFases')}
          </Button>
        </>
      }
    >
      <StageBuilder value={stages} onChange={setStages} game={game} mode={mode} maxParticipants={tournament.maxParticipants} userId={user?.id ?? null} lockedStageIds={locked} />
    </Modal>
  );
}

/**
 * Troca do modelo de pontuação de uma fase (RN-02). Com a fase em andamento, exige confirmação:
 * a tabela inteira é recalculada e a troca fica na auditoria.
 */
export function StageScoringDialog({ tournament, stage, game, open, onOpenChange }: { tournament: OrganizerTournamentDetail; stage: Stage; game: Game | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useSession();
  const change = useChangeStageScoring(stage.id);
  const t = useT(messages, 'StageConfigDialogs');
  const { success, error } = useToast();
  const [modelId, setModelId] = useState(stage.scoringModelId);
  const [confirmed, setConfirmed] = useState(false);
  const active = stage.status === 'ACTIVE';

  const current = game?.scoringModels.find((m) => m.id === stage.scoringModelId);
  const options = useMemo(() => {
    if (!game || !current) return [];
    const mine = compatibleScoringModels(game, current.matchType, user?.id ?? null);
    const ownerModels = game.scoringModels.filter((m) => m.matchType === current.matchType && m.ownerId === tournament.ownerId);
    return [...new Map([...mine, ...ownerModels, current].map((m) => [m.id, m])).values()];
  }, [game, current, user?.id, tournament.ownerId]);
  const changed = modelId !== stage.scoringModelId;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t('pontuacaoTitulo', { name: stage.name })}
      description={active ? t('pontuacaoAtiva') : t('pontuacaoEscolha')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('voltar')}
          </Button>
          <Button
            loading={change.isPending}
            disabled={!changed || (active && !confirmed)}
            onClick={() =>
              change.mutate(
                { scoringModelId: modelId },
                {
                  onSuccess: () => {
                    success(t('pontuacaoAlterada'), active ? t('tabelaRecalculada') : undefined);
                    onOpenChange(false);
                  },
                  onError: (e) => error(t('erroPontuacao'), errorMessage(e)),
                },
              )
            }
          >
            {active ? t('trocarERecalcular') : t('trocarPontuacao')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select label={t('modelo')} value={modelId} onChange={(e) => setModelId(e.target.value)} options={options.map((m) => ({ value: m.id, label: m.name }))} hint={current ? t('atual', { name: current.name }) : undefined} />
        {active && (
          <Checkbox
            label={t('entendi')}
            hint={t('entendiDica')}
            checked={confirmed}
            onCheckedChange={setConfirmed}
          />
        )}
      </div>
    </Modal>
  );
}
