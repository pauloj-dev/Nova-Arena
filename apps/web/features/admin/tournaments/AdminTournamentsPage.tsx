'use client';

import { TournamentStatus, type AdminTournament, type AdminUser } from '@nova/schemas';
import { Badge, Button, ConfirmDestructive, DataTable, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusPill, statusLabel, Switch, Textarea, useToast, type Column } from '@nova/ui';
import { Archive, LockOpen, SearchX, Trophy, UserCog, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminArchiveTournament, useAdminCancelTournament, useAdminTournaments, useChangeTournamentOwner, useFeatureTournament, useLockedStages, useUnlockStage } from '@/shared/api/hooks/admin-tournaments';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { RowMenu } from '../common/RowMenu';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { UserPicker } from '../common/UserPicker';
import { adminTournamentsMessages } from './messages';

const STATUS_OPTIONS = TournamentStatus.options.map((status) => ({ value: status, label: statusLabel(status) }));
const CAN_FEATURE: AdminTournament['status'][] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED', 'FINISHED'];

type Dialog = { kind: 'owner' | 'cancel' | 'archive' | 'unlock'; tournament: AdminTournament } | null;

function ChangeOwnerModal({ tournament, onClose }: { tournament: AdminTournament; onClose: () => void }) {
  const t = useT(adminTournamentsMessages, 'ChangeOwnerModal');
  const toast = useToast();
  const change = useChangeTournamentOwner();
  const [owner, setOwner] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!owner) return setError(t('escolhaResponsavel'));
    if (reason.trim().length < 5) return setError(t('informeMotivo'));
    setError(null);
    change.mutate(
      { tournamentId: tournament.id, ownerId: owner.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('toastTrocado'), t('toastTrocadoDetalhe', { novo: owner.nickname, campeonato: tournament.name }));
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  const description = t.rich('descricao', {
    campeonato: tournament.name,
    atual: tournament.hasOwner ? tournament.ownerNickname : t('ninguem'),
    strong: (chunks) => <strong>{chunks}</strong>,
  });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
      title={t('titulo')}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={change.isPending}>
            {t('voltar')}
          </Button>
          <Button onClick={submit} loading={change.isPending}>
            {t('trocar')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UserPicker label={t('novoResponsavel')} hint={t('novoResponsavelDica')} role="ORGANIZER" value={owner} onChange={setOwner} excludeIds={tournament.hasOwner ? [tournament.ownerId] : []} />
        <Textarea label={t('motivo')} required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger-soft-text">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function UnlockModal({ tournament, onClose }: { tournament: AdminTournament; onClose: () => void }) {
  const t = useT(adminTournamentsMessages, 'UnlockModal');
  const toast = useToast();
  const stages = useLockedStages(tournament.id);
  const unlock = useUnlockStage();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unlockLabel = (stageName: string) => t.rich('destravar', { fase: stageName, sr: (chunks) => <span className="sr-only">{chunks}</span> });

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !unlock.isPending) onClose();
      }}
      title={t('titulo')}
      description={t('descricao', { campeonato: tournament.name })}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={unlock.isPending}>
          {t('fechar')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {stages.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : stages.isError ? (
          <ErrorState description={errorMessage(stages.error)} onRetry={() => void stages.refetch()} />
        ) : stages.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">{t('nenhumaFase')}</p>
        ) : (
          <>
            <Textarea label={t('motivo')} required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint={t('motivoDica')} error={error ?? undefined} />
            <ul className="flex flex-col gap-2" aria-label={t('fases')}>
              {stages.data.map((stage) => (
                <li key={stage.stageId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{stage.stageName}</span>
                    <span className="block text-xs text-muted">{t('partidasConcluidas', { count: stage.completedMatches })}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    iconLeft={<LockOpen className="size-4" aria-hidden />}
                    loading={unlock.isPending && unlock.variables?.stageId === stage.stageId}
                    onClick={() => {
                      if (reason.trim().length < 3) return setError(t('informeMotivo'));
                      setError(null);
                      unlock.mutate(
                        { stageId: stage.stageId, reason: reason.trim() },
                        {
                          onSuccess: () => toast.success(t('toastDestravada'), t('toastDestravadaDetalhe', { fase: stage.stageName })),
                          onError: (e) => toast.error(t('toastErro'), errorMessage(e)),
                        },
                      );
                    }}
                  >
                    {unlockLabel(stage.stageName)}
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Campeonatos (ADM-05): visão global, com rascunhos e arquivados; destacar, trocar responsável, cancelar, arquivar e destravar chave. */
export function AdminTournamentsPage({ initialQueue }: { initialQueue?: string }) {
  const t = useT(adminTournamentsMessages, 'AdminTournamentsPage');
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orphan, setOrphan] = useState(initialQueue === 'sem-responsavel');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cancelReason, setCancelReason] = useState('');
  const q = useDebouncedValue(search.trim());
  const tournaments = useAdminTournaments({ q, status, orphan, page });
  const orphans = useAdminTournaments({ orphan: true });
  const feature = useFeatureTournament();
  const cancel = useAdminCancelTournament();
  const archive = useAdminArchiveTournament();
  const orphanCount = orphans.data?.total ?? 0;
  const filtered = Boolean(q || status || orphan);
  const onlyOrphanFilter = orphan && !q && !status;

  const columns: Column<AdminTournament>[] = [
    {
      id: 'name',
      header: t('colunaCampeonato'),
      primary: true,
      cell: (tour) =>
        tour.status === 'DRAFT' ? (
          <span className="font-semibold [overflow-wrap:anywhere]">{tour.name}</span>
        ) : (
          <Link href={`/c/${tour.slug}`} className="inline-flex min-h-11 items-center rounded-sm font-semibold hover:underline md:min-h-0 [overflow-wrap:anywhere]">
            {tour.name}
          </Link>
        ),
    },
    { id: 'game', header: t('colunaJogo'), cell: (tour) => tour.gameName },
    { id: 'status', header: t('colunaStatus'), cell: (tour) => <StatusPill status={tour.status} /> },
    {
      id: 'owner',
      header: t('colunaResponsavel'),
      cell: (tour) =>
        tour.hasOwner ? (
          <Link href={`/admin/usuarios/${tour.ownerId}`} className="hover:underline">
            {tour.ownerNickname}
          </Link>
        ) : (
          <Badge tone="danger" icon={<UserX className="size-3.5" aria-hidden />}>
            {t('semResponsavel')}
          </Badge>
        ),
    },
    { id: 'slots', header: t('colunaVagas'), align: 'right', cell: (tour) => <span className="tabular">{`${tour.takenSlots}/${tour.maxParticipants}`}</span> },
    { id: 'starts', header: t('colunaInicio'), hideOnMobile: true, cell: (tour) => (tour.startsAt ? formatDateTime(tour.startsAt, { withZone: false }) : t('aDefinir')) },
  ];

  function setFeatured(tour: AdminTournament, featured: boolean) {
    feature.mutate(
      { tournamentId: tour.id, featured },
      {
        onSuccess: () => toast.success(featured ? t('toastDestacado') : t('toastDestaqueRemovido'), tour.name),
        onError: (error) => toast.error(t('toastErroDestaque'), errorMessage(error)),
      },
    );
  }

  function confirmCancel() {
    if (dialog?.kind !== 'cancel') return;
    const tour = dialog.tournament;
    if (cancelReason.trim().length < 5) return toast.error(t('toastMotivoCancelamento'), t('toastMotivoCancelamentoDetalhe'));
    cancel.mutate(
      { tournamentId: tour.id, reason: cancelReason.trim() },
      {
        onSuccess: () => {
          toast.success(t('toastCancelado'), t('toastCanceladoDetalhe', { campeonato: tour.name }));
          setCancelReason('');
          setDialog(null);
        },
        onError: (error) => toast.error(t('toastErroCancelar'), errorMessage(error)),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      {orphanCount > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-warning-soft px-4 py-3 text-warning-soft-text">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserX className="size-4 shrink-0" aria-hidden />
            {t('orfaos', { count: orphanCount })}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOrphan(true);
              setStatus('');
              setSearch('');
              setPage(1);
            }}
          >
            {t('verFila')}
          </Button>
        </div>
      )}

      {tournaments.isError ? (
        <ErrorState description={errorMessage(tournaments.error)} onRetry={() => void tournaments.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
            <Input
              label={t('buscar')}
              type="search"
              placeholder={t('buscarExemplo')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              autoComplete="off"
            />
            <Select
              label={t('status')}
              placeholder={t('todosStatus')}
              options={STATUS_OPTIONS}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            />
            <Switch
              className="md:pb-0.5"
              label={t('soSemResponsavel')}
              checked={orphan}
              onCheckedChange={(checked) => {
                setOrphan(checked);
                setPage(1);
              }}
            />
          </div>

          <DataTable
            caption={orphan ? t('legendaOrfaos') : t('legenda')}
            columns={columns}
            rows={tournaments.data?.items ?? []}
            getRowId={(tour) => tour.id}
            loading={tournaments.isPending}
            page={tournaments.data?.page}
            pageCount={tournaments.data?.pageCount}
            total={tournaments.data?.total}
            onPageChange={setPage}
            rowActions={(tour) => (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <Switch
                  className="gap-2"
                  label={
                    <>
                      <span className="sr-only">{t('destaqueSr', { campeonato: tour.name })}</span>
                      {t('destaque')}
                    </>
                  }
                  checked={tour.featured}
                  disabled={feature.isPending || (!tour.featured && !CAN_FEATURE.includes(tour.status))}
                  onCheckedChange={(checked) => setFeatured(tour, checked)}
                />
                <RowMenu
                  label={t('acoesDe', { campeonato: tour.name })}
                  items={[
                    { label: t('trocarResponsavel'), icon: UserCog, onSelect: () => setDialog({ kind: 'owner', tournament: tour }) },
                    { label: t('destravarChave'), icon: LockOpen, onSelect: () => setDialog({ kind: 'unlock', tournament: tour }), disabled: tour.status === 'DRAFT', hint: t('rascunhoSemChave') },
                    {
                      label: t('cancelarCampeonato'),
                      icon: XCircle,
                      danger: true,
                      onSelect: () => setDialog({ kind: 'cancel', tournament: tour }),
                      disabled: tour.status === 'CANCELLED' || tour.status === 'FINISHED' || tour.status === 'ARCHIVED',
                      hint: t('jaTerminou'),
                    },
                    {
                      label: t('arquivar'),
                      icon: Archive,
                      onSelect: () => setDialog({ kind: 'archive', tournament: tour }),
                      disabled: tour.status !== 'FINISHED' && tour.status !== 'CANCELLED',
                      hint: tour.status === 'ARCHIVED' ? t('jaArquivado') : t('soFinalizado'),
                    },
                  ]}
                />
              </div>
            )}
            empty={
              filtered ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title={onlyOrphanFilter ? t('nenhumOrfao') : t('nenhumEncontrado')}
                  description={onlyOrphanFilter ? t('todosComResponsavel') : t('nadaCombina')}
                  action={
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setSearch('');
                        setStatus('');
                        setOrphan(false);
                        setPage(1);
                      }}
                    >
                      {t('verTodos')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<Trophy className="size-7" />} title={t('nenhumAinda')} description={t('nenhumAindaDescricao')} />
              )
            }
          />
        </>
      )}

      {dialog?.kind === 'owner' && <ChangeOwnerModal tournament={dialog.tournament} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'unlock' && <UnlockModal tournament={dialog.tournament} onClose={() => setDialog(null)} />}
      <ConfirmDestructive
        open={dialog?.kind === 'cancel'}
        onOpenChange={(open) => {
          if (!open && !cancel.isPending) {
            setCancelReason('');
            setDialog(null);
          }
        }}
        title={t('cancelarCampeonato')}
        description={t('cancelarDescricao')}
        confirmText={dialog?.kind === 'cancel' ? dialog.tournament.name : ''}
        confirmLabel={t('cancelarCampeonato')}
        loading={cancel.isPending}
        onConfirm={confirmCancel}
      >
        <Textarea label={t('motivoCancelamento')} required rows={2} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} hint={t('motivoCancelamentoDica')} />
      </ConfirmDestructive>
      <Modal
        open={dialog?.kind === 'archive'}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setDialog(null);
        }}
        title={t('arquivarTitulo')}
        description={dialog?.kind === 'archive' ? t('arquivarDescricao', { campeonato: dialog.tournament.name }) : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={archive.isPending}>
              {t('voltar')}
            </Button>
            <Button
              loading={archive.isPending}
              onClick={() => {
                if (dialog?.kind !== 'archive') return;
                const tour = dialog.tournament;
                archive.mutate(tour.id, {
                  onSuccess: () => {
                    toast.success(t('toastArquivado'), tour.name);
                    setDialog(null);
                  },
                  onError: (error) => toast.error(t('toastErroArquivar'), errorMessage(error)),
                });
              }}
            >
              {t('arquivar')}
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
