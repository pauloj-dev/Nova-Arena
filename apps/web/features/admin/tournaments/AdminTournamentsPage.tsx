'use client';

import { TournamentStatus, type AdminTournament, type AdminUser } from '@nova/schemas';
import { Badge, Button, ConfirmDestructive, DataTable, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusPill, statusLabel, Switch, Textarea, useToast, type Column } from '@nova/ui';
import { Archive, LockOpen, SearchX, Trophy, UserCog, UserX, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminArchiveTournament, useAdminCancelTournament, useAdminTournaments, useChangeTournamentOwner, useFeatureTournament, useLockedStages, useUnlockStage } from '@/shared/api/hooks/admin-tournaments';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { plural } from '../common/format';
import { RowMenu } from '../common/RowMenu';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { UserPicker } from '../common/UserPicker';

const STATUS_OPTIONS = TournamentStatus.options.map((status) => ({ value: status, label: statusLabel(status) }));
const CAN_FEATURE: AdminTournament['status'][] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED', 'FINISHED'];

type Dialog = { kind: 'owner' | 'cancel' | 'archive' | 'unlock'; tournament: AdminTournament } | null;

function ChangeOwnerModal({ tournament, onClose }: { tournament: AdminTournament; onClose: () => void }) {
  const toast = useToast();
  const change = useChangeTournamentOwner();
  const [owner, setOwner] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!owner) return setError('Escolha o novo responsável.');
    if (reason.trim().length < 5) return setError('Informe o motivo (pelo menos 5 caracteres).');
    setError(null);
    change.mutate(
      { tournamentId: tournament.id, ownerId: owner.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success('Responsável trocado', `${owner.nickname} agora responde por ${tournament.name}.`);
          onClose();
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
      title="Trocar o responsável"
      description={
        <>
          {tournament.name}. Responsável atual: <strong>{tournament.hasOwner ? tournament.ownerNickname : 'ninguém (sem responsável)'}</strong>. O novo responsável precisa ser organizador. A troca fica na auditoria e os dois são avisados.
        </>
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={change.isPending}>
            Voltar
          </Button>
          <Button onClick={submit} loading={change.isPending}>
            Trocar responsável
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UserPicker label="Novo responsável" hint="Busque um organizador pelo apelido ou e-mail." role="ORGANIZER" value={owner} onChange={setOwner} excludeIds={tournament.hasOwner ? [tournament.ownerId] : []} />
        <Textarea label="Motivo" required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
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
  const toast = useToast();
  const stages = useLockedStages(tournament.id);
  const unlock = useUnlockStage();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !unlock.isPending) onClose();
      }}
      title="Destravar chave"
      description={`${tournament.name}. A chave trava depois da primeira partida concluída. Destravar permite à organização ajustar os confrontos; os resultados já lançados continuam valendo.`}
      footer={
        <Button variant="secondary" onClick={onClose} disabled={unlock.isPending}>
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {stages.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : stages.isError ? (
          <ErrorState description={errorMessage(stages.error)} onRetry={() => void stages.refetch()} />
        ) : stages.data.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">Nenhuma fase deste campeonato está com a chave travada.</p>
        ) : (
          <>
            <Textarea label="Motivo" required rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint="Vale para a fase que você destravar agora. Fica na auditoria." error={error ?? undefined} />
            <ul className="flex flex-col gap-2" aria-label="Fases travadas">
              {stages.data.map((stage) => (
                <li key={stage.stageId} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-semibold">{stage.stageName}</span>
                    <span className="block text-xs text-muted">{plural(stage.completedMatches, 'partida concluída', 'partidas concluídas')}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    iconLeft={<LockOpen className="size-4" aria-hidden />}
                    loading={unlock.isPending && unlock.variables?.stageId === stage.stageId}
                    onClick={() => {
                      if (reason.trim().length < 3) return setError('Informe o motivo');
                      setError(null);
                      unlock.mutate(
                        { stageId: stage.stageId, reason: reason.trim() },
                        {
                          onSuccess: () => toast.success('Chave destravada', `${stage.stageName} pode ser ajustada pela organização.`),
                          onError: (e) => toast.error('Não foi possível destravar', errorMessage(e)),
                        },
                      );
                    }}
                  >
                    Destravar<span className="sr-only"> {stage.stageName}</span>
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

  const columns: Column<AdminTournament>[] = [
    {
      id: 'name',
      header: 'Campeonato',
      primary: true,
      cell: (t) =>
        t.status === 'DRAFT' ? (
          <span className="font-semibold [overflow-wrap:anywhere]">{t.name}</span>
        ) : (
          <Link href={`/c/${t.slug}`} className="inline-flex min-h-11 items-center rounded-sm font-semibold hover:underline md:min-h-0 [overflow-wrap:anywhere]">
            {t.name}
          </Link>
        ),
    },
    { id: 'game', header: 'Jogo', cell: (t) => t.gameName },
    { id: 'status', header: 'Status', cell: (t) => <StatusPill status={t.status} /> },
    {
      id: 'owner',
      header: 'Responsável',
      cell: (t) =>
        t.hasOwner ? (
          <Link href={`/admin/usuarios/${t.ownerId}`} className="hover:underline">
            {t.ownerNickname}
          </Link>
        ) : (
          <Badge tone="danger" icon={<UserX className="size-3.5" aria-hidden />}>
            Sem responsável
          </Badge>
        ),
    },
    { id: 'slots', header: 'Vagas', align: 'right', cell: (t) => <span className="tabular">{`${t.takenSlots}/${t.maxParticipants}`}</span> },
    { id: 'starts', header: 'Início', hideOnMobile: true, cell: (t) => (t.startsAt ? formatDateTime(t.startsAt, { withZone: false }) : 'A definir') },
  ];

  function setFeatured(t: AdminTournament, featured: boolean) {
    feature.mutate(
      { tournamentId: t.id, featured },
      {
        onSuccess: () => toast.success(featured ? 'Campeonato destacado na home' : 'Destaque removido', t.name),
        onError: (error) => toast.error('Não foi possível mudar o destaque', errorMessage(error)),
      },
    );
  }

  function confirmCancel() {
    if (dialog?.kind !== 'cancel') return;
    const t = dialog.tournament;
    if (cancelReason.trim().length < 5) return toast.error('Informe o motivo do cancelamento', 'Escreva pelo menos 5 caracteres.');
    cancel.mutate(
      { tournamentId: t.id, reason: cancelReason.trim() },
      {
        onSuccess: () => {
          toast.success('Campeonato cancelado', `${t.name}: a organização foi avisada e o motivo aparece na página pública.`);
          setCancelReason('');
          setDialog(null);
        },
        onError: (error) => toast.error('Não foi possível cancelar', errorMessage(error)),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Campeonatos" description="Todos os campeonatos da plataforma, inclusive rascunhos e arquivados. Toda ação aqui fica na auditoria." />

      {orphanCount > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-strong bg-warning-soft px-4 py-3 text-warning-soft-text">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <UserX className="size-4 shrink-0" aria-hidden />
            {plural(orphanCount, 'campeonato está pausado e sem responsável', 'campeonatos estão pausados e sem responsável')}.
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
            Ver a fila
          </Button>
        </div>
      )}

      {tournaments.isError ? (
        <ErrorState description={errorMessage(tournaments.error)} onRetry={() => void tournaments.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
            <Input
              label="Buscar campeonato"
              type="search"
              placeholder="Nome, jogo ou responsável"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              autoComplete="off"
            />
            <Select
              label="Status"
              placeholder="Todos os status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            />
            <Switch
              className="md:pb-0.5"
              label="Só sem responsável"
              checked={orphan}
              onCheckedChange={(checked) => {
                setOrphan(checked);
                setPage(1);
              }}
            />
          </div>

          <DataTable
            caption={orphan ? 'Campeonatos sem responsável' : 'Campeonatos'}
            columns={columns}
            rows={tournaments.data?.items ?? []}
            getRowId={(t) => t.id}
            loading={tournaments.isPending}
            page={tournaments.data?.page}
            pageCount={tournaments.data?.pageCount}
            total={tournaments.data?.total}
            onPageChange={setPage}
            rowActions={(t) => (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <Switch
                  className="gap-2"
                  label={
                    <>
                      <span className="sr-only">{t.name}: </span>Destaque
                    </>
                  }
                  checked={t.featured}
                  disabled={feature.isPending || (!t.featured && !CAN_FEATURE.includes(t.status))}
                  onCheckedChange={(checked) => setFeatured(t, checked)}
                />
                <RowMenu
                  label={`Ações de ${t.name}`}
                  items={[
                    { label: 'Trocar o responsável', icon: UserCog, onSelect: () => setDialog({ kind: 'owner', tournament: t }) },
                    { label: 'Destravar chave', icon: LockOpen, onSelect: () => setDialog({ kind: 'unlock', tournament: t }), disabled: t.status === 'DRAFT', hint: 'Rascunho não tem chave.' },
                    {
                      label: 'Cancelar campeonato',
                      icon: XCircle,
                      danger: true,
                      onSelect: () => setDialog({ kind: 'cancel', tournament: t }),
                      disabled: t.status === 'CANCELLED' || t.status === 'FINISHED' || t.status === 'ARCHIVED',
                      hint: 'Já terminou ou já foi cancelado.',
                    },
                    {
                      label: 'Arquivar',
                      icon: Archive,
                      onSelect: () => setDialog({ kind: 'archive', tournament: t }),
                      disabled: t.status !== 'FINISHED' && t.status !== 'CANCELLED',
                      hint: t.status === 'ARCHIVED' ? 'Já está arquivado.' : 'Só finalizado ou cancelado.',
                    },
                  ]}
                />
              </div>
            )}
            empty={
              filtered ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title={orphan && !q && !status ? 'Nenhum campeonato sem responsável' : 'Nenhum campeonato encontrado'}
                  description={orphan && !q && !status ? 'Todos os campeonatos em curso têm um organizador responsável.' : 'Nada combina com a busca e os filtros escolhidos.'}
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
                      Ver todos os campeonatos
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<Trophy className="size-7" />} title="Nenhum campeonato ainda" description="Os campeonatos aparecem aqui assim que os organizadores criam." />
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
        title="Cancelar campeonato"
        description="O campeonato sai do ar para novas inscrições e partidas. Quem acompanha a página vê o motivo. Não dá para desfazer."
        confirmText={dialog?.kind === 'cancel' ? dialog.tournament.name : ''}
        confirmLabel="Cancelar campeonato"
        loading={cancel.isPending}
        onConfirm={confirmCancel}
      >
        <Textarea label="Motivo do cancelamento" required rows={2} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} hint="Aparece na página pública do campeonato." />
      </ConfirmDestructive>
      <Modal
        open={dialog?.kind === 'archive'}
        onOpenChange={(open) => {
          if (!open && !archive.isPending) setDialog(null);
        }}
        title="Arquivar campeonato"
        description={dialog?.kind === 'archive' ? `${dialog.tournament.name} sai das listas do site, mas o histórico e os resultados continuam guardados.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={archive.isPending}>
              Voltar
            </Button>
            <Button
              loading={archive.isPending}
              onClick={() => {
                if (dialog?.kind !== 'archive') return;
                const t = dialog.tournament;
                archive.mutate(t.id, {
                  onSuccess: () => {
                    toast.success('Campeonato arquivado', t.name);
                    setDialog(null);
                  },
                  onError: (error) => toast.error('Não foi possível arquivar', errorMessage(error)),
                });
              }}
            >
              Arquivar
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
