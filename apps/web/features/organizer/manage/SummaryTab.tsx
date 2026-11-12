'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Button, Card, Progress, StatusPill, useToast } from '@nova/ui';
import { ClipboardCopy, Copy, DoorClosed, DoorOpen, FileStack, PencilLine, Trash2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCloseRegistration, useDuplicateTournament, useOpenRegistration } from '@/shared/api/hooks/organizer';
import { formatDateTime } from '@/shared/lib/datetime';
import { CancelTournamentDialog, DeleteDraftDialog, SaveTemplateDialog } from '../components/TournamentDialogs';
import { FORMAT_INFO } from '../lib/formats';
import { describeQualification } from '../lib/labels';
import { isReadOnly, lifecycleActions, statusExplanation } from '../lib/status';

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
export function SummaryTab({ tournament: t }: { tournament: OrganizerTournamentDetail }) {
  const router = useRouter();
  const { success, error } = useToast();
  const open = useOpenRegistration();
  const close = useCloseRegistration();
  const duplicate = useDuplicateTournament();
  const [dialog, setDialog] = useState<'cancel' | 'delete' | 'template' | null>(null);

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

      <CancelTournamentDialog tournament={t} open={dialog === 'cancel'} onOpenChange={(o) => !o && setDialog(null)} />
      <DeleteDraftDialog tournament={t} open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)} onDone={() => router.push('/organizador/campeonatos')} />
      <SaveTemplateDialog tournament={t} open={dialog === 'template'} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}
