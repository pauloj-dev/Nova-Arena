'use client';

import type { TeamInvite } from '@nova/schemas';
import { Button, Card, ErrorState, Skeleton, useToast } from '@nova/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useAcceptTeamInvite, useDeclineTeamInvite, useMyTeamInvites } from '@/shared/api/hooks/teams';
import { formatDateTime } from '@/shared/lib/datetime';
import { TeamLogo } from './TeamLogo';

/** Convites feitos para o meu apelido: aceitar ou recusar. Não aparece quando não há convite. */
export function ReceivedInvites() {
  const invites = useMyTeamInvites();
  const accept = useAcceptTeamInvite();
  const decline = useDeclineTeamInvite();
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (invites.isPending) {
    return (
      <div role="status" aria-label="Carregando convites">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (invites.isError) return <ErrorState title="Não foi possível carregar seus convites" description={errorMessage(invites.error)} onRetry={() => void invites.refetch()} />;
  if (invites.data.length === 0) return null;

  function onAccept(invite: TeamInvite) {
    setBusy(invite.id);
    accept.mutate(invite.code, {
      onSuccess: (team) => {
        success(`Você entrou no ${team.name}`);
        router.push(`/minha-conta/squads/${team.id}`);
      },
      onError: (e) => error('Não foi possível aceitar o convite', errorMessage(e)),
      onSettled: () => setBusy(null),
    });
  }
  function onDecline(invite: TeamInvite) {
    setBusy(invite.id);
    decline.mutate(invite.code, {
      onSuccess: () => success(`Convite do ${invite.teamName} recusado`),
      onError: (e) => error('Não foi possível recusar o convite', errorMessage(e)),
      onSettled: () => setBusy(null),
    });
  }

  return (
    <section aria-labelledby="convites-recebidos" className="flex flex-col gap-3">
      <h2 id="convites-recebidos" className="text-lg">
        Convites recebidos
      </h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {invites.data.map((invite) => (
          <li key={invite.id}>
            <Card padding="sm" className="flex flex-col gap-3 xs:flex-row xs:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <TeamLogo tag={invite.teamTag} logoUrl={null} />
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {invite.teamName} <span className="tabular text-xs text-muted">[{invite.teamTag}]</span>
                  </p>
                  <p className="text-sm text-muted">
                    {invite.invitedByNickname} convidou você · vale até {formatDateTime(invite.expiresAt)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" loading={busy === invite.id && accept.isPending} disabled={busy !== null} aria-label={`Aceitar o convite do ${invite.teamName}`} onClick={() => onAccept(invite)}>
                  Aceitar
                </Button>
                <Button size="sm" variant="secondary" loading={busy === invite.id && decline.isPending} disabled={busy !== null} aria-label={`Recusar o convite do ${invite.teamName}`} onClick={() => onDecline(invite)}>
                  Recusar
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
