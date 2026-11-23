'use client';

import { Role, UserStatus, type AdminUser } from '@nova/schemas';
import { Button, DataTable, EmptyState, ErrorState, Input, Select, type Column } from '@nova/ui';
import { MessageSquareWarning, PauseCircle, SearchX, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminUsers } from '@/shared/api/hooks/admin';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { roleLabel, userStatusLabel } from '../common/format';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { RoleBadges, UserIdentity, UserStatusPill } from '../common/UserBits';
import { adminUsersMessages } from './messages';
import { SanctionModal, type SanctionType } from './SanctionModal';

/** Usuários (ADM-04): busca por apelido ou e-mail, filtros de papel e status, e sanção em lote. */
export function UsersPage() {
  const t = useT(adminUsersMessages, 'UsersPage');
  const roleOptions = Role.options.map((role) => ({ value: role, label: roleLabel(role) }));
  const statusOptions = UserStatus.options.map((status) => ({ value: status, label: userStatusLabel(status) }));
  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        id: 'user',
        header: t('colunaUsuario'),
        primary: true,
        cell: (user) => (
          <Link href={`/admin/usuarios/${user.id}`} className="inline-flex min-h-11 items-center rounded-sm hover:underline md:min-h-0">
            <span className="sr-only">{t('abrirPerfilDe')}</span>
            <UserIdentity user={user} />
          </Link>
        ),
      },
      { id: 'roles', header: t('colunaPapeis'), cell: (user) => <RoleBadges roles={user.roles} /> },
      {
        id: 'status',
        header: t('colunaStatus'),
        cell: (user) => (
          <span className="flex flex-col items-start gap-0.5">
            <UserStatusPill status={user.status} />
            {user.suspendedUntil && <span className="text-xs text-muted">{t('ate', { data: formatDate(user.suspendedUntil) })}</span>}
          </span>
        ),
      },
      {
        id: 'security',
        header: t('colunaSeguranca'),
        hideOnMobile: true,
        cell: (user) =>
          user.twoFactorEnabled ? (
            <span className="inline-flex items-center gap-1 text-sm">
              <ShieldCheck className="size-4 text-primary-text" aria-hidden /> {t('ativa')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-muted">
              <ShieldOff className="size-4" aria-hidden /> {t('inativa')}
            </span>
          ),
      },
      { id: 'lastSeen', header: t('colunaUltimoAcesso'), cell: (user) => <span title={formatDate(user.lastSeenAt)}>{formatRelative(user.lastSeenAt)}</span> },
      { id: 'created', header: t('colunaContaCriada'), hideOnMobile: true, cell: (user) => formatDate(user.createdAt) },
    ],
    [t],
  );
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<SanctionType | null>(null);
  const q = useDebouncedValue(search.trim());
  const users = useAdminUsers({ q, role, status, page });
  const rows = users.data?.items ?? [];
  const filtered = Boolean(q || role || status);
  // A seleção vale para a página visível: quem saiu da lista (filtro ou página) deixa de estar selecionado.
  const selectedRows = rows.filter((u) => selected.includes(u.id));

  function clearFilters() {
    setSearch('');
    setRole('');
    setStatus('');
    setPage(1);
  }

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />

      {users.isError ? (
        <ErrorState description={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Input
              label={t('buscar')}
              type="search"
              placeholder={t('buscarPlaceholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setSelected([]);
              }}
              autoComplete="off"
            />
            <Select
              label={t('papel')}
              placeholder={t('todosPapeis')}
              options={roleOptions}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
                setSelected([]);
              }}
            />
            <Select
              label={t('status')}
              placeholder={t('todosStatus')}
              options={statusOptions}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setSelected([]);
              }}
            />
          </div>

          <DataTable
            caption={t('tabela')}
            columns={columns}
            rows={rows}
            getRowId={(user) => user.id}
            loading={users.isPending}
            page={users.data?.page}
            pageCount={users.data?.pageCount}
            total={users.data?.total}
            onPageChange={(next) => {
              setPage(next);
              setSelected([]);
            }}
            selected={selectedRows.map((u) => u.id)}
            onSelectedChange={setSelected}
            bulkActions={
              <>
                <Button size="sm" variant="secondary" onClick={() => setBulk('WARNING')} iconLeft={<MessageSquareWarning className="size-4" aria-hidden />}>
                  {t('advertir')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setBulk('SUSPENSION')} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
                  {t('suspender')}
                </Button>
              </>
            }
            rowActions={(user) => (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/admin/usuarios/${user.id}`}>{t.rich('verPerfil', { apelido: user.nickname, sr: (chunks) => <span className="sr-only">{chunks}</span> })}</Link>
              </Button>
            )}
            empty={
              filtered ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title={t('nenhumEncontrado')}
                  description={t('nenhumEncontradoDescricao')}
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      {t('limparFiltros')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState title={t('nenhumAinda')} description={t('nenhumAindaDescricao')} />
              )
            }
          />
          <p className="sr-only" role="status" aria-live="polite">
            {users.isPending ? '' : t('naLista', { total: String(users.data?.total ?? 0) })}
          </p>
        </>
      )}

      {bulk && (
        <SanctionModal
          open
          onOpenChange={(open) => {
            if (!open) setBulk(null);
          }}
          type={bulk}
          targets={selectedRows.map((u) => ({ id: u.id, nickname: u.nickname }))}
          onDone={() => setSelected([])}
        />
      )}
    </PageContainer>
  );
}
