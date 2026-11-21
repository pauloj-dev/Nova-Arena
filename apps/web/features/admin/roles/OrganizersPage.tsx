'use client';

import type { AdminOrganizer, AdminUser } from '@nova/schemas';
import { Badge, Button, DataTable, EmptyState, ErrorState, Input, Modal, Tabs, Textarea, useToast, type Column } from '@nova/ui';
import { BadgeCheck, SearchX, SlidersHorizontal, Target, UserMinus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminOrganizerRequests, useAdminOrganizers, useGrantRole, useRevokeRole } from '@/shared/api/hooks/admin';
import { useGames } from '@/shared/api/hooks/games';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { ReasonModal } from '../common/ReasonModal';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { UserIdentity, UserStatusPill } from '../common/UserBits';
import { UserPicker } from '../common/UserPicker';
import { InvitesSection } from './InvitesSection';
import { adminRolesMessages } from './messages';
import { OrganizerLimitsModal } from './OrganizerLimitsModal';
import { OrganizerRequestsQueue } from './OrganizerRequestsQueue';

function PromoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT(adminRolesMessages, 'PromoteModal');
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
      title={t('titulo')}
      description={t('descricao')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={grant.isPending}>
            {t('voltar')}
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
                    toast.success(t('promovido', { nome: picked.nickname }), t('promovidoDescricao'));
                    close();
                  },
                  onError: (error) => toast.error(t('erroPromover'), errorMessage(error)),
                },
              );
            }}
          >
            {t('confirmar')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <UserPicker label={t('participante')} value={picked} onChange={setPicked} excludeRoles={['ORGANIZER']} />
        <Textarea label={t('motivo')} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} hint={t('motivoDica')} />
      </div>
    </Modal>
  );
}

function OrganizersList() {
  const t = useT(adminRolesMessages, 'OrganizersList');
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

  const gameNames = (ids: string[]) => (ids.length === 0 ? t('todosOsJogos') : ids.map((id) => games.data?.find((g) => g.id === id)?.name ?? t('jogo')).join(', '));

  const columns: Column<AdminOrganizer>[] = [
    {
      id: 'organizer',
      header: t('colunaOrganizador'),
      primary: true,
      cell: (o) => (
        <Link href={`/admin/usuarios/${o.id}`} className="inline-flex min-h-11 items-center rounded-sm hover:underline md:min-h-0">
          <span className="sr-only">{t('abrirPerfilSr')}</span>
          <UserIdentity user={o} />
        </Link>
      ),
    },
    {
      id: 'verified',
      header: t('colunaSelo'),
      cell: (o) =>
        o.verifiedOrganizer ? (
          <Badge tone="primary" icon={<BadgeCheck className="size-3.5" aria-hidden />}>
            {t('verificado')}
          </Badge>
        ) : (
          <span className="text-sm text-muted">{t('semSelo')}</span>
        ),
    },
    {
      id: 'active',
      header: t('colunaAtivos'),
      cell: (o) => (
        <span className="tabular">
          {t('ativos', { ativos: String(o.activeTournaments), max: String(o.organizerLimits.maxActiveTournaments) })}
          <span className="sr-only">{t('permitidosSr')}</span>
        </span>
      ),
    },
    { id: 'games', header: t('colunaJogos'), cell: (o) => <span title={gameNames(o.organizerLimits.allowedGameIds)}>{gameNames(o.organizerLimits.allowedGameIds)}</span> },
    { id: 'status', header: t('colunaConta'), hideOnMobile: true, cell: (o) => <UserStatusPill status={o.status} /> },
  ];

  function confirmRevoke(reason: string) {
    if (!revoking) return;
    revoke.mutate(
      { userId: revoking.id, role: 'ORGANIZER', reason },
      {
        onSuccess: (result) => {
          const transferred = result.affectedTournaments.filter((a) => a.outcome === 'TRANSFERRED').length;
          const paused = result.affectedTournaments.filter((a) => a.outcome === 'PAUSED').length;
          toast.success(
            t('revogado', { nome: revoking.nickname }),
            result.affectedTournaments.length === 0 ? t('semCampeonato') : t('afetados', { transferidos: String(transferred), pausados: String(paused) }),
          );
          setRevoking(null);
        },
        onError: (error) => toast.error(t('erroRevogar'), errorMessage(error)),
      },
    );
  }

  if (organizers.isError) return <ErrorState description={errorMessage(organizers.error)} onRetry={() => void organizers.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Input
          label={t('buscar')}
          type="search"
          placeholder={t('buscarPlaceholder')}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          autoComplete="off"
          className="w-full max-w-md"
        />
        <Button onClick={() => setPromoting(true)} iconLeft={<UserPlus className="size-4" aria-hidden />}>
          {t('promover')}
        </Button>
      </div>
      <DataTable
        caption={t('tabela')}
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
              {t('limites')}<span className="sr-only">{t('limitesSr', { nome: o.nickname })}</span>
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setRevoking(o)} iconLeft={<UserMinus className="size-4" aria-hidden />}>
              {t('revogar')}<span className="sr-only">{t('revogarSr', { nome: o.nickname })}</span>
            </Button>
          </div>
        )}
        empty={
          q ? (
            <EmptyState
              icon={<SearchX className="size-7" />}
              title={t('nenhumEncontrado')}
              description={t('nadaCombina', { termo: q })}
              action={
                <Button variant="secondary" onClick={() => setSearch('')}>
                  {t('limparBusca')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<Target className="size-7" />} title={t('nenhumAinda')} description={t('nenhumAindaDescricao')} />
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
        title={revoking ? t('revogarTituloNome', { nome: revoking.nickname }) : t('revogarTitulo')}
        description={
          revoking && revoking.activeTournaments > 0
            ? t('revogarDescricaoAtivos', { nome: revoking.nickname, ativos: String(revoking.activeTournaments) })
            : t('revogarDescricao')
        }
        minLength={0}
        confirmLabel={t('revogarConfirmar')}
        variant="danger"
        loading={revoke.isPending}
        onConfirm={confirmRevoke}
      />
    </div>
  );
}

/** Organizadores (ADM-03): lista com selo, limites e campeonatos ativos; promover, revogar e a fila de pedidos. */
export function OrganizersPage({ initialTab }: { initialTab?: string }) {
  const t = useT(adminRolesMessages, 'OrganizersPage');
  const pending = useAdminOrganizerRequests('PENDING');
  const count = pending.data?.length ?? 0;
  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <Tabs
        label={t('abas')}
        defaultValue={initialTab === 'pedidos' ? 'pedidos' : 'organizadores'}
        items={[
          { value: 'organizadores', label: t('abaOrganizadores'), content: <OrganizersList /> },
          {
            value: 'pedidos',
            label: (
              <span className="inline-flex items-center gap-2">
                {t('abaPedidos')}
                {count > 0 && (
                  <Badge tone="warning">
                    {count}
                    <span className="sr-only">{t('naFilaSr')}</span>
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
