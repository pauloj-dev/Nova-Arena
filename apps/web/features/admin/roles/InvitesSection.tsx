'use client';

import type { RoleInvite } from '@nova/schemas';
import { Badge, Button, Card, DataTable, ErrorState, Skeleton, StatusPill, useToast, type Column } from '@nova/ui';
import { CheckCircle2, Hourglass, Link2Off } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCreateRoleInvite, useRevokeRoleInvite, useRoleInvites } from '@/shared/api/hooks/admin';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { InviteForm } from './InviteForm';
import { adminRolesMessages } from './messages';

// Abaixo da lista: desce só quando a tela abre (o teto de JS inicial por rota, #111).
const StaffInviteCard = dynamic(() => import('./StaffInviteCard').then((m) => m.StaffInviteCard), { loading: () => <Skeleton className="h-48 w-full" /> });

type InvitesT = ReturnType<typeof useT<(typeof adminRolesMessages)['pt-BR'], 'InvitesSection'>>;

/** Estado do convite, com ícone e texto: válido, expirado, revogado ou esgotado. */
function InviteState({ state }: { state: RoleInvite['state'] }) {
  const t = useT(adminRolesMessages, 'InvitesSection');
  if (state === 'VALID') {
    return (
      <Badge tone="primary" icon={<CheckCircle2 className="size-3.5" aria-hidden />}>
        {t('valido')}
      </Badge>
    );
  }
  if (state === 'EXHAUSTED') {
    return (
      <Badge tone="neutral" icon={<Hourglass className="size-3.5" aria-hidden />}>
        {t('esgotado')}
      </Badge>
    );
  }
  return <StatusPill status={state} />;
}

function buildColumns(t: InvitesT): Column<RoleInvite>[] {
  return [
    {
      id: 'invite',
      header: t('colunaConvite'),
      primary: true,
      cell: (invite) => (
        <span className="flex flex-col">
          <span className="font-semibold">{t('papel', { papel: invite.role })}</span>
          <span className="text-xs font-normal text-muted [overflow-wrap:anywhere]">{invite.email ? t('porEmail', { email: invite.email }) : t('linkCompartilhavel')}</span>
        </span>
      ),
    },
    { id: 'state', header: t('colunaEstado'), cell: (invite) => <InviteState state={invite.state} /> },
    { id: 'uses', header: t('colunaUsos'), cell: (invite) => <span className="tabular">{t('usos', { usos: String(invite.uses), max: String(invite.maxUses) })}</span> },
    { id: 'expires', header: t('colunaExpira'), cell: (invite) => formatDateTime(invite.expiresAt, { withZone: false }) },
    { id: 'by', header: t('colunaCriadoPor'), hideOnMobile: true, cell: (invite) => invite.createdByNickname },
  ];
}

/** Convites (PRD §7.3): Admin e Organizador para a plataforma e a equipe de um campeonato. Gerar, acompanhar e revogar. */
export function InvitesSection({ defaultRole = 'ADMIN' }: { defaultRole?: 'ADMIN' | 'ORGANIZER' }) {
  const t = useT(adminRolesMessages, 'InvitesSection');
  const columns = useMemo(() => buildColumns(t), [t]);
  const toast = useToast();
  const invites = useRoleInvites();
  const create = useCreateRoleInvite();
  const revoke = useRevokeRoleInvite();

  return (
    <section aria-labelledby="convites" id="convites-secao" className="flex flex-col gap-4">
      <div>
        <h2 id="convites" className="text-lg">
          {t('titulo')}
        </h2>
        <p className="text-sm text-muted">{t('descricao')}</p>
      </div>
      <Card>
        <InviteForm defaultRole={defaultRole} onCreate={(input) => create.mutateAsync(input)} />
      </Card>
      {invites.isError ? (
        <ErrorState description={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />
      ) : (
        <DataTable
          caption={t('titulo')}
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
                    onSuccess: () => toast.success(t('revogado'), t('revogadoDescricao')),
                    onError: (error) => toast.error(t('erroRevogar'), errorMessage(error)),
                  })
                }
              >
                {t('revogar')}<span className="sr-only">{t('revogarSr', { papel: t('papel', { papel: invite.role }) })}</span>
              </Button>
            ) : (
              <span className="text-xs text-muted">{t('semAcoes')}</span>
            )
          }
          empty={<p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-muted">{t('vazio')}</p>}
        />
      )}
      <p className="text-xs text-muted">{t('linkSoUmaVez')}</p>
      <StaffInviteCard />
    </section>
  );
}
