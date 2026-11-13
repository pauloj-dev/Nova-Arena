'use client';

import { Role, UserStatus, type AdminUser } from '@nova/schemas';
import { Button, DataTable, EmptyState, ErrorState, Input, Select, type Column } from '@nova/ui';
import { MessageSquareWarning, PauseCircle, SearchX, ShieldCheck, ShieldOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminUsers } from '@/shared/api/hooks/admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { ROLE_LABELS, USER_STATUS_LABELS } from '../common/format';
import { useDebouncedValue } from '../common/useDebouncedValue';
import { RoleBadges, UserIdentity, UserStatusPill } from '../common/UserBits';
import { SanctionModal, type SanctionType } from './SanctionModal';

const ROLE_OPTIONS = Role.options.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const STATUS_OPTIONS = UserStatus.options.map((status) => ({ value: status, label: USER_STATUS_LABELS[status] }));

const columns: Column<AdminUser>[] = [
  {
    id: 'user',
    header: 'Usuário',
    primary: true,
    cell: (user) => (
      <Link href={`/admin/usuarios/${user.id}`} className="inline-flex min-h-11 items-center rounded-sm hover:underline md:min-h-0" aria-label={`Abrir o perfil de ${user.nickname}`}>
        <UserIdentity user={user} />
      </Link>
    ),
  },
  { id: 'roles', header: 'Papéis', cell: (user) => <RoleBadges roles={user.roles} /> },
  {
    id: 'status',
    header: 'Status',
    cell: (user) => (
      <span className="flex flex-col items-start gap-0.5">
        <UserStatusPill status={user.status} />
        {user.suspendedUntil && <span className="text-xs text-muted">até {formatDate(user.suspendedUntil)}</span>}
      </span>
    ),
  },
  {
    id: 'security',
    header: '2FA',
    hideOnMobile: true,
    cell: (user) =>
      user.twoFactorEnabled ? (
        <span className="inline-flex items-center gap-1 text-sm">
          <ShieldCheck className="size-4 text-primary-text" aria-hidden /> Ativa
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-sm text-muted">
          <ShieldOff className="size-4" aria-hidden /> Inativa
        </span>
      ),
  },
  { id: 'lastSeen', header: 'Último acesso', cell: (user) => <span title={formatDate(user.lastSeenAt)}>{formatRelative(user.lastSeenAt)}</span> },
  { id: 'created', header: 'Conta criada', hideOnMobile: true, cell: (user) => formatDate(user.createdAt) },
];

/** Usuários (ADM-04): busca por apelido ou e-mail, filtros de papel e status, e sanção em lote. */
export function UsersPage() {
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
      <PageHeader title="Usuários" description="Todas as contas da Nova Arena. Abra um perfil para ver o histórico, aplicar sanção, redefinir a senha ou mesclar contas duplicadas." />

      {users.isError ? (
        <ErrorState description={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Input
              label="Buscar usuário"
              type="search"
              placeholder="Apelido ou e-mail"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
                setSelected([]);
              }}
              autoComplete="off"
            />
            <Select
              label="Papel"
              placeholder="Todos os papéis"
              options={ROLE_OPTIONS}
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
                setSelected([]);
              }}
            />
            <Select
              label="Status"
              placeholder="Todos os status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
                setSelected([]);
              }}
            />
          </div>

          <DataTable
            caption="Usuários"
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
                  Advertir
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setBulk('SUSPENSION')} iconLeft={<PauseCircle className="size-4" aria-hidden />}>
                  Suspender
                </Button>
              </>
            }
            rowActions={(user) => (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/admin/usuarios/${user.id}`}>
                  Ver perfil<span className="sr-only"> de {user.nickname}</span>
                </Link>
              </Button>
            )}
            empty={
              filtered ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title="Nenhum usuário encontrado"
                  description="Nada combina com a busca e os filtros escolhidos."
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Limpar filtros
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="Nenhum usuário ainda" description="As contas aparecem aqui assim que as pessoas se cadastram." />
              )
            }
          />
          <p className="sr-only" role="status" aria-live="polite">
            {users.isPending ? '' : `${users.data?.total ?? 0} usuário(s) na lista.`}
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
