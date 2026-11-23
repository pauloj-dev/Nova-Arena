'use client';

import { Badge, Button, Card } from '@nova/ui';
import { AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { ScoringPreview } from '@/features/scoring/ScoringModelEditor';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { RichTextView } from '../../components/RichText';
import { stageTitle } from '../../lib/draft';
import { stageMatchType } from '../../lib/formats';
import { describeQualification, SEEDING_INFO, tiebreakerLabel } from '../../lib/labels';
import { computeStageFlow, WIZARD_STEPS } from '../../validation';
import { useWizard } from '../context';
import { messages } from '../messages';

function Block({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  const { goToStep, issues } = useWizard();
  const t = useT(messages, 'ReviewStep');
  const pending = issues.filter((i) => i.step === step).length;
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-text">{title}</h3>
          {pending > 0 && (
            <Badge tone="danger" icon={<AlertTriangle className="size-3.5" aria-hidden />}>
              {t('pendencias', { count: pending })}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" iconLeft={<Pencil className="size-4" aria-hidden />} onClick={() => goToStep(step)} aria-label={t('editarAria', { titulo: title })}>
          {t('editar')}
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

/** Unidade de agrupamento da fase, como `describeQualification` espera. */
const poolUnitOf = (format: string) => (format === 'BATTLE_ROYALE' ? 'sala' : 'grupo');

interface ReviewStepProps {
  /** Erro da última tentativa de publicar (limite do organizador, pendência vista só pela API…). */
  publishError: string | null;
}

/** Passo 7 — Revisão: resumo de tudo e as pendências, cada uma com o caminho para o passo que resolve. */
export function ReviewStep({ publishError }: ReviewStepProps) {
  const { values, game, mode, issues, goToStep, isPublished } = useWizard();
  const flow = computeStageFlow(values.stages, values.maxParticipants);
  const isTeam = (mode?.teamSize ?? 1) > 1;
  const t = useT(messages, 'ReviewStep');

  return (
    <div className="flex flex-col gap-4">
      {issues.length > 0 ? (
        <div role="alert" className="rounded-lg border border-danger bg-danger-soft p-4 text-danger-soft-text" data-testid="review-issues">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-5 shrink-0" aria-hidden />
            {t('faltamPontos', { count: issues.length, acao: isPublished ? 'salvar' : 'publicar' })}
          </h3>
          <ul className="mt-3 flex flex-col gap-2">
            {issues.map((issue) => (
              <li key={`${issue.field}-${issue.message}`} className="flex flex-col gap-1 text-sm xs:flex-row xs:items-center xs:justify-between xs:gap-3">
                <span className="min-w-0">{issue.message}</span>
                <button type="button" onClick={() => goToStep(issue.step)} className="min-h-11 shrink-0 self-start rounded-md px-2 text-left font-semibold underline hover:bg-surface xs:self-auto md:min-h-8">
                  {t('irPara', { passo: WIZARD_STEPS[issue.step]?.label ?? '' })}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-primary bg-primary-soft p-4 text-sm font-medium text-primary-soft-text">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden />
          {isPublished ? t('tudoCertoSalvar') : t('tudoProntoPublicar')}
        </div>
      )}
      {publishError && (
        <p role="alert" className="rounded-lg border border-danger bg-danger-soft p-4 text-sm font-medium text-danger-soft-text">
          {publishError}
        </p>
      )}

      <Block step={0} title={t('informacoes')}>
        <dl className="flex flex-col gap-2">
          <Row label={t('nome')}>{values.name.trim() || <span className="text-muted">{t('semNome')}</span>}</Row>
          <Row label={t('banner')}>{values.bannerUrl ? t('imagemEscolhida') : <span className="text-muted">{t('semBanner')}</span>}</Row>
          <Row label={t('premiacao')}>{values.prize.trim() || <span className="text-muted">{t('naoInformada')}</span>}</Row>
          <Row label={t('transmissao')}>{values.streamUrls.length > 0 ? values.streamUrls.join(', ') : <span className="text-muted">{t('semLinks')}</span>}</Row>
          <Row label={t('descricao')}>
            <RichTextView html={values.description} empty={t('semDescricao')} />
          </Row>
        </dl>
      </Block>

      <Block step={1} title={t('jogoEModo')}>
        <dl className="flex flex-col gap-2">
          <Row label={t('jogo')}>
            {game ? (
              <>
                <span aria-hidden>{game.icon} </span>
                {game.name}
              </>
            ) : (
              <span className="text-muted">{t('naoEscolhido')}</span>
            )}
          </Row>
          <Row label={t('modo')}>{mode ? t('modoResumo', { modo: mode.name, equipe: isTeam ? 'sim' : 'nao', tamanho: mode.teamSize }) : <span className="text-muted">{t('naoEscolhido')}</span>}</Row>
        </dl>
      </Block>

      <Block step={2} title={t('inscricoes')}>
        <dl className="flex flex-col gap-2">
          <Row label={t('vagas')}>
            {t('vagasResumo', { count: values.maxParticipants, equipe: isTeam ? 'sim' : 'nao', espera: values.waitlistEnabled ? 'sim' : 'nao' })}
          </Row>
          <Row label={t('aprovacao')}>{values.manualApproval ? t('aprovacaoManual') : t('aprovacaoAutomatica')}</Row>
          <Row label={t('abertura')}>{dateOr(values.registrationOpensAt, t('assimQuePublicar'))}</Row>
          <Row label={t('fechamento')}>{dateOr(values.registrationClosesAt, t('naoDefinido'))}</Row>
          <Row label={t('inicio')}>{dateOr(values.startsAt, t('naoDefinido'))}</Row>
          {isTeam && <Row label={t('travaElenco')}>{dateOr(values.rosterLockAt, t('semTrava'))}</Row>}
          <Row label={t('checkIn')}>
            {values.checkIn.enabled
              ? t('checkInResumo', { abre: values.checkIn.opensMinutesBefore, fecha: values.checkIn.closesMinutesBefore, quem: isTeam ? (values.checkIn.requireAllMembers ? 'todos' : 'capitao') : 'nenhum' })
              : t('naoExigido')}
          </Row>
        </dl>
      </Block>

      <Block step={3} title={t('fases')}>
        {values.stages.length === 0 ? (
          <p className="text-sm text-muted">{t('nenhumaFase')}</p>
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
                      {t('fluxoChaveamento', {
                        fluxo: step?.entrants != null ? (index === 0 ? t('comecaCom', { count: step.entrants }) : t('recebe', { count: step.entrants })) : t('participantesADefinir'),
                        metodo: SEEDING_INFO[stage.seeding].label.toLowerCase(),
                      })}
                    </p>
                    {stage.qualification && (
                      <p className="text-muted">
                        {step?.qualified != null
                          ? t('classificacaoAvancam', { regra: describeQualification(stage.qualification, poolUnitOf(stage.format)), count: step.qualified })
                          : describeQualification(stage.qualification, poolUnitOf(stage.format))}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Block>

      <Block step={4} title={t('pontuacao')}>
        {values.stages.length === 0 || !game || !mode ? (
          <p className="text-sm text-muted">{t('definidaPorFase')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {values.stages.map((stage, index) => {
              const model = game.scoringModels.find((m) => m.id === stage.scoringModelId);
              return (
                <li key={stage.key} className="flex flex-col gap-1 text-sm">
                  <p className="font-semibold text-text">
                    {stage.name.trim() || t('faseNome', { n: index + 1 })}: <span className="font-normal">{model?.name ?? t('semModelo')}</span>
                  </p>
                  {model && <ScoringPreview rules={model.rules} matchType={stageMatchType(stage.format, stage.config, mode)} extraStats={game.extraStatFields} />}
                  <p className="text-muted">{t('desempate', { criterios: stage.tiebreakers.map((tb) => tiebreakerLabel(tb)).join(' → ') })}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block step={5} title={t('regras')}>
        <RichTextView html={values.rules} empty={t('semRegulamento')} className="max-h-64 overflow-y-auto" />
      </Block>
    </div>
  );
}
