'use client';

import type { TeamInvitePreview } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { Clock, MailX, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAcceptTeamInvite, useDeclineTeamInvite, useTeamInvitePreview } from '@/shared/api/hooks/teams';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { invitePath, inviteStateMessage, isInviteCodeShape, normalizeInviteCode } from './lib/rules';
import { TeamLogo } from './TeamLogo';

const squadsLink = (
  <Button asChild variant="secondary">
    <Link href="/minha-conta/squads">Ir para meus squads</Link>
  </Button>
);

/** `/squads/convite/[code]`: prévia pública do convite e botão de aceitar. */
export function TeamInvitePage({ code: rawCode }: { code: string }) {
  const code = normalizeInviteCode(rawCode);
  const validShape = isInviteCodeShape(code);
  // Código fora do formato nem vai à API: não gasta tentativa do limite contra força bruta.
  const preview = useTeamInvitePreview(validShape ? code : undefined);

  return (
    <PageContainer narrow>
      <h1 className="text-xl md:text-2xl">Convite para squad</h1>
      {!validShape ? (
        <InvalidInvite />
      ) : preview.isPending ? (
        <div role="status" aria-label="Carregando o convite">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : preview.isError ? (
        <InviteError error={preview.error} onRetry={() => void preview.refetch()} />
      ) : (
        <InviteCard invite={preview.data} />
      )}
    </PageContainer>
  );
}

function InvalidInvite() {
  return (
    <EmptyState
      icon={<MailX className="size-7" />}
      title="Convite não encontrado"
      description="Não achamos nenhum convite com este código. Confira se o link está completo ou peça um novo ao capitão do squad."
      action={squadsLink}
    />
  );
}

function InviteError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  if (error instanceof ApiError && error.status === 404) return <InvalidInvite />;
  if (error instanceof ApiError && error.status === 429) {
    return <EmptyState icon={<ShieldAlert className="size-7" />} title="Muitas tentativas" description={error.message} action={<Button onClick={onRetry}>Tentar novamente</Button>} />;
  }
  return <ErrorState title="Não foi possível carregar o convite" description={errorMessage(error)} onRetry={onRetry} />;
}

function InviteCard({ invite }: { invite: TeamInvitePreview }) {
  const { user, isLoading } = useSession();
  const router = useRouter();
  const { success, error } = useToast();
  const accept = useAcceptTeamInvite();
  const decline = useDeclineTeamInvite();
  const { team } = invite;
  const blocked = inviteStateMessage(invite.state);
  const next = encodeURIComponent(invitePath(invite.code));
  const directedToMe = Boolean(user) && invite.invitedNickname !== null && !invite.viewerIsNotInvitee;

  function onAccept() {
    accept.mutate(invite.code, {
      onSuccess: (joined) => {
        success(`Você entrou no ${joined.name}`);
        router.push(`/minha-conta/squads/${joined.id}`);
      },
      onError: (e) => error('Não foi possível aceitar o convite', errorMessage(e)),
    });
  }
  function onDecline() {
    decline.mutate(invite.code, {
      onSuccess: () => {
        success(`Convite do ${team.name} recusado`);
        router.push('/minha-conta/squads');
      },
      onError: (e) => error('Não foi possível recusar o convite', errorMessage(e)),
    });
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <TeamLogo tag={team.tag} logoUrl={team.logoUrl} size="xl" />
        <div className="min-w-0">
          <h2 className="break-words text-lg">{team.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="tabular">[{team.tag}]</span>
            <span className="flex items-center gap-1.5">
              <Users className="size-4" aria-hidden />
              {team.memberCount === 1 ? '1 membro' : `${team.memberCount} membros`}
            </span>
          </p>
        </div>
      </div>

      <p className="text-text">
        <strong>{invite.invitedByNickname}</strong> convidou {invite.invitedNickname && !directedToMe ? <strong>{invite.invitedNickname}</strong> : 'você'} para jogar no <strong>{team.name}</strong>.
      </p>

      {blocked ? (
        <div className="flex flex-col gap-3">
          <StatusPill status={invite.state === 'VALID' ? 'PENDING' : invite.state} className="self-start" />
          <p role="alert" className="text-sm text-text">
            {blocked}
          </p>
          <div>{squadsLink}</div>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Clock className="size-4 shrink-0" aria-hidden />
            Convite válido até {formatDateTime(invite.expiresAt)}
          </p>

          {isLoading ? (
            <Skeleton className="h-11 w-48" />
          ) : !user ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">Entre na sua conta para aceitar. Depois do login você volta para este convite.</p>
              <div className="flex flex-col gap-2 xs:flex-row">
                <Button asChild>
                  <Link href={`/entrar?next=${next}`}>Entrar para aceitar</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={`/cadastro?next=${next}`}>Criar conta</Link>
                </Button>
              </div>
            </div>
          ) : invite.viewerIsMember ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-text">
                Você já faz parte deste squad.
              </p>
              <div>
                <Button asChild>
                  <Link href={`/minha-conta/squads/${team.id}`}>Abrir o squad</Link>
                </Button>
              </div>
            </div>
          ) : invite.viewerIsNotInvitee ? (
            <p role="alert" className="text-sm text-text">
              Este convite foi enviado para {invite.invitedNickname}. Para entrar no squad com a sua conta, peça ao capitão um convite para o seu apelido ou o link de convite.
            </p>
          ) : (
            <div className="flex flex-col gap-2 xs:flex-row">
              <Button loading={accept.isPending} disabled={decline.isPending} onClick={onAccept}>
                Aceitar convite
              </Button>
              {directedToMe && (
                <Button variant="secondary" loading={decline.isPending} disabled={accept.isPending} onClick={onDecline}>
                  Recusar
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
