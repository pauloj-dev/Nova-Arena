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
import { formatDateTime } from '@/shared/lib/datetime';
import { CancelTournamentDialog, DeleteDraftDialog, SaveTemplateDialog } from '../components/TournamentDialogs';
import { FORMAT_INFO } from '../lib/formats';
import { describeQualification } from '../lib/labels';
import { isReadOnly, lifecycleActions, statusExplanation } from '../lib/status';
import { Confetti } from '../operation/Confetti';
import { FinishDialog } from '../operation/FinishDialog';
import { ReasonDialog } from '../operation/ReasonDialog';

function Row({ label, children }: { label: string; children: ReactNode }) {
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

export function SummaryTab({ tournament: t, onGoToStages, onFinished, celebrate = false }: SummaryTabProps) {
  const router = useRouter();
  const { success, error } = useToast();
  const open = useOpenRegistration();
  const close = useCloseRegistration();
  const duplicate = useDuplicateTournament();
  const pause = usePauseTournament();
  const resume = useResumeTournament();
  const archive = useArchiveTournament();
  const finished = t.status === 'FINISHED' || t.status === 'ARCHIVED';
  const podium = usePodium(finished ? t.id : undefined);
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'template' | 'pause' | 'resume' | 'finish' | 'archive' | null>(null);

  const isDraft = t.status === 'DRAFT';
  const isModerator = t.access === 'MODERATOR';
  const isOwner = t.access === 'OWNER' || t.access === 'ADMIN';
  const canManage = !isModerator;
  const actions = canManage ? lifecycleActions(t.status) : [];
  const publicPath = `/c/${t.slug}`;
  const stages = [...t.stages].sort((a, b) => a.order - b.order);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicPath}`);
      success('Link copiado');
    } catch {
      error('Não foi possível copiar', 'Copie o endereço direto da barra do navegador na página pública.');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg">Situação</h2>
            <StatusPill status={t.status} />
          </div>
          <p className="text-sm text-text">{statusExplanation(t.status)}</p>
          {t.status === 'PAUSED' && t.pauseReason && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-text" data-testid="pause-reason">
              <strong>Motivo da pausa:</strong> {t.pauseReason}
            </p>
          )}
          {t.cancelReason && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
              <strong>Motivo do cancelamento:</strong> {t.cancelReason}
            </p>
          )}
          {canManage && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Ações do campeonato">
              {isDraft && (
                <Button asChild>
                  <Link href={`/organizador/campeonatos/${t.id}/editar`}>
                    <PencilLine className="size-4" aria-hidden />
                    Continuar rascunho
                  </Link>
                </Button>
              )}
              {actions.includes('open-registration') && (
                <Button
                  loading={open.isPending}
                  iconLeft={<DoorOpen className="size-4" aria-hidden />}
                  onClick={() => open.mutate({ id: t.id }, { onSuccess: () => success('Inscrições abertas'), onError: (e) => error('Não foi possível abrir as inscrições', errorMessage(e)) })}
                >
                  Abrir inscrições agora
                </Button>
              )}
              {actions.includes('close-registration') && (
                <Button
                  variant="secondary"
                  loading={close.isPending}
                  iconLeft={<DoorClosed className="size-4" aria-hidden />}
                  onClick={() => close.mutate({ id: t.id }, { onSuccess: () => success('Inscrições encerradas'), onError: (e) => error('Não foi possível encerrar as inscrições', errorMessage(e)) })}
                >
                  Encerrar inscrições
                </Button>
              )}
              {actions.includes('start') && (
                <Button iconLeft={<ListTree className="size-4" aria-hidden />} onClick={onGoToStages}>
                  Gerar a chave da primeira fase
                </Button>
              )}
              {actions.includes('resume') && (
                <Button iconLeft={<PlayCircle className="size-4" aria-hidden />} onClick={() => setDialog('resume')}>
                  Retomar campeonato
                </Button>
              )}
              {actions.includes('finish') && (
                <Button variant="gold" iconLeft={<Trophy className="size-4" aria-hidden />} onClick={() => setDialog('finish')}>
                  Encerrar campeonato
                </Button>
              )}
              {actions.includes('pause') && (
                <Button variant="secondary" iconLeft={<PauseCircle className="size-4" aria-hidden />} onClick={() => setDialog('pause')}>
                  Pausar campeonato
                </Button>
              )}
              {actions.includes('archive') && (
                <Button variant="secondary" iconLeft={<Archive className="size-4" aria-hidden />} onClick={() => setDialog('archive')}>
                  Arquivar
                </Button>
              )}
              {!isDraft && !isReadOnly(t.status) && (
                <Button asChild variant="secondary">
                  <Link href={`/organizador/campeonatos/${t.id}/editar`}>
                    <PencilLine className="size-4" aria-hidden />
                    Editar campeonato
                  </Link>
                </Button>
              )}
              <Button
                variant="secondary"
                loading={duplicate.isPending}
                iconLeft={<Copy className="size-4" aria-hidden />}
                onClick={() =>
                  duplicate.mutate(
                    { id: t.id },
                    {
                      onSuccess: (copy) => {
                        success('Campeonato duplicado', 'A cópia é um rascunho: ajuste o nome e as datas.');
                        router.push(`/organizador/campeonatos/${copy.id}/editar`);
                      },
                      onError: (e) => error('Não foi possível duplicar', errorMessage(e)),
                    },
                  )
                }
              >
                Duplicar
              </Button>
              {stages.length > 0 && (
                <Button variant="secondary" iconLeft={<FileStack className="size-4" aria-hidden />} onClick={() => setDialog('template')}>
                  Salvar como modelo
                </Button>
              )}
              {isDraft && isOwner && (
                <Button variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setDialog('delete')}>
                  Excluir rascunho
                </Button>
              )}
              {actions.includes('cancel') && isOwner && (
                <Button variant="ghost" iconLeft={<XCircle className="size-4" aria-hidden />} onClick={() => setDialog('cancel')}>
                  Cancelar campeonato
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
                <Link href={`/c/${t.slug}/arte`}>
                  <ImageDown className="size-4" aria-hidden />
                  Arte de resultado e certificados
                </Link>
              </Button>
            </div>
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Datas</h2>
          <dl className="flex flex-col gap-2">
            <Row label="Abertura das inscrições">{dateOr(t.registrationOpensAt, isDraft ? 'Ao publicar' : 'Não definida')}</Row>
            <Row label="Fechamento das inscrições">{dateOr(t.registrationClosesAt, 'Não definido')}</Row>
            <Row label="Início do campeonato">{dateOr(t.startsAt, 'Não definido')}</Row>
            {t.participantType === 'TEAM' && <Row label="Trava de elenco">{dateOr(t.rosterLockAt, 'Sem trava')}</Row>}
            <Row label="Check-in">{t.checkIn.enabled ? `De ${t.checkIn.opensMinutesBefore} a ${t.checkIn.closesMinutesBefore} min antes de cada partida` : 'Não exigido'}</Row>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Fases</h2>
          {stages.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma fase montada ainda.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {stages.map((stage, index) => (
                <li key={stage.id} className="flex gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-soft-text" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold text-text">
                      {stage.name} <span className="font-normal text-muted">· {FORMAT_INFO[stage.format].name}</span>
                    </p>
                    {stage.qualification && <p className="text-muted">{describeQualification(stage.qualification, stage.format === 'BATTLE_ROYALE' ? 'sala' : 'grupo')} avançam</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Vagas</h2>
          <Progress value={t.takenSlots} max={t.maxParticipants} label="Vagas ocupadas" />
          <dl className="flex flex-col gap-2">
            <Row label="Aprovação">{t.manualApproval ? 'Manual' : 'Automática'}</Row>
            <Row label="Aguardando aprovação">{t.pendingApprovals}</Row>
            <Row label="Lista de espera">{t.waitlistEnabled ? `${t.waitlistCount} na fila` : 'Desligada'}</Row>
          </dl>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Página pública</h2>
          {isDraft ? (
            <p className="text-sm text-muted">A página pública passa a existir quando o campeonato for publicado.</p>
          ) : (
            <>
              <p className="break-all text-sm text-text">
                <Link href={publicPath} className="font-semibold underline">
                  {publicPath}
                </Link>
              </p>
              <div>
                <Button variant="secondary" size="sm" iconLeft={<ClipboardCopy className="size-4" aria-hidden />} onClick={() => void copyLink()}>
                  Copiar link
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <ReasonDialog
        open={dialog === 'pause'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Pausar o campeonato?"
        description="Enquanto estiver pausado ninguém lança resultado. Os inscritos são avisados com o motivo."
        label="Motivo da pausa"
        confirmLabel="Pausar campeonato"
        loading={pause.isPending}
        onConfirm={(reason) =>
          pause.mutate(
            { id: t.id, reason },
            {
              onSuccess: () => {
                success('Campeonato pausado', 'Os inscritos foram avisados.');
                setDialog(null);
              },
              onError: (e) => error('Não foi possível pausar', errorMessage(e)),
            },
          )
        }
      />
      <ReasonDialog
        open={dialog === 'resume'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Retomar o campeonato?"
        description="O campeonato volta a ficar em andamento e os resultados podem ser lançados de novo."
        label="Recado para os inscritos (opcional)"
        required={false}
        confirmLabel="Retomar campeonato"
        loading={resume.isPending}
        onConfirm={(reason) =>
          resume.mutate(
            { id: t.id, ...(reason ? { reason } : {}) },
            {
              onSuccess: () => {
                success('Campeonato retomado', 'Os inscritos foram avisados.');
                setDialog(null);
              },
              onError: (e) => error('Não foi possível retomar', errorMessage(e)),
            },
          )
        }
      />
      <Modal
        open={dialog === 'archive'}
        onOpenChange={(o) => !o && setDialog(null)}
        size="sm"
        title="Arquivar o campeonato?"
        description="Ele sai da vitrine e fica só para consulta, com o pódio e os resultados. Não dá para desarquivar."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Voltar
            </Button>
            <Button
              loading={archive.isPending}
              onClick={() =>
                archive.mutate(
                  { id: t.id },
                  {
                    onSuccess: () => {
                      success('Campeonato arquivado');
                      setDialog(null);
                    },
                    onError: (e) => error('Não foi possível arquivar', errorMessage(e)),
                  },
                )
              }
            >
              Arquivar campeonato
            </Button>
          </>
        }
      />
      <FinishDialog tournament={t} open={dialog === 'finish'} onOpenChange={(o) => !o && setDialog(null)} onFinished={onFinished} />
      <CancelTournamentDialog tournament={t} open={dialog === 'cancel'} onOpenChange={(o) => !o && setDialog(null)} />
      <DeleteDraftDialog tournament={t} open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} onDone={() => router.push('/organizador/campeonatos')} />
      <SaveTemplateDialog tournament={t} open={dialog === 'template'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}
