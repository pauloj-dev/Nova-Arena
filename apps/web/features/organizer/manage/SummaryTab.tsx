'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Button, Card, Modal, Progress, StatusPill, useToast } from '@nova/ui';
import { Archive, ClipboardCopy, Copy, DoorClosed, DoorOpen, FileStack, ImageDown, ListTree, PauseCircle, PencilLine, PlayCircle, Trash2, Trophy, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { Podium } from '@/features/matches/Podium';
import { usePodium } from '@/shared/api/hooks/competition';
import { useCloseRegistration, useDuplicateTournament, useOpenRegistration } from '@/shared/api/hooks/organizer';
import { useArchiveTournament, usePauseTournament, useResumeTournament } from '@/shared/api/hooks/organizer-ops';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { CancelTournamentDialog, DeleteDraftDialog, SaveTemplateDialog } from '../components/TournamentDialogs';
import { FORMAT_INFO } from '../lib/formats';
import { describeQualification } from '../lib/labels';
import { isReadOnly, lifecycleActions, statusExplanation } from '../lib/status';
import { Confetti } from '../operation/Confetti';
import { FinishDialog } from '../operation/FinishDialog';
import { ReasonDialog } from '../operation/ReasonDialog';
import { messages } from './messages';

/** `side`: na coluna estreita ao lado, rótulo e valor dividem a linha sem largura fixa (não vaza do cartão). */
function Row({ label, children, side = false }: { label: string; children: ReactNode; side?: boolean }) {
  if (side) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="min-w-0 text-sm text-text">{children}</dd>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 xs:flex-row xs:gap-3">
      <dt className="shrink-0 text-sm text-muted xs:w-48">{label}</dt>
      <dd className="min-w-0 text-sm text-text">{children}</dd>
    </div>
  );
}

const dateOr = (iso: string | null, fallback: string) => (iso ? formatDateTime(iso) : <span className="text-muted">{fallback}</span>);

/** Aba Resumo: estado, datas, vagas, link público e as ações do ciclo de vida que valem para o estado atual. */
export interface SummaryTabProps {
  tournament: OrganizerTournamentDetail;
  onGoToStages?: () => void;
  /** Chamado quando o campeonato é encerrado por esta tela. */
  onFinished?: () => void;
  /** Acabou de ser encerrado nesta sessão: solta o confete. */
  celebrate?: boolean;
}

export function SummaryTab({ tournament, onGoToStages, onFinished, celebrate = false }: SummaryTabProps) {
  const t = useT(messages, 'SummaryTab');
  const router = useRouter();
  const { success, error } = useToast();
  const open = useOpenRegistration();
  const close = useCloseRegistration();
  const duplicate = useDuplicateTournament();
  const pause = usePauseTournament();
  const resume = useResumeTournament();
  const archive = useArchiveTournament();
  const finished = tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED';
  const podium = usePodium(finished ? tournament.id : undefined);
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'template' | 'pause' | 'resume' | 'finish' | 'archive' | null>(null);

  const isDraft = tournament.status === 'DRAFT';
  const isModerator = tournament.access === 'MODERATOR';
  const isOwner = tournament.access === 'OWNER' || tournament.access === 'ADMIN';
  const canManage = !isModerator;
  const actions = canManage ? lifecycleActions(tournament.status) : [];
  const publicPath = `/c/${tournament.slug}`;
  const stages = [...tournament.stages].sort((a, b) => a.order - b.order);
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const pauseReason = tournament.pauseReason ? t.rich('motivoPausa', { motivo: tournament.pauseReason, strong }) : null;
  const cancelReason = tournament.cancelReason ? t.rich('motivoCancelamento', { motivo: tournament.cancelReason, strong }) : null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      success(t('linkCopiado'));
    } catch {
      error(t('erroCopiar'), t('erroCopiarDescricao'));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">{t('situacao')}</h2>
            <StatusPill status={tournament.status} />
          </div>
          <p className="text-sm text-text">{statusExplanation(tournament.status)}</p>
          {tournament.status === 'PAUSED' && tournament.pauseReason && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" data-testid="pause-reason">
              {pauseReason}
            </p>
          )}
          {tournament.cancelReason && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
              {cancelReason}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('acoes')}>
              {isDraft && (
                <Button asChild>
                  <Link href={`/organizador/campeonatos/${tournament.id}/editar`}>
                    <PencilLine className="size-4" aria-hidden />
                    {t('continuarRascunho')}
                  </Link>
                </Button>
              )}
              {actions.includes('open-registration') && (
                <Button
                  loading={open.isPending}
                  iconLeft={<DoorOpen className="size-4" aria-hidden />}
                  onClick={() => open.mutate({ id: tournament.id }, { onSuccess: () => success(t('abertas')), onError: (e) => error(t('erroAbrir'), errorMessage(e)) })}
                >
                  {t('abrirAgora')}
                </Button>
              )}
              {actions.includes('close-registration') && (
                <Button
                  variant="secondary"
                  loading={close.isPending}
                  iconLeft={<DoorClosed className="size-4" aria-hidden />}
                  onClick={() => close.mutate({ id: tournament.id }, { onSuccess: () => success(t('encerradas')), onError: (e) => error(t('erroEncerrar'), errorMessage(e)) })}
                >
                  {t('encerrarInscricoes')}
                </Button>
              )}
              {actions.includes('start') && (
                <Button iconLeft={<ListTree className="size-4" aria-hidden />} onClick={onGoToStages}>
                  {t('gerarChave')}
                </Button>
              )}
              {actions.includes('resume') && (
                <Button iconLeft={<PlayCircle className="size-4" aria-hidden />} onClick={() => setDialog('resume')}>
                  {t('retomar')}
                </Button>
              )}
              {actions.includes('finish') && (
                <Button variant="gold" iconLeft={<Trophy className="size-4" aria-hidden />} onClick={() => setDialog('finish')}>
                  {t('encerrar')}
                </Button>
              )}
              {actions.includes('pause') && (
                <Button variant="secondary" iconLeft={<PauseCircle className="size-4" aria-hidden />} onClick={() => setDialog('pause')}>
                  {t('pausar')}
                </Button>
              )}
              {actions.includes('archive') && (
                <Button variant="secondary" iconLeft={<Archive className="size-4" aria-hidden />} onClick={() => setDialog('archive')}>
                  {t('arquivar')}
                </Button>
              )}
              {!isDraft && !isReadOnly(tournament.status) && (
                <Button asChild variant="secondary">
                  <Link href={`/organizador/campeonatos/${tournament.id}/editar`}>
                    <PencilLine className="size-4" aria-hidden />
                    {t('editar')}
                  </Link>
                </Button>
              )}
              <Button
                variant="secondary"
                loading={duplicate.isPending}
                iconLeft={<Copy className="size-4" aria-hidden />}
                onClick={() =>
                  duplicate.mutate(
                    { id: tournament.id },
                    {
                      onSuccess: (copy) => {
                        success(t('duplicado'), t('duplicadoDescricao'));
                        router.push(`/organizador/campeonatos/${copy.id}/editar`);
                      },
                      onError: (e) => error(t('erroDuplicar'), errorMessage(e)),
                    },
                  )
                }
              >
                {t('duplicar')}
              </Button>
              {stages.length > 0 && (
                <Button variant="secondary" iconLeft={<FileStack className="size-4" aria-hidden />} onClick={() => setDialog('template')}>
                  {t('salvarModelo')}
                </Button>
              )}
              {isDraft && isOwner && (
                <Button variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setDialog('delete')}>
                  {t('excluirRascunho')}
                </Button>
              )}
              {actions.includes('cancel') && isOwner && (
                <Button variant="ghost" iconLeft={<XCircle className="size-4" aria-hidden />} onClick={() => setDialog('cancel')}>
                  {t('cancelar')}
                </Button>
              )}
            </div>
          )}
        </Card>

        {finished && podium.data && (
          <Card className="flex flex-col gap-4" data-testid="closing-card">
            {celebrate && <Confetti />}
            <Podium podium={podium.data} />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <Link href={`/c/${tournament.slug}/arte`}>
                  <ImageDown className="size-4" aria-hidden />
                  {t('arte')}
                </Link>
              </Button>
            </div>
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('datas')}</h2>
          <dl className="flex flex-col gap-2">
            <Row label={t('aberturaInscricoes')}>{dateOr(tournament.registrationOpensAt, isDraft ? t('aoPublicar') : t('naoDefinida'))}</Row>
            <Row label={t('fechamentoInscricoes')}>{dateOr(tournament.registrationClosesAt, t('naoDefinido'))}</Row>
            <Row label={t('inicio')}>{dateOr(tournament.startsAt, t('naoDefinido'))}</Row>
            {tournament.participantType === 'TEAM' && <Row label={t('travaElenco')}>{dateOr(tournament.rosterLockAt, t('semTrava'))}</Row>}
            <Row label={t('checkIn')}>{tournament.checkIn.enabled ? t('checkInJanela', { abre: tournament.checkIn.opensMinutesBefore, fecha: tournament.checkIn.closesMinutesBefore }) : t('naoExigido')}</Row>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('fases')}</h2>
          {stages.length === 0 ? (
            <p className="text-sm text-muted">{t('semFases')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {stages.map((stage, index) => (
                <li key={stage.id} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-text">
                      {stage.name} <span className="font-normal text-muted">{t('formato', { formato: FORMAT_INFO[stage.format].name })}</span>
                    </p>
                    {stage.qualification && <p className="text-muted">{t('avancam', { qualificacao: describeQualification(stage.qualification, stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo') })}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('vagas')}</h2>
          <Progress value={tournament.takenSlots} max={tournament.maxParticipants} label={t('vagasOcupadas')} />
          <dl className="flex flex-col gap-2">
            <Row side label={t('aprovacao')}>{tournament.manualApproval ? t('manual') : t('automatica')}</Row>
            <Row side label={t('aguardandoAprovacao')}>{tournament.pendingApprovals}</Row>
            <Row side label={t('listaEspera')}>{tournament.waitlistEnabled ? t('naFila', { count: tournament.waitlistCount }) : t('desligada')}</Row>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('paginaPublica')}</h2>
          {isDraft ? (
            <p className="text-sm text-muted">{t('paginaInexistente')}</p>
          ) : (
            <>
              <p className="break-all text-sm text-text">
                <Link href={publicPath} className="font-semibold underline">
                  {publicPath}
                </Link>
              </p>
              <div>
                <Button variant="secondary" size="sm" iconLeft={<ClipboardCopy className="size-4" aria-hidden />} onClick={() => void copyLink()}>
                  {t('copiarLink')}
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'pause'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('pausarTitulo')}
        description={t('pausarDescricao')}
        label={t('motivoPausaRotulo')}
        confirmLabel={t('pausar')}
        loading={pause.isPending}
        onConfirm={(reason) =>
          pause.mutate(
            { id: tournament.id, reason },
            {
              onSuccess: () => {
                success(t('pausado'), t('inscritosAvisados'));
                setDialog(null);
              },
              onError: (e) => error(t('erroPausar'), errorMessage(e)),
            },
          )
        }
      />
      <ReasonDialog
        open={dialog === 'resume'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('retomarTitulo')}
        description={t('retomarDescricao')}
        label={t('recado')}
        required={false}
        confirmLabel={t('retomar')}
        loading={resume.isPending}
        onConfirm={(reason) =>
          resume.mutate(
            { id: tournament.id, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => {
                success(t('retomado'), t('inscritosAvisados'));
                setDialog(null);
              },
              onError: (e) => error(t('erroRetomar'), errorMessage(e)),
            },
          )
        }
      />
      <Modal
        open={dialog === 'archive'}
        onOpenChange={(o) => !o && setDialog(null)}
        size="sm"
        title={t('arquivarTitulo')}
        description={t('arquivarDescricao')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('voltar')}
            </Button>
            <Button
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: tournament.id },
                  {
                    onSuccess: () => {
                      success(t('arquivado'));
                      setDialog(null);
                    },
                    onError: (e) => error(t('erroArquivar'), errorMessage(e)),
                  },
                )
              }
            >
              {t('arquivarConfirmar')}
            </Button>
          </>
        }
      />
      <FinishDialog tournament={tournament} open={dialog === 'finish'} onOpenChange={(o) => !o && setDialog(null)} onFinished={onFinished} />
      <CancelTournamentDialog tournament={tournament} open={dialog === 'cancel'} onOpenChange={(o) => !o && setDialog(null)} />
      <DeleteDraftDialog tournament={tournament} open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} onDone={() => router.push('/organizador/campeonatos')} />
      <SaveTemplateDialog tournament={tournament} open={dialog === 'template'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}
