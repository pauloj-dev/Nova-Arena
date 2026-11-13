'use client';

import type { AdminOrganizer, AdminUser } from '@nova/schemas';
import { Badge, Button, DataTable, EmptyState, ErrorState, Input, Modal, Tabs, Textarea, useToast, type Column } from '@nova/ui';
import { BadgeCheck, SearchX, SlidersHorizontal, Target, UserMinus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminOrganizerRequests, useAdminOrganizers, useGrantRole, useRevokeRole } from '@/shared/api/hooks/admin';
import { useGames } from '@/shared/api/hooks/games';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { ReasonModal } from '../common/ReasonModal';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { UserIdentity, UserStatusPill } from '../common/UserBits';
import { UserPicker } from '../common/UserPicker';
import { InvitesSection } from './InvitesSection';
import { OrganizerLimitsModal } from './OrganizerLimitsModal';
import { OrganizerRequestsQueue } from './OrganizerRequestsQueue';

function PromoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const grant = useGrantRole();
  const [picked, setPicked] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');

  function close() {
    setPicked(null);
    setReason('');
    onClose();
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !grant.isPending) close();
      }}
      title="Promover participante a organizador"
      description="A conta ganha a área de organização, com limite de 3 campeonatos simultâneos e todos os jogos. Você ajusta os limites depois."
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={grant.isPending}>
            Voltar
          </Button>
          <Button
            disabled={!picked}
            loading={grant.isPending}
            onClick={() => {
              if (!picked) return;
              grant.mutate(
                { userId: picked.id, role: 'ORGANIZER', reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success(`${picked.nickname} agora é organizador`, 'A pessoa foi avisada.');
                    close();
                  },
                  onError: (error) => toast.error('Não foi possível promover', errorMessage(error)),
                },
              );
            }}
          >
            Promover a organizador
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UserPicker label="Participante" value={picked} onChange={setPicked} excludeRoles={['ORGANIZER']} />
        <Textarea label="Motivo (opcional)" rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint="Fica registrado na auditoria." />
      </div>
    </Modal>
  );
}

function OrganizersList() {
  const toast = useToast();
  const games = useGames({ includeInactive: true });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search.trim());
  const organizers = useAdminOrganizers({ q, page });
  const revoke = useRevokeRole();
  const [editing, setEditing] = useState<AdminOrganizer | null>(null);
  const [revoking, setRevoking] = useState<AdminOrganizer | null>(null);
  const [promoting, setPromoting] = useState(false);

  const gameNames = (ids: string[]) => (ids.length === 0 ? 'Todos os jogos' : ids.map((id) => games.data?.find((g) => g.id === id)?.name ?? 'Jogo').join(', '));

  const columns: Column<AdminOrganizer>[] = [
    {
      id: 'organizer',
      header: 'Organizador',
      primary: true,
      cell: (o) => (
        <Link href={`/admin/usuarios/${o.id}`} className="inline-flex min-h-11 items-center rounded-sm hover:underline md:min-h-0" aria-label={`Abrir o perfil de ${o.nickname}`}>
          <UserIdentity user={o} />
        </Link>
      ),
    },
    {
      id: 'verified',
      header: 'Selo',
      cell: (o) =>
        o.verifiedOrganizer ? (
          <Badge tone="primary" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
            Verificado
          </Badge>
        ) : (
          <span className="text-sm text-muted">Sem selo</span>
        ),
    },
    {
      id: 'active',
      header: 'Campeonatos ativos',
      cell: (o) => (
        <span className="tabular">
          {o.activeTournaments} de {o.organizerLimits.maxActiveTournaments}
          <span className="sr-only"> permitidos</span>
        </span>
      ),
    },
    { id: 'games', header: 'Jogos permitidos', cell: (o) => <span title={gameNames(o.organizerLimits.allowedGameIds)}>{gameNames(o.organizerLimits.allowedGameIds)}</span> },
    { id: 'status', header: 'Conta', hideOnMobile: true, cell: (o) => <UserStatusPill status={o.status} /> },
  ];

  function confirmRevoke(reason: string) {
    if (!revoking) return;
    revoke.mutate(
      { userId: revoking.id, role: 'ORGANIZER', reason },
      {
        onSuccess: (result) => {
          const transferred = result.affectedTournaments.filter((t) => t.outcome === 'TRANSFERRED').length;
          const paused = result.affectedTournaments.filter((t) => t.outcome === 'PAUSED').length;
          toast.success(
            `${revoking.nickname} não é mais organizador`,
            result.affectedTournaments.length === 0
              ? 'Não havia campeonato em curso.'
              : `${transferred} campeonato(s) passaram para o co-organizador mais antigo; ${paused} foram pausados e estão na fila "Sem responsável".`,
          );
          setRevoking(null);
        },
        onError: (error) => toast.error('Não foi possível revogar', errorMessage(error)),
      },
    );
  }

  if (organizers.isError) return <ErrorState description={errorMessage(organizers.error)} onRetry={() => void organizers.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input
          label="Buscar organizador"
          type="search"
          placeholder="Apelido ou e-mail"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          autoComplete="off"
          className="w-full max-w-md"
        />
        <Button onClick={() => setPromoting(true)} iconLeft={<UserPlus className="size-4" aria-hidden />}>
          Promover participante
        </Button>
      </div>
      <DataTable
        caption="Organizadores"
        columns={columns}
        rows={organizers.data?.items ?? []}
        getRowId={(o) => o.id}
        loading={organizers.isPending}
        page={organizers.data?.page}
        pageCount={organizers.data?.pageCount}
        total={organizers.data?.total}
        onPageChange={setPage}
        rowActions={(o) => (
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(o)} iconLeft={<SlidersHorizontal className="size-4" aria-hidden />}>
              Limites<span className="sr-only"> de {o.nickname}</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRevoking(o)} iconLeft={<UserMinus className="size-4" aria-hidden />}>
              Revogar<span className="sr-only"> {o.nickname}</span>
            </Button>
          </div>
        )}
        empty={
          q ? (
            <EmptyState
              icon={<SearchX className="size-7" />}
              title="Nenhum organizador encontrado"
              description={`Nada combina com "${q}".`}
              action={
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Target className="size-7" />} title="Nenhum organizador ainda" description="Promova um participante ou aprove um pedido para a primeira pessoa começar a criar campeonatos." />
          )
        }
      />

      <InvitesSection defaultRole="ORGANIZER" />

      {editing && <OrganizerLimitsModal organizer={editing} onClose={() => setEditing(null)} />}
      <PromoteModal open={promoting} onClose={() => setPromoting(false)} />
      <ReasonModal
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={revoking ? `Revogar ${revoking.nickname}` : 'Revogar organizador'}
        description={
          revoking && revoking.activeTournaments > 0
            ? `${revoking.nickname} tem ${revoking.activeTournaments} campeonato(s) em curso. Em cada um, o co-organizador mais antigo assume; sem co-organizador, o campeonato é pausado e vai para a fila "Sem responsável". Rascunhos e campeonatos finalizados ficam como estão.`
            : 'A conta perde a área de organização e volta a ser só participante.'
        }
        minLength={0}
        confirmLabel="Revogar organizador"
        variant="danger"
        loading={revoke.isPending}
        onConfirm={confirmRevoke}
      />
    </div>
  );
}

/** Organizadores (ADM-03): lista com selo, limites e campeonatos ativos; promover, revogar e a fila de pedidos. */
export function OrganizersPage({ initialTab }: { initialTab?: string }) {
  const pending = useAdminOrganizerRequests('PENDING');
  const count = pending.data?.length ?? 0;
  return (
    <PageContainer>
      <PageHeader title="Organizadores" description="Quem pode criar campeonatos, com que limites, e quem está pedindo para entrar." />
      <Tabs
        label="Organizadores e pedidos"
        defaultValue={initialTab === 'pedidos' ? 'pedidos' : 'organizadores'}
        items={[
          { value: 'organizadores', label: 'Organizadores', content: <OrganizersList /> },
          {
            value: 'pedidos',
            label: (
              <span className="inline-flex items-center gap-2">
                Pedidos
                {count > 0 && (
                  <Badge tone="warning">
                    {count}
                    <span className="sr-only"> na fila</span>
                  </Badge>
                )}
              </span>
            ),
            content: <OrganizerRequestsQueue />,
          },
        ]}
      />
    </PageContainer>
  );
}
