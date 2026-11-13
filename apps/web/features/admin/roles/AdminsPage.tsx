'use client';

import type { AdminMember, AdminRemovalRequest } from '@nova/schemas';
import { Badge, Button, Card, DataTable, ErrorState, Skeleton, StatusPill, useToast, type Column } from '@nova/ui';
import { Crown, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAdminRemovalRequests, useAdmins, useReviewAdminRemoval, useRevokeRole } from '@/shared/api/hooks/admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate, formatRelative } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { ReasonModal } from '../common/ReasonModal';
import { UserIdentity } from '../common/UserBits';
import { InvitesSection } from './InvitesSection';

const columns: Column<AdminMember>[] = [
  { id: 'admin', header: 'Administrador', primary: true, cell: (admin) => <UserIdentity user={admin} /> },
  {
    id: 'role',
    header: 'Papel',
    cell: (admin) =>
      admin.isSuperAdmin ? (
        <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
          Super Admin
        </Badge>
      ) : (
        <Badge tone="accent">Administrador</Badge>
      ),
  },
  { id: 'since', header: 'No papel desde', cell: (admin) => formatDate(admin.adminSince) },
  { id: 'lastSeen', header: 'Último acesso', cell: (admin) => <span title={formatDate(admin.lastSeenAt)}>{formatRelative(admin.lastSeenAt)}</span> },
  {
    id: 'twoFactor',
    header: '2FA',
    cell: (admin) =>
      admin.twoFactorEnabled ? (
        <span className="inline-flex items-center gap-1 text-sm">
          <ShieldCheck className="size-4 text-primary-text" aria-hidden /> Ativa
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-sm text-muted">
          <ShieldOff className="size-4" aria-hidden /> Pendente
        </span>
      ),
  },
];

function RemovalRequests({ canDecide }: { canDecide: boolean }) {
  const toast = useToast();
  const requests = useAdminRemovalRequests();
  const review = useReviewAdminRemoval();
  if (requests.isPending) return <Skeleton className="h-20 w-full" />;
  if (requests.isError) return <ErrorState description={errorMessage(requests.error)} onRetry={() => void requests.refetch()} />;
  if (requests.data.length === 0) return null;

  function decide(request: AdminRemovalRequest, decision: 'approve' | 'reject') {
    review.mutate(
      { requestId: request.id, decision },
      {
        onSuccess: () => toast.success(decision === 'approve' ? 'Pedido aprovado' : 'Pedido recusado', decision === 'approve' ? `${request.targetNickname} não é mais administrador.` : `${request.targetNickname} continua como administrador.`),
        onError: (error) => toast.error('Não foi possível registrar a decisão', errorMessage(error)),
      },
    );
  }

  return (
    <section aria-labelledby="pedidos-remocao" className="flex flex-col gap-3">
      <div>
        <h2 id="pedidos-remocao" className="text-lg">
          Pedidos de remoção
        </h2>
        <p className="text-sm text-muted">Remover um administrador mais antigo depende da aprovação do Super Admin. Até lá, a pessoa continua com acesso.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {requests.data.map((request) => (
          <li key={request.id}>
            <Card padding="sm" className="flex flex-col gap-2" data-testid="removal-request">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm [overflow-wrap:anywhere]">
                  <strong>{request.requestedByNickname}</strong> pediu a remoção de <strong>{request.targetNickname}</strong>
                </p>
                <StatusPill status={request.status} label={request.status === 'PENDING' ? 'Aguardando o Super Admin' : request.status === 'APPROVED' ? 'Aprovado' : 'Recusado'} />
              </div>
              {request.reason && <p className="text-sm text-muted [overflow-wrap:anywhere]">Motivo: {request.reason}</p>}
              <p className="text-xs text-muted">
                Pedido em {formatDate(request.createdAt)}
                {request.reviewedByNickname && request.reviewedAt && ` · decidido por ${request.reviewedByNickname} em ${formatDate(request.reviewedAt)}`}
              </p>
              {request.status === 'PENDING' && canDecide && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="danger" loading={review.isPending && review.variables?.requestId === request.id && review.variables.decision === 'approve'} onClick={() => decide(request, 'approve')}>
                    Aprovar remoção
                  </Button>
                  <Button size="sm" variant="secondary" loading={review.isPending && review.variables?.requestId === request.id && review.variables.decision === 'reject'} onClick={() => decide(request, 'reject')}>
                    Recusar
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Administradores (ADM-02): quem tem o papel, último acesso, remoção (RN-11) e convites. */
export function AdminsPage() {
  const toast = useToast();
  const { user: me } = useSession();
  const admins = useAdmins();
  const revoke = useRevokeRole();
  const [removing, setRemoving] = useState<AdminMember | null>(null);
  const iAmSuper = Boolean(me?.roles.includes('SUPER_ADMIN'));

  function confirmRemoval(reason: string) {
    if (!removing) return;
    revoke.mutate(
      { userId: removing.id, role: 'ADMIN', reason },
      {
        onSuccess: (result) => {
          if (result.outcome === 'PENDING_APPROVAL') toast.toast({ title: 'Pedido enviado ao Super Admin', description: `${removing.nickname} é administrador há mais tempo que você: a remoção só vale depois da aprovação.`, tone: 'info' });
          else toast.success('Administrador removido', `${removing.nickname} não tem mais acesso à área de administração.`);
          setRemoving(null);
        },
        onError: (error) => toast.error('Não foi possível remover', errorMessage(error)),
      },
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Administradores" description="Quem cuida da plataforma. Ninguém remove o Super Admin; para remover um administrador mais antigo que você, o Super Admin precisa aprovar." />

      {admins.isError ? (
        <ErrorState description={errorMessage(admins.error)} onRetry={() => void admins.refetch()} />
      ) : (
        <DataTable
          caption="Administradores"
          columns={columns}
          rows={admins.data ?? []}
          getRowId={(admin) => admin.id}
          loading={admins.isPending}
          rowActions={(admin) =>
            admin.isSuperAdmin ? (
              <span className="text-xs text-muted">Não pode ser removido</span>
            ) : admin.id === me?.id ? (
              <span className="text-xs text-muted">É você</span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setRemoving(admin)} iconLeft={<UserMinus className="size-4" aria-hidden />}>
                Remover<span className="sr-only"> {admin.nickname} da administração</span>
              </Button>
            )
          }
        />
      )}

      <RemovalRequests canDecide={iAmSuper} />
      <InvitesSection defaultRole="ADMIN" />

      <ReasonModal
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={removing ? `Remover ${removing.nickname} da administração` : 'Remover administrador'}
        description={
          iAmSuper
            ? 'A pessoa perde o acesso à área de administração na hora e continua como participante.'
            : 'Se a pessoa virou administradora depois de você, a remoção vale na hora. Se é mais antiga, o pedido vai para o Super Admin aprovar.'
        }
        minLength={0}
        confirmLabel="Remover administrador"
        variant="danger"
        loading={revoke.isPending}
        onConfirm={confirmRemoval}
      />
    </PageContainer>
  );
}
