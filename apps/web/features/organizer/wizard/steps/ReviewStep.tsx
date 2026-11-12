'use client';

import { Badge, Button, Card } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { ScoringPreview } from '@/features/scoring/ScoringModelEditor';
import { formatDateTime } from '@/shared/lib/datetime';
import { RichTextView } from '../../components/RichText';
import { stageTitle } from '../../lib/draft';
import { stageMatchType } from '../../lib/formats';
import { describeQualification, SEEDING_INFO, tiebreakerLabel } from '../../lib/labels';
import { computeStageFlow, WIZARD_STEPS } from '../../validation';
import { useWizard } from '../context';

function Block({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  const { goToStep, issues } = useWizard();
  const pending = issues.filter((i) => i.step === step).length;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          {pending > 0 && (
            <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {pending} {pending === 1 ? 'pendência' : 'pendências'}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" iconLeft={<Pencil className="size-4" aria-hidden />} onClick={() => goToStep(step)} aria-label={`Editar ${title}`}>
          Editar
        </Button>
      </div>
      {children}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 xs:flex-row xs:gap-3">
      <dt className="shrink-0 text-sm text-muted xs:w-44">{label}</dt>
      <dd className="min-w-0 text-sm text-text">{children}</dd>
    </div>
  );
}

const dateOr = (iso: string | null, fallback: string) => (iso ? formatDateTime(iso) : fallback);

interface ReviewStepProps {
  /** Erro da última tentativa de publicar (limite do organizador, pendência vista só pela API…). */
  publishError: string | null;
}

/** Passo 7 — Revisão: resumo de tudo e as pendências, cada uma com o caminho para o passo que resolve. */
export function ReviewStep({ publishError }: ReviewStepProps) {
  const { values, game, mode, issues, goToStep, isPublished } = useWizard();
  const flow = computeStageFlow(values.stages, values.maxParticipants);
  const isTeam = (mode?.teamSize ?? 1) > 1;

  return (
    <div className="flex flex-col gap-4">
      {issues.length > 0 ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-4 text-danger-soft-text" data-testid="review-issues">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            {issues.length === 1 ? 'Falta 1 ponto' : `Faltam ${issues.length} pontos`} para {isPublished ? 'salvar' : 'publicar'}
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.message}`} className="flex flex-col gap-1 text-sm xs:flex-row xs:items-center xs:justify-between xs:gap-3">
                <span className="min-w-0">{issue.message}</span>
                <button type="button" onClick={() => goToStep(issue.step)} className="min-h-11 shrink-0 self-start rounded-md px-2 text-left font-semibold underline hover:bg-surface xs:self-auto md:min-h-8">
                  Ir para {WIZARD_STEPS[issue.step]?.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-primary bg-primary-soft p-4 text-sm font-medium text-primary-soft-text">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {isPublished ? 'Tudo certo. Salve para aplicar as alterações.' : 'Tudo pronto. Confira o resumo e publique quando quiser.'}
        </div>
      )}
      {publishError && (
        <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-4 text-sm font-medium text-danger-soft-text">
          {publishError}
        </p>
      )}

      <Block step={0} title="Informações">
        <dl className="flex flex-col gap-2">
          <Row label="Nome">{values.name.trim() || <span className="text-muted">Sem nome</span>}</Row>
          <Row label="Banner">{values.bannerUrl ? 'Imagem escolhida' : <span className="text-muted">Sem banner</span>}</Row>
          <Row label="Premiação">{values.prize.trim() || <span className="text-muted">Não informada</span>}</Row>
          <Row label="Transmissão">{values.streamUrls.length > 0 ? values.streamUrls.join(', ') : <span className="text-muted">Sem links</span>}</Row>
          <Row label="Descrição">
            <RichTextView html={values.description} empty="Sem descrição." />
          </Row>
        </dl>
      </Block>

      <Block step={1} title="Jogo e modo">
        <dl className="flex flex-col gap-2">
          <Row label="Jogo">
            {game ? (
              <>
                <span aria-hidden>{game.icon} </span>
                {game.name}
              </>
            ) : (
              <span className="text-muted">Não escolhido</span>
            )}
          </Row>
          <Row label="Modo">{mode ? `${mode.name} · ${isTeam ? `squads de ${mode.teamSize}` : 'individual'}` : <span className="text-muted">Não escolhido</span>}</Row>
        </dl>
      </Block>

      <Block step={2} title="Inscrições">
        <dl className="flex flex-col gap-2">
          <Row label="Vagas">
            {values.maxParticipants} {isTeam ? 'squads' : 'jogadores'} · {values.waitlistEnabled ? 'com lista de espera' : 'sem lista de espera'}
          </Row>
          <Row label="Aprovação">{values.manualApproval ? 'Manual (você aprova cada inscrição)' : 'Automática'}</Row>
          <Row label="Abertura">{dateOr(values.registrationOpensAt, 'Assim que publicar')}</Row>
          <Row label="Fechamento">{dateOr(values.registrationClosesAt, 'Não definido')}</Row>
          <Row label="Início">{dateOr(values.startsAt, 'Não definido')}</Row>
          {isTeam && <Row label="Trava de elenco">{dateOr(values.rosterLockAt, 'Sem trava')}</Row>}
          <Row label="Check-in">
            {values.checkIn.enabled ? `De ${values.checkIn.opensMinutesBefore} a ${values.checkIn.closesMinutesBefore} min antes${isTeam ? (values.checkIn.requireAllMembers ? ' · todos os membros' : ' · só o capitão') : ''}` : 'Não exigido'}
          </Row>
        </dl>
      </Block>

      <Block step={3} title="Fases">
        {values.stages.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma fase ainda.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {values.stages.map((stage, index) => {
              const step = flow[index];
              return (
                <li key={stage.key} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-text">{stageTitle(stage, index)}</p>
                    <p className="text-muted">
                      {step?.entrants != null ? `${index === 0 ? 'Começa com' : 'Recebe'} ${step.entrants}` : 'Participantes a definir'} · chaveamento: {SEEDING_INFO[stage.seeding].label.toLowerCase()}
                    </p>
                    {stage.qualification && (
                      <p className="text-muted">
                        {describeQualification(stage.qualification, stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo')}
                        {step?.qualified != null ? ` → ${step.qualified} ${step.qualified === 1 ? 'avança' : 'avançam'}` : ''}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Block>

      <Block step={4} title="Pontuação">
        {values.stages.length === 0 || !game || !mode ? (
          <p className="text-sm text-muted">Definida por fase.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {values.stages.map((stage, index) => {
              const model = game.scoringModels.find((m) => m.id === stage.scoringModelId);
              return (
                <li key={stage.key} className="flex flex-col gap-1 text-sm">
                  <p className="font-semibold text-text">
                    {stage.name.trim() || `Fase ${index + 1}`}: <span className="font-normal">{model?.name ?? 'sem modelo de pontuação'}</span>
                  </p>
                  {model && <ScoringPreview rules={model.rules} matchType={stageMatchType(stage.format, stage.config, mode)} extraStats={game.extraStatFields} />}
                  <p className="text-muted">Desempate: {stage.tiebreakers.map((t) => tiebreakerLabel(t)).join(' → ')}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block step={5} title="Regras">
        <RichTextView html={values.rules} empty="Sem regulamento." className="max-h-64 overflow-y-auto" />
      </Block>
    </div>
  );
}
