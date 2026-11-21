'use client';

import type { Bracket, Game, OrganizerTournamentDetail, Stage } from '@nova/schemas';
import { Badge, Button, Card, cn, EmptyState, ErrorState, Modal, Progress, Skeleton, StatusPill, useToast } from '@nova/ui';
import { ArrowRight, CheckCircle2, ChevronDown, DoorClosed, Dices, ListTree, Lock, LockOpen, MonitorPlay, PencilLine, RefreshCw, Shuffle, SlidersHorizontal, Swords, Trophy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BracketView } from '@/features/brackets/BracketView';
import { StageStandings } from '@/features/brackets/StageStandings';
import { TelaoLinksDialog } from '@/features/telao/TelaoLinksDialog';
import { errorMessage } from '@/shared/api/client';
import { useBracket, useConfirmBracket, useGenerateBracket, useNextSwissRound, useStandings, useSwapSeeding, useUnlockBracket } from '@/shared/api/hooks/competition';
import { useCloseRegistration } from '@/shared/api/hooks/organizer';
import { useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { FORMAT_INFO } from '../lib/formats';
import { describeQualification, SEEDING_INFO } from '../lib/labels';
import { AdvanceStageDialog } from '../operation/AdvanceStageDialog';
import { FinishDialog } from '../operation/FinishDialog';
import { GenerateBracketForm, type GenerateEntrant } from '../operation/GenerateBracketForm';
import { ReasonDialog } from '../operation/ReasonDialog';
import { SeedingBoard } from '../operation/SeedingBoard';
import { EditStagesDialog, StageScoringDialog } from '../operation/StageConfigDialogs';
import { byOrder, canGenerateNextSwissRound, currentStage, pendingMatches, permissionsOf, playedCount, seedingContainers, STAGE_STATUS_LABEL, type OperationPermissions } from '../operation/stageUtils';
import { messages } from './messages';

interface StagePanelProps {
  tournament: OrganizerTournamentDetail;
  stage: Stage;
  prev: Stage | undefined;
  next: Stage | undefined;
  game: Game | null;
  perms: OperationPermissions;
  onGoToMatches: () => void;
  onFinished: () => void;
}

type PanelDialog = 'confirm' | 'regenerate' | 'unlock' | 'advance' | 'finish' | 'scoring' | null;

/** Como a chave foi gerada, com a seed do sorteio à mostra (ADR: o sorteio pode ser reproduzido e auditado). */
function SeedInfo({ bracket }: { bracket: Bracket }) {
  const t = useT(messages, 'StageSeedInfo');
  if (!bracket.seeding) return null;
  const distribution = t.rich('distribuicao', { tipo: SEEDING_INFO[bracket.seeding].label, strong: (chunks) => <strong className="text-text">{chunks}</strong> });
  const seed = bracket.seedUsed ? t.rich('seed', { seed: bracket.seedUsed, code: (chunks) => <code className="tabular rounded-sm bg-surface-2 px-1.5 py-0.5 text-text">{chunks}</code> }) : null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" data-testid="seed-info">
      <Dices className="size-4 shrink-0" aria-hidden />
      <span>
        {distribution}
      </span>
      {bracket.seedUsed && (
        <span>
          {seed}
        </span>
      )}
    </p>
  );
}

function StagePanel({ tournament, stage, prev, next, game, perms, onGoToMatches, onFinished }: StagePanelProps) {
  const t = useT(messages, 'StagePanel');
  const bracketQuery = useBracket(stage.id);
  const bracket = bracketQuery.data;
  const confirmed = bracket?.state === 'CONFIRMED';
  const standings = useStandings(confirmed ? stage.id : undefined);
  // Os inscritos confirmados só são necessários para montar a ordem manual da primeira fase.
  const needsRegistrations = perms.canManage && !prev && bracket?.state === 'NONE';
  const registrations = useTournamentRegistrations(needsRegistrations ? tournament.id : undefined, 'all');

  const generate = useGenerateBracket(stage.id);
  const swap = useSwapSeeding(stage.id);
  const confirm = useConfirmBracket(stage.id);
  const unlock = useUnlockBracket(stage.id);
  const nextRound = useNextSwissRound(stage.id);
  const closeRegistration = useCloseRegistration();
  const { success, error } = useToast();

  const [dialog, setDialog] = useState<PanelDialog>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);

  if (!bracket) {
    if (bracketQuery.error) return <ErrorState description={errorMessage(bracketQuery.error)} onRetry={() => void bracketQuery.refetch()} />;
    return <Skeleton className="h-40 w-full" />;
  }

  const closed = tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED' || tournament.status === 'CANCELLED';
  const canAct = perms.canManage && !closed && stage.status !== 'COMPLETED';
  const pending = pendingMatches(bracket.matches);
  const played = playedCount(bracket.matches);
  const total = bracket.matches.filter((m) => m.status !== 'CANCELLED').length;
  const containers = seedingContainers(bracket);
  const elimination = bracket.format === 'SINGLE_ELIM' || bracket.format === 'DOUBLE_ELIM' || bracket.format === 'TEAM_VS_TEAM';

  const entrants: GenerateEntrant[] = prev
    ? bracket.entrants.map((e) => ({ registrationId: e.registrationId, name: e.name }))
    : bracket.entrants.length > 0
      ? bracket.entrants.map((e) => ({ registrationId: e.registrationId, name: e.name }))
      : (registrations.data ?? [])
          .filter((r) => r.status === 'CONFIRMED')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((r) => ({ registrationId: r.id, name: r.displayName }));

  function doSwap(a: string, b: string) {
    const name = (id: string) => bracket?.entrants.find((e) => e.registrationId === id)?.name ?? t('participante');
    swap.mutate({ a, b }, { onSuccess: () => success(t('trocadas'), t('trocadasDescricao', { a: name(a), b: name(b) })), onError: (e) => error(t('erroTrocar'), errorMessage(e)) });
  }
  /** Mesma troca "selecione um, depois outro", vinda de um clique na chave desenhada. */
  function pickInBracket(registrationId: string) {
    if (selected === null) setSelected(registrationId);
    else if (selected === registrationId) setSelected(null);
    else {
      doSwap(selected, registrationId);
      setSelected(null);
    }
  }

  const generateForm = (regenerating: boolean) => (
    <GenerateBracketForm
      entrants={entrants}
      defaultSeeding={stage.seeding}
      loading={generate.isPending}
      regenerating={regenerating}
      onCancel={regenerating ? () => setDialog(null) : undefined}
      onGenerate={(input) =>
        generate.mutate(input, {
          onSuccess: (b) => {
            success(t('gerada'), b.seedUsed ? t('geradaDescricaoSeed', { seed: b.seedUsed }) : t('geradaDescricao'));
            setDialog(null);
            setAdjusting(false);
            setSelected(null);
          },
          onError: (e) => error(t('erroGerar'), errorMessage(e)),
        })
      }
    />
  );

  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const registrationOpenNote = t.rich('inscricoesAbertas', { ocupadas: tournament.takenSlots, total: tournament.maxParticipants, strong });
  const previewNote = t.rich('previa', { primeira: prev ? 'nao' : 'sim', strong });
  const lockedNote = t.rich('travada', { strong });
  const confirmLockNote = t.rich('confirmarItem3', { strong });

  const editor = (
    <>
      <SeedingBoard containers={containers} selectedId={selected} onSelect={setSelected} onSwap={doSwap} disabled={swap.isPending} />
      {elimination && <BracketView bracket={bracket} selectedRegistrationId={selected} onSlotClick={(registrationId) => pickInBracket(registrationId)} onMatchSelect={() => {}} />}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* ── Sem chave ── */}
      {bracket.state === 'NONE' &&
        (!perms.canManage ? (
          <p className="text-sm text-muted">{t('naoGerada')}</p>
        ) : prev ? (
          <p className="text-sm text-muted">
            {t('recebeClassificados', { fase: prev.name })}
          </p>
        ) : tournament.status === 'REGISTRATION_OPEN' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-info-soft p-4 text-info-soft-text">
            <p className="text-sm">
              {registrationOpenNote}
            </p>
            <div>
              <Button
                loading={closeRegistration.isPending}
                iconLeft={<DoorClosed className="size-4" aria-hidden />}
                onClick={() => closeRegistration.mutate({ id: tournament.id }, { onSuccess: () => success(t('encerradas'), t('encerradasDescricao')), onError: (e) => error(t('erroEncerrar'), errorMessage(e)) })}
              >
                {t('fecharInscricoes')}
              </Button>
            </div>
          </div>
        ) : tournament.status === 'REGISTRATION_CLOSED' || tournament.status === 'CHECK_IN' || tournament.status === 'IN_PROGRESS' ? (
          needsRegistrations && registrations.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            generateForm(false)
          )
        ) : (
          <p className="text-sm text-muted">
            {t('semChave', { status: tournament.status })}
          </p>
        ))}

      {/* ── Prévia ── */}
      {bracket.state === 'PREVIEW' && (
        <>
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" role="status">
            {previewNote}
          </p>
          <SeedInfo bracket={bracket} />
          {perms.canManage ? editor : <BracketView bracket={bracket} onMatchSelect={() => {}} />}
          {canAct && (
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="secondary" iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => setDialog('regenerate')}>
                {t('gerarDeNovo')}
              </Button>
              <Button iconLeft={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setDialog('confirm')}>
                {t('confirmarChave')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* ── Confirmada ── */}
      {bracket.state === 'CONFIRMED' && (
        <>
          <SeedInfo bracket={bracket} />
          {bracket.locked && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3" data-testid="bracket-locked">
              <p className="flex items-start gap-2 text-sm text-text">
                <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span>
                  {lockedNote}
                </span>
              </p>
              {perms.isAdmin && !closed && (
                <div>
                  <Button size="sm" variant="secondary" iconLeft={<LockOpen className="size-4" aria-hidden />} onClick={() => setDialog('unlock')}>
                    {t('destravar')}
                  </Button>
                </div>
              )}
            </div>
          )}
          {!bracket.locked && canAct && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" aria-expanded={adjusting} iconLeft={<Shuffle className="size-4" aria-hidden />} onClick={() => setAdjusting((v) => !v)}>
                  {t('ajustar', { aberto: adjusting ? 'sim' : 'nao' })}
                </Button>
                <Button size="sm" variant="secondary" iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => setDialog('regenerate')}>
                  {t('gerarDeNovo')}
                </Button>
              </div>
              <p className="text-xs text-muted">{t('aindaDa')}</p>
              {adjusting && editor}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Progress value={played} max={total} label={t('progressoRotulo', { fase: stage.name })} />
            <p className="text-sm text-muted" data-testid="stage-progress">
              {t('progresso', { count: pending.length })}
            </p>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
            <Button variant="secondary" iconLeft={<Swords className="size-4" aria-hidden />} onClick={onGoToMatches}>
              {t('verPartidas')}
            </Button>
            {canAct && stage.format === 'SWISS' && !bracket.complete && (
              <Button
                variant="secondary"
                loading={nextRound.isPending}
                disabled={!canGenerateNextSwissRound(bracket, stage.config.rounds)}
                iconLeft={<ArrowRight className="size-4" aria-hidden />}
                onClick={() => nextRound.mutate(undefined, { onSuccess: () => success(t('proximaGerada')), onError: (e) => error(t('erroRodada'), errorMessage(e)) })}
              >
                {t('gerarProxima')}
              </Button>
            )}
            {canAct && next && (
              <Button disabled={!bracket.complete} iconLeft={<ArrowRight className="size-4" aria-hidden />} onClick={() => setDialog('advance')} aria-describedby={`avanco-${stage.id}`}>
                {t('avancar')}
              </Button>
            )}
            {canAct && !next && tournament.status === 'IN_PROGRESS' && (
              <Button variant="gold" disabled={!bracket.complete} iconLeft={<Trophy className="size-4" aria-hidden />} onClick={() => setDialog('finish')} aria-describedby={`avanco-${stage.id}`}>
                {t('encerrar')}
              </Button>
            )}
            {canAct && stage.status === 'ACTIVE' && (
              <Button variant="ghost" iconLeft={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setDialog('scoring')}>
                {t('trocarPontuacao')}
              </Button>
            )}
          </div>
          {canAct && (
            <p id={`avanco-${stage.id}`} className="text-xs text-muted">
              {bracket.complete
                ? next
                  ? t('concluidaProxima', { fase: next.name })
                  : t('concluidaUltima')
                : t('disponivelQuando', { proxima: next ? 'sim' : 'nao', count: pending.length })}
            </p>
          )}

          <section className="flex flex-col gap-2" aria-label={t('classificacaoRotulo', { fase: stage.name })} data-testid="stage-standings">
            <h3 className="text-base">{t('classificacao')}</h3>
            {standings.data ? <StageStandings standings={standings.data} /> : standings.error ? <ErrorState description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} /> : <Skeleton className="h-32 w-full" />}
          </section>

          {!adjusting && (
            <section className="flex flex-col gap-2" aria-label={t('chaveRotulo', { fase: stage.name })}>
              <h3 className="text-base">{elimination ? t('chave') : t('porRodada')}</h3>
              <BracketView bracket={bracket} />
            </section>
          )}
        </>
      )}

      {/* ── Diálogos ── */}
      <Modal
        open={dialog === 'confirm'}
        onOpenChange={(open) => !open && setDialog(null)}
        size="sm"
        title={t('confirmarTitulo')}
        description={t('confirmarDescricao', { fase: stage.name, count: bracket.entrants.length })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('voltar')}
            </Button>
            <Button
              loading={confirm.isPending}
              onClick={() =>
                confirm.mutate(undefined, {
                  onSuccess: () => {
                    success(t('confirmada'), t('confirmadaDescricao'));
                    setDialog(null);
                    setSelected(null);
                  },
                  onError: (e) => error(t('erroConfirmar'), errorMessage(e)),
                })
              }
            >
              {t('confirmarChave')}
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
          <li>{t('confirmarItem1')}</li>
          <li>{t('confirmarItem2')}</li>
          <li>{confirmLockNote}</li>
        </ul>
      </Modal>

      <Modal open={dialog === 'regenerate'} onOpenChange={(open) => !open && setDialog(null)} title={t('gerarDeNovoTitulo')} description={stage.name}>
        {dialog === 'regenerate' && generateForm(true)}
      </Modal>

      <ReasonDialog
        open={dialog === 'unlock'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={t('destravarTitulo')}
        description={t('destravarDescricao')}
        confirmLabel={t('destravarConfirmar')}
        hint={t('destravarDica')}
        loading={unlock.isPending}
        onConfirm={(reason) =>
          unlock.mutate(reason, {
            onSuccess: () => {
              success(t('destravada'));
              setDialog(null);
            },
            onError: (e) => error(t('erroDestravar'), errorMessage(e)),
          })
        }
      />

      {next && <AdvanceStageDialog stage={stage} nextStage={next} open={dialog === 'advance'} onOpenChange={(open) => !open && setDialog(null)} />}
      <FinishDialog tournament={tournament} open={dialog === 'finish'} onOpenChange={(open) => !open && setDialog(null)} onFinished={onFinished} />
      {dialog === 'scoring' && <StageScoringDialog tournament={tournament} stage={stage} game={game} open onOpenChange={(open) => !open && setDialog(null)} />}
    </div>
  );
}

export interface StagesTabProps {
  tournament: OrganizerTournamentDetail;
  game: Game | null;
  onGoToMatches: () => void;
  onFinished: () => void;
}

/**
 * Aba Fases e chave (ORG-04 e ORG-05): linha do tempo das fases com o status de cada uma. Na fase
 * atual: gerar a chave (prévia → ajuste → confirmação), acompanhar o andamento e avançar de fase.
 */
export function StagesTab({ tournament, game, onGoToMatches, onFinished }: StagesTabProps) {
  const t = useT(messages, 'StagesTab');
  const stages = byOrder(tournament.stages);
  const current = currentStage(tournament.stages);
  const perms = permissionsOf(tournament.access);
  const [openId, setOpenId] = useState<string | null>(null);
  const [seenCurrent, setSeenCurrent] = useState(current?.id);
  const [editing, setEditing] = useState(false);
  const [telao, setTelao] = useState(false);
  // Quando o campeonato muda de fase (avanço confirmado), a nova fase atual abre sozinha.
  if (current?.id !== seenCurrent) {
    setSeenCurrent(current?.id);
    setOpenId(null);
  }
  const expandedId = openId ?? current?.id ?? null;
  const closed = tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED' || tournament.status === 'CANCELLED';
  const canEditStages = perms.canManage && !closed && tournament.status !== 'DRAFT' && stages.some((s) => s.status === 'PENDING');

  if (stages.length === 0) {
    return <EmptyState icon={<ListTree className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {t('totalFases', { count: stages.length })} {current && tournament.status !== 'DRAFT' && !closed ? t('faseAtualNome', { fase: current.name }) : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {tournament.status !== 'DRAFT' && (
            <Button variant="secondary" size="sm" iconLeft={<MonitorPlay className="size-4" aria-hidden />} onClick={() => setTelao(true)}>
              {t('telao')}
            </Button>
          )}
          {canEditStages && (
            <Button variant="secondary" size="sm" iconLeft={<PencilLine className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
              {t('editarFases')}
            </Button>
          )}
        </div>
      </div>

      <ol className="flex flex-col gap-3" aria-label={t('fasesRotulo')}>
        {stages.map((stage, index) => {
          const expanded = expandedId === stage.id;
          const isCurrent = current?.id === stage.id && !closed;
          const panelId = `fase-${stage.id}`;
          return (
            <li key={stage.id}>
              <Card padding="none" className={cn('overflow-hidden', isCurrent && 'border-accent')} data-testid="stage-card" data-stage={stage.id} data-status={stage.status}>
                <h2 className="text-base">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpenId(expanded ? '' : stage.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
                      {index + 1}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold break-words text-text">{stage.name}</span>
                      <span className="text-xs font-normal text-muted">
                        {FORMAT_INFO[stage.format].name}
                        {stage.qualification ? t('qualificacao', { qualificacao: describeQualification(stage.qualification, stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo') }) : t('faseFinal')}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {isCurrent && <Badge tone="accent">{t('faseAtual')}</Badge>}
                      <StatusPill status={stage.status} label={STAGE_STATUS_LABEL[stage.status]} />
                    </span>
                    <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
                  </button>
                </h2>
                {expanded && (
                  <div id={panelId} className="border-t border-border p-4">
                    <StagePanel tournament={tournament} stage={stage} prev={stages[index - 1]} next={stages[index + 1]} game={game} perms={perms} onGoToMatches={onGoToMatches} onFinished={onFinished} />
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      {telao && <TelaoLinksDialog slug={tournament.slug} stages={tournament.stages} open onOpenChange={setTelao} />}
      {editing && <EditStagesDialog tournament={tournament} game={game} open onOpenChange={(open) => !open && setEditing(false)} />}
    </div>
  );
}
