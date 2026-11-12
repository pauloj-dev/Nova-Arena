'use client';

import type { Bracket, Game, OrganizerTournamentDetail, Stage } from '@nova/schemas';
import { Badge, Button, Card, cn, EmptyState, ErrorState, Modal, Progress, Skeleton, StatusPill, useToast } from '@nova/ui';
import { ArrowRight, CheckCircle2, ChevronDown, DoorClosed, Dices, ListTree, Lock, LockOpen, PencilLine, RefreshCw, Shuffle, SlidersHorizontal, Swords, Trophy } from 'lucide-react';
import { useState } from 'react';
import { BracketView } from '@/features/brackets/BracketView';
import { StageStandings } from '@/features/brackets/StageStandings';
import { errorMessage } from '@/shared/api/client';
import { useBracket, useConfirmBracket, useGenerateBracket, useNextSwissRound, useStandings, useSwapSeeding, useUnlockBracket } from '@/shared/api/hooks/competition';
import { useCloseRegistration } from '@/shared/api/hooks/organizer';
import { useTournamentRegistrations } from '@/shared/api/hooks/tournaments';
import { FORMAT_INFO } from '../lib/formats';
import { describeQualification, SEEDING_INFO } from '../lib/labels';
import { AdvanceStageDialog } from '../operation/AdvanceStageDialog';
import { FinishDialog } from '../operation/FinishDialog';
import { GenerateBracketForm, type GenerateEntrant } from '../operation/GenerateBracketForm';
import { ReasonDialog } from '../operation/ReasonDialog';
import { SeedingBoard } from '../operation/SeedingBoard';
import { EditStagesDialog, StageScoringDialog } from '../operation/StageConfigDialogs';
import { byOrder, canGenerateNextSwissRound, currentStage, pendingMatches, permissionsOf, playedCount, seedingContainers, STAGE_STATUS_LABEL, type OperationPermissions } from '../operation/stageUtils';

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
  if (!bracket.seeding) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" data-testid="seed-info">
      <Dices className="size-4 shrink-0" aria-hidden />
      <span>
        Distribuição: <strong className="text-text">{SEEDING_INFO[bracket.seeding].label}</strong>
      </span>
      {bracket.seedUsed && (
        <span>
          · Seed do sorteio: <code className="tabular rounded-sm bg-surface-2 px-1.5 py-0.5 text-text">{bracket.seedUsed}</code> (registrada na auditoria)
        </span>
      )}
    </p>
  );
}

function StagePanel({ tournament: t, stage, prev, next, game, perms, onGoToMatches, onFinished }: StagePanelProps) {
  const bracketQuery = useBracket(stage.id);
  const bracket = bracketQuery.data;
  const confirmed = bracket?.state === 'CONFIRMED';
  const standings = useStandings(confirmed ? stage.id : undefined);
  // Os inscritos confirmados só são necessários para montar a ordem manual da primeira fase.
  const needsRegistrations = perms.canManage && !prev && bracket?.state === 'NONE';
  const registrations = useTournamentRegistrations(needsRegistrations ? t.id : undefined, 'all');

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

  const closed = t.status === 'FINISHED' || t.status === 'ARCHIVED' || t.status === 'CANCELLED';
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
    const name = (id: string) => bracket?.entrants.find((e) => e.registrationId === id)?.name ?? 'Participante';
    swap.mutate({ a, b }, { onSuccess: () => success('Posições trocadas', `${name(a)} e ${name(b)} trocaram de lugar. A troca fica na auditoria.`), onError: (e) => error('Não foi possível trocar', errorMessage(e)) });
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
            success('Chave gerada', `Esta é uma prévia: só a organização vê.${b.seedUsed ? ` Seed do sorteio: ${b.seedUsed}.` : ''}`);
            setDialog(null);
            setAdjusting(false);
            setSelected(null);
          },
          onError: (e) => error('Não foi possível gerar a chave', errorMessage(e)),
        })
      }
    />
  );

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
          <p className="text-sm text-muted">A chave desta fase ainda não foi gerada pela organização.</p>
        ) : prev ? (
          <p className="text-sm text-muted">
            Esta fase recebe os classificados de “{prev.name}”. Quando todas as partidas dela tiverem resultado, use “Avançar fase” para ver a prévia e preencher esta chave.
          </p>
        ) : t.status === 'REGISTRATION_OPEN' ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-info-soft p-4 text-info-soft-text">
            <p className="text-sm">
              <strong>As inscrições ainda estão abertas.</strong> A chave é montada com os inscritos confirmados, então é preciso fechar as inscrições antes de gerar. Hoje são {t.takenSlots} de {t.maxParticipants} vagas ocupadas.
            </p>
            <div>
              <Button
                loading={closeRegistration.isPending}
                iconLeft={<DoorClosed className="size-4" aria-hidden />}
                onClick={() => closeRegistration.mutate({ id: t.id }, { onSuccess: () => success('Inscrições encerradas', 'Agora você já pode gerar a chave.'), onError: (e) => error('Não foi possível encerrar as inscrições', errorMessage(e)) })}
              >
                Fechar inscrições
              </Button>
            </div>
          </div>
        ) : t.status === 'REGISTRATION_CLOSED' || t.status === 'CHECK_IN' || t.status === 'IN_PROGRESS' ? (
          needsRegistrations && registrations.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            generateForm(false)
          )
        ) : (
          <p className="text-sm text-muted">
            {t.status === 'DRAFT' ? 'Publique o campeonato e receba as inscrições antes de gerar a chave.' : t.status === 'PUBLISHED' ? 'As inscrições ainda não abriram. A chave é gerada depois que elas fecham.' : t.status === 'PAUSED' ? 'O campeonato está pausado. Retome para gerar a chave.' : 'Este campeonato não tem chave gerada.'}
          </p>
        ))}

      {/* ── Prévia ── */}
      {bracket.state === 'PREVIEW' && (
        <>
          <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" role="status">
            <strong>Prévia da chave.</strong> Só a organização vê. Ajuste as posições se precisar e confirme para valer{prev ? '' : ' — é a confirmação que põe o campeonato em andamento'}.
          </p>
          <SeedInfo bracket={bracket} />
          {perms.canManage ? editor : <BracketView bracket={bracket} onMatchSelect={() => {}} />}
          {canAct && (
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="secondary" iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => setDialog('regenerate')}>
                Gerar de novo
              </Button>
              <Button iconLeft={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setDialog('confirm')}>
                Confirmar chave
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
                  <strong>Chave travada.</strong> Esta fase já tem partida concluída, então as posições não mudam mais e a chave não pode ser gerada de novo. Só um administrador da Nova Arena pode destravar, informando o motivo.
                </span>
              </p>
              {perms.isAdmin && !closed && (
                <div>
                  <Button size="sm" variant="secondary" iconLeft={<LockOpen className="size-4" aria-hidden />} onClick={() => setDialog('unlock')}>
                    Destravar
                  </Button>
                </div>
              )}
            </div>
          )}
          {!bracket.locked && canAct && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" aria-expanded={adjusting} iconLeft={<Shuffle className="size-4" aria-hidden />} onClick={() => setAdjusting((v) => !v)}>
                  {adjusting ? 'Fechar o ajuste de posições' : 'Ajustar posições'}
                </Button>
                <Button size="sm" variant="secondary" iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => setDialog('regenerate')}>
                  Gerar de novo
                </Button>
              </div>
              <p className="text-xs text-muted">Ainda dá para ajustar ou gerar de novo porque nenhuma partida desta fase foi concluída. Depois da primeira, a chave trava.</p>
              {adjusting && editor}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Progress value={played} max={total} label={`Partidas concluídas em ${stage.name}`} />
            <p className="text-sm text-muted" data-testid="stage-progress">
              {pending.length === 0 ? 'Todas as partidas desta fase têm resultado.' : pending.length === 1 ? 'Falta 1 partida para concluir a fase.' : `Faltam ${pending.length} partidas para concluir a fase.`}
            </p>
          </div>

          <div className="flex flex-col gap-2 md:flex-row md:flex-wrap">
            <Button variant="secondary" iconLeft={<Swords className="size-4" aria-hidden />} onClick={onGoToMatches}>
              Ver partidas e lançar resultados
            </Button>
            {canAct && stage.format === 'SWISS' && !bracket.complete && (
              <Button
                variant="secondary"
                loading={nextRound.isPending}
                disabled={!canGenerateNextSwissRound(bracket, stage.config.rounds)}
                iconLeft={<ArrowRight className="size-4" aria-hidden />}
                onClick={() => nextRound.mutate(undefined, { onSuccess: () => success('Próxima rodada gerada'), onError: (e) => error('Não foi possível gerar a rodada', errorMessage(e)) })}
              >
                Gerar próxima rodada
              </Button>
            )}
            {canAct && next && (
              <Button disabled={!bracket.complete} iconLeft={<ArrowRight className="size-4" aria-hidden />} onClick={() => setDialog('advance')} aria-describedby={`avanco-${stage.id}`}>
                Avançar fase
              </Button>
            )}
            {canAct && !next && t.status === 'IN_PROGRESS' && (
              <Button variant="gold" disabled={!bracket.complete} iconLeft={<Trophy className="size-4" aria-hidden />} onClick={() => setDialog('finish')} aria-describedby={`avanco-${stage.id}`}>
                Encerrar campeonato
              </Button>
            )}
            {canAct && stage.status === 'ACTIVE' && (
              <Button variant="ghost" iconLeft={<SlidersHorizontal className="size-4" aria-hidden />} onClick={() => setDialog('scoring')}>
                Trocar pontuação
              </Button>
            )}
          </div>
          {canAct && (
            <p id={`avanco-${stage.id}`} className="text-xs text-muted">
              {bracket.complete
                ? next
                  ? `Fase concluída. "Avançar fase" mostra a prévia dos classificados para "${next.name}".`
                  : 'Última fase concluída. Você já pode encerrar o campeonato e definir o pódio.'
                : `${next ? 'O avanço' : 'O encerramento'} fica disponível quando ${pending.length === 1 ? 'a partida que falta tiver' : `as ${pending.length} partidas que faltam tiverem`} resultado.`}
            </p>
          )}

          <section className="flex flex-col gap-2" aria-label={`Classificação de ${stage.name}`} data-testid="stage-standings">
            <h3 className="text-base">Classificação</h3>
            {standings.data ? <StageStandings standings={standings.data} /> : standings.error ? <ErrorState description={errorMessage(standings.error)} onRetry={() => void standings.refetch()} /> : <Skeleton className="h-32 w-full" />}
          </section>

          {!adjusting && (
            <section className="flex flex-col gap-2" aria-label={`Chave de ${stage.name}`}>
              <h3 className="text-base">{elimination ? 'Chave' : 'Partidas por rodada'}</h3>
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
        title="Confirmar a chave?"
        description={`${stage.name} · ${bracket.entrants.length} participantes`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Voltar
            </Button>
            <Button
              loading={confirm.isPending}
              onClick={() =>
                confirm.mutate(undefined, {
                  onSuccess: () => {
                    success('Chave confirmada', 'Os participantes foram avisados e as partidas já podem ser agendadas.');
                    setDialog(null);
                    setSelected(null);
                  },
                  onError: (e) => error('Não foi possível confirmar a chave', errorMessage(e)),
                })
              }
            >
              Confirmar chave
            </Button>
          </>
        }
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
          <li>A chave fica pública e os participantes são avisados.</li>
          <li>Enquanto nenhuma partida terminar, você ainda pode ajustar posições ou gerar de novo.</li>
          <li>
            <strong>Depois da primeira partida concluída, a chave trava</strong>: só um administrador destrava.
          </li>
        </ul>
      </Modal>

      <Modal open={dialog === 'regenerate'} onOpenChange={(open) => !open && setDialog(null)} title="Gerar a chave de novo" description={stage.name}>
        {dialog === 'regenerate' && generateForm(true)}
      </Modal>

      <ReasonDialog
        open={dialog === 'unlock'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Destravar a chave"
        description="Destravar permite ajustar posições mesmo com partidas concluídas. Use só para corrigir um erro de chaveamento."
        confirmLabel="Destravar chave"
        hint="O motivo fica na auditoria do campeonato."
        loading={unlock.isPending}
        onConfirm={(reason) =>
          unlock.mutate(reason, {
            onSuccess: () => {
              success('Chave destravada');
              setDialog(null);
            },
            onError: (e) => error('Não foi possível destravar', errorMessage(e)),
          })
        }
      />

      {next && <AdvanceStageDialog stage={stage} nextStage={next} open={dialog === 'advance'} onOpenChange={(open) => !open && setDialog(null)} />}
      <FinishDialog tournament={t} open={dialog === 'finish'} onOpenChange={(open) => !open && setDialog(null)} onFinished={onFinished} />
      {dialog === 'scoring' && <StageScoringDialog tournament={t} stage={stage} game={game} open onOpenChange={(open) => !open && setDialog(null)} />}
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
export function StagesTab({ tournament: t, game, onGoToMatches, onFinished }: StagesTabProps) {
  const stages = byOrder(t.stages);
  const current = currentStage(t.stages);
  const perms = permissionsOf(t.access);
  const [openId, setOpenId] = useState<string | null>(null);
  const [seenCurrent, setSeenCurrent] = useState(current?.id);
  const [editing, setEditing] = useState(false);
  // Quando o campeonato muda de fase (avanço confirmado), a nova fase atual abre sozinha.
  if (current?.id !== seenCurrent) {
    setSeenCurrent(current?.id);
    setOpenId(null);
  }
  const expandedId = openId ?? current?.id ?? null;
  const closed = t.status === 'FINISHED' || t.status === 'ARCHIVED' || t.status === 'CANCELLED';
  const canEditStages = perms.canManage && !closed && t.status !== 'DRAFT' && stages.some((s) => s.status === 'PENDING');

  if (stages.length === 0) {
    return <EmptyState icon={<ListTree className="size-7" />} title="Nenhuma fase montada" description="Monte as fases no assistente do campeonato para poder gerar a chave." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {stages.length} {stages.length === 1 ? 'fase' : 'fases'}. {current && t.status !== 'DRAFT' && !closed ? `Fase atual: ${current.name}.` : ''}
        </p>
        {canEditStages && (
          <Button variant="secondary" size="sm" iconLeft={<PencilLine className="size-4" aria-hidden />} onClick={() => setEditing(true)}>
            Editar fases que não começaram
          </Button>
        )}
      </div>

      <ol className="flex flex-col gap-3" aria-label="Fases do campeonato, em ordem">
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
                        {stage.qualification ? ` · ${describeQualification(stage.qualification, stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo')} avançam` : ' · fase final'}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {isCurrent && <Badge tone="accent">Fase atual</Badge>}
                      <StatusPill status={stage.status} label={STAGE_STATUS_LABEL[stage.status]} />
                    </span>
                    <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', expanded && 'rotate-180')} aria-hidden />
                  </button>
                </h2>
                {expanded && (
                  <div id={panelId} className="border-t border-border p-4">
                    <StagePanel tournament={t} stage={stage} prev={stages[index - 1]} next={stages[index + 1]} game={game} perms={perms} onGoToMatches={onGoToMatches} onFinished={onFinished} />
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ol>

      {editing && <EditStagesDialog tournament={t} game={game} open onOpenChange={(open) => !open && setEditing(false)} />}
    </div>
  );
}
