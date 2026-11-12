'use client';

import type { RoleInvite } from '@nova/schemas';
import { Badge, Button, Card, DataTable, ErrorState, StatusPill, useToast, type Column } from '@nova/ui';
import { CheckCircle2, Hourglass, Link2Off } from 'lucide-react';
import { errorMessage } from '@/shared/api/client';
import { useCreateRoleInvite, useRevokeRoleInvite, useRoleInvites } from '@/shared/api/hooks/admin';
import { formatDateTime } from '@/shared/lib/datetime';
import { InviteForm } from './InviteForm';

const ROLE_NAME: Record<RoleInvite['role'], string> = { ADMIN: 'Administrador', ORGANIZER: 'Organizador' };

/** Estado do convite, com ícone e texto: válido, expirado, revogado ou esgotado. */
function InviteState({ state }: { state: RoleInvite['state'] }) {
  if (state === 'VALID') {
    return (
      <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
        Válido
      </Badge>
    );
  }
  if (state === 'EXHAUSTED') {
    return (
      <Badge tone="neutral" icon={<Hourglass className="size-3.5" aria-hidden />}>
        Esgotado
      </Badge>
    );
  }
  return <StatusPill status={state} />;
}

const columns: Column<RoleInvite>[] = [
  {
    id: 'invite',
    header: 'Convite',
    primary: true,
    cell: (invite) => (
      <span className="flex flex-col">
        <span className="font-semibold">{ROLE_NAME[invite.role]}</span>
        <span className="text-xs font-normal text-muted [overflow-wrap:anywhere]">{invite.email ? `Por e-mail: ${invite.email}` : 'Link compartilhável'}</span>
      </span>
    ),
  },
  { id: 'state', header: 'Estado', cell: (invite) => <InviteState state={invite.state} /> },
  { id: 'uses', header: 'Usos', cell: (invite) => <span className="tabular">{`${invite.uses} de ${invite.maxUses}`}</span> },
  { id: 'expires', header: 'Expira em', cell: (invite) => formatDateTime(invite.expiresAt, { withZone: false }) },
  { id: 'by', header: 'Criado por', hideOnMobile: true, cell: (invite) => invite.createdByNickname },
];

/** Convites de Admin e Organizador (PRD §7.3): gerar, acompanhar o estado e revogar. */
export function InvitesSection({ defaultRole = 'ADMIN' }: { defaultRole?: 'ADMIN' | 'ORGANIZER' }) {
  const toast = useToast();
  const invites = useRoleInvites();
  const create = useCreateRoleInvite();
  const revoke = useRevokeRoleInvite();

  return (
    <section aria-labelledby="convites" id="convites-secao" className="flex flex-col gap-4">
      <div>
        <h2 id="convites" className="text-lg">
          Convites
        </h2>
        <p className="text-sm text-muted">Delegue a gestão sem expor a sua conta: quem aceita o convite ganha o papel. Criar, aceitar e revogar ficam na auditoria.</p>
      </div>
      <Card>
        <InviteForm defaultRole={defaultRole} onCreate={(input) => create.mutateAsync(input)} />
      </Card>
      {invites.isError ? (
        <ErrorState description={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />
      ) : (
        <DataTable
          caption="Convites"
          columns={columns}
          rows={invites.data ?? []}
          getRowId={(invite) => invite.id}
          loading={invites.isPending}
          rowActions={(invite) =>
            invite.state === 'VALID' ? (
              <Button
                size="sm"
                variant="secondary"
                loading={revoke.isPending && revoke.variables === invite.id}
                iconLeft={<Link2Off className="size-4" aria-hidden />}
                onClick={() =>
                  revoke.mutate(invite.id, {
                    onSuccess: () => toast.success('Convite revogado', 'O link parou de funcionar.'),
                    onError: (error) => toast.error('Não foi possível revogar o convite', errorMessage(error)),
                  })
                }
              >
                Revogar<span className="sr-only"> convite de {ROLE_NAME[invite.role]}</span>
              </Button>
            ) : (
              <span className="text-xs text-muted">Sem ações</span>
            )
          }
          empty={<p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">Nenhum convite criado ainda. Gere o primeiro no formulário acima.</p>}
        />
      )}
      <p className="text-xs text-muted">O link completo só aparece na hora em que o convite é criado. Se perdeu, revogue e gere outro.</p>
    </section>
  );
}
