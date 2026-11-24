'use client';

import type { AcceptTeamInviteResult, TeamInvitePreview } from '@nova/schemas';
import { Button, Card, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { CheckCircle2, Clock, Hourglass, MailX, ShieldAlert, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAcceptTeamInvite, useDeclineTeamInvite, useTeamInvitePreview } from '@/shared/api/hooks/teams';
import { PageContainer } from '@/shared/layout/AreaShell';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { invitePath, inviteStateMessage, isInviteCodeShape, normalizeInviteCode } from './lib/rules';
import { messages } from './messages';
import { TeamLogo } from './TeamLogo';

function SquadsLink() {
  const t = useT(messages, 'TeamInvitePage');
  return (
    <Button asChild variant="secondary">
      <Link href="/minha-conta/squads">{t('irParaMeusSquads')}</Link>
    </Button>
  );
}

/** `/squads/convite/[code]`: prévia pública do convite e botão de aceitar. */
export function TeamInvitePage({ code: rawCode }: { code: string }) {
  const t = useT(messages, 'TeamInvitePage');
  const code = normalizeInviteCode(rawCode);
  const validShape = isInviteCodeShape(code);
  // Código fora do formato nem vai à API: não gasta tentativa do limite contra força bruta.
  const preview = useTeamInvitePreview(validShape ? code : undefined);

  return (
    <PageContainer narrow>
      <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
      {!validShape ? (
        <InvalidInvite />
      ) : preview.isPending ? (
        <div role="status" aria-label={t('carregando')}>
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
  const t = useT(messages, 'TeamInvitePage');
  return (
    <EmptyState
      icon={<MailX className="size-7" />}
      title={t('naoEncontradoTitulo')}
      description={t('naoEncontradoDescricao')}
      action={<SquadsLink />}
    />
  );
}

function InviteError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT(messages, 'TeamInvitePage');
  if (error instanceof ApiError && error.status === 404) return <InvalidInvite />;
  if (error instanceof ApiError && error.status === 429) {
    return <EmptyState icon={<ShieldAlert className="size-7" />} title={t('muitasTentativas')} description={error.message} action={<Button onClick={onRetry}>{t('tentarNovamente')}</Button>} />;
  }
  return <ErrorState title={t('erroCarregar')} description={errorMessage(error)} onRetry={onRetry} />;
}

function InviteCard({ invite }: { invite: TeamInvitePreview }) {
  const t = useT(messages, 'InviteCard');
  const { user, isLoading } = useSession();
  const router = useRouter();
  const { success, error } = useToast();
  const accept = useAcceptTeamInvite();
  const decline = useDeclineTeamInvite();
  const { team } = invite;
  const blocked = inviteStateMessage(invite.state);
  const next = encodeURIComponent(invitePath(invite.code));
  const directedToMe = Boolean(user) && invite.invitedNickname !== null && !invite.viewerIsNotInvitee;
  const [joined, setJoined] = useState<AcceptTeamInviteResult | null>(null);

  function onAccept() {
    accept.mutate(invite.code, {
      onSuccess: (result) => {
        success(t('entrou', { nome: result.name }));
        // Entrou também no elenco de algum campeonato: mostra onde (e o que falta) antes de seguir.
        if (result.rosters.length > 0) setJoined(result);
        else router.push(`/minha-conta/squads/${result.id}`);
      },
      onError: (e) => error(t('erroAceitar'), errorMessage(e)),
    });
  }
  function onDecline() {
    decline.mutate(invite.code, {
      onSuccess: () => {
        success(t('recusado', { nome: team.name }));
        router.push('/minha-conta/squads');
      },
      onError: (e) => error(t('erroRecusar'), errorMessage(e)),
    });
  }

  const invitedText = t.rich('convidou', {
    quem: invite.invitedByNickname,
    paraVoce: invite.invitedNickname && !directedToMe ? 'nao' : 'sim',
    convidado: invite.invitedNickname ?? '',
    time: team.name,
    b: (chunks) => <strong>{chunks}</strong>,
  });

  if (joined) return <JoinedRosters result={joined} />;

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
              {t('membros', { count: team.memberCount })}
            </span>
          </p>
        </div>
      </div>

      <p className="text-text">
        {invitedText}
      </p>

      {blocked ? (
        <div className="flex flex-col gap-3">
          <StatusPill status={invite.state === 'VALID' ? 'PENDING' : invite.state} className="self-start" />
          <p role="alert" className="text-sm text-text">
            {blocked}
          </p>
          <div>
            <SquadsLink />
          </div>
        </div>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <Clock className="size-4 shrink-0" aria-hidden />
            {t('validoAte', { data: formatDateTime(invite.expiresAt) })}
          </p>

          {isLoading ? (
            <Skeleton className="h-11 w-48" />
          ) : !user ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted">{t('entreParaAceitar')}</p>
              <div className="flex flex-col gap-2 xs:flex-row">
                <Button asChild>
                  <Link href={`/entrar?next=${next}`}>{t('entrarParaAceitar')}</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href={`/cadastro?next=${next}`}>{t('criarConta')}</Link>
                </Button>
              </div>
            </div>
          ) : invite.viewerIsMember ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="text-sm text-text">
                {t('jaFazParte')}
              </p>
              <div>
                <Button asChild>
                  <Link href={`/minha-conta/squads/${team.id}`}>{t('abrirSquad')}</Link>
                </Button>
              </div>
            </div>
          ) : invite.viewerIsNotInvitee ? (
            <p role="alert" className="text-sm text-text">
              {t('enviadoPara', { nome: invite.invitedNickname ?? '' })}
            </p>
          ) : (
            <div className="flex flex-col gap-2 xs:flex-row">
              <Button loading={accept.isPending} disabled={decline.isPending} onClick={onAccept}>
                {t('aceitarConvite')}
              </Button>
              {directedToMe && (
                <Button variant="secondary" loading={decline.isPending} disabled={accept.isPending} onClick={onDecline}>
                  {t('recusar')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Depois de aceitar: os campeonatos em que o jogador já entrou no elenco do squad (e se falta confirmar). */
function JoinedRosters({ result }: { result: AcceptTeamInviteResult }) {
  const t = useT(messages, 'InviteCard');
  return (
    <Card className="flex flex-col gap-4" data-testid="joined-rosters">
      <h2 className="text-lg">{t('elencoTitulo')}</h2>
      <ul className="flex flex-col gap-3">
        {result.rosters.map((r) => (
          <li key={r.registrationId} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <p className="flex items-start gap-2 text-sm text-text">
              {r.confirmed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden /> : <Hourglass className="mt-0.5 size-4 shrink-0 text-warning-soft-text" aria-hidden />}
              <span>{t.rich(r.confirmed ? 'elencoConfirmado' : 'elencoPendente', { time: result.name, campeonato: r.tournamentName, b: (chunks) => <strong>{chunks}</strong> })}</span>
            </p>
            <Button asChild size="sm" variant={r.confirmed ? 'secondary' : 'primary'} className="self-start">
              <Link href={`/c/${r.tournamentSlug}`}>{r.confirmed ? t('verCampeonato') : t('confirmarParticipacao')}</Link>
            </Button>
          </li>
        ))}
      </ul>
      <Button asChild variant="ghost" className="self-start">
        <Link href={`/minha-conta/squads/${result.id}`}>{t('abrirSquad')}</Link>
      </Button>
    </Card>
  );
}
