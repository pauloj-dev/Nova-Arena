'use client';

import { Button, Skeleton, useToast } from '@nova/ui';
import { CalendarClock, CircleCheck, CircleX, MailWarning, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAcceptStaffInvite, useStaffInvite } from '@/shared/api/hooks/organizer-ops';
import { formatDateTime } from '@/shared/lib/datetime';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader, FormAlert, textLink } from './AuthParts';
import { messages } from './messages';
import { withNext } from './safeNext';

const managePath = (tournamentId: string) => `/organizador/campeonatos/${tournamentId}`;

function HomeLink() {
  const t = useT(messages, 'StaffInviteScreen');
  return (
    <Button asChild variant="secondary" fullWidth>
      <Link href="/">{t('irInicio')}</Link>
    </Button>
  );
}

/** `/equipe/convite/[token]`: convite por link para a equipe de um campeonato (co-organizador ou moderador). */
export function StaffInviteScreen({ token }: { token: string }) {
  const t = useT(messages, 'StaffInviteScreen');
  const router = useRouter();
  const invite = useStaffInvite(token);
  const { user, isLoading: sessionLoading } = useSession();
  const accept = useAcceptStaffInvite();
  const { success } = useToast();
  const invitePath = `/equipe/convite/${encodeURIComponent(token)}`;

  if (accept.isSuccess) {
    // Depois do aceite a prévia é recarregada (e pode virar "já foi usado"): esta tela fica até o redirecionamento.
    return (
      <div className="flex flex-col gap-5" role="status">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={t('aceitoTitulo')} description={t('levando')} />
        <Button asChild fullWidth>
          <Link href={managePath(accept.data.tournamentId)}>{t('abrirGestao')}</Link>
        </Button>
      </div>
    );
  }

  if (invite.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
        <Skeleton className="size-12 rounded-full" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (invite.isError) {
    if (invite.error instanceof ApiError && invite.error.status === 404) {
      return (
        <div className="flex flex-col gap-5">
          <AuthHeader icon={<CircleX className="size-6" />} title={t('naoEncontradoTitulo')} description={t('naoEncontradoDescricao')} />
          <HomeLink />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t('erroTitulo')} />
        <FormAlert>{errorMessage(invite.error)}</FormAlert>
        <Button fullWidth onClick={() => void invite.refetch()} loading={invite.isRefetching}>
          {t('tentarNovamente')}
        </Button>
      </div>
    );
  }

  const { role, state, invitedBy, expiresAt, tournament } = invite.data;
  const roleNoun = t(`papel.${role}.nome`);

  if (state !== 'VALID') {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t(`invalido.${state}.titulo`)} description={t(`invalido.${state}.descricao`)} />
        <p className="text-sm text-muted">{t('eraConvite', { quem: invitedBy, campeonato: tournament.name })}</p>
        <Button asChild variant="secondary" fullWidth>
          <Link href={`/c/${tournament.slug}`}>{t('verCampeonato')}</Link>
        </Button>
      </div>
    );
  }

  const strong = (chunks: React.ReactNode) => <strong>{chunks}</strong>;
  const confirmEmailText = user && t.rich('confirmeEmail', { email: user.email, strong: (chunks) => <strong className="[overflow-wrap:anywhere]">{chunks}</strong> });
  const signedInAsText = user && t.rich('entrouComo', { nick: user.nickname, strong: (chunks) => <strong className="text-text">{chunks}</strong> });

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader icon={role === 'CO_ORGANIZER' ? <Trophy className="size-6" /> : <ShieldCheck className="size-6" />} title={t('titulo')} description={t('convidouVoce', { quem: invitedBy, papel: roleNoun, campeonato: tournament.name })} />

      <ul className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm">
        <li className="flex items-start gap-2">
          <Trophy className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 [overflow-wrap:anywhere]">{t.rich('campeonato', { nome: tournament.name, jogo: tournament.gameName, strong })}</span>
        </li>
        <li className="flex items-start gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{t.rich('convidadoPor', { quem: invitedBy, strong })}</span>
        </li>
        <li className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{t('validoAte', { data: formatDateTime(expiresAt) })}</span>
        </li>
      </ul>
      <p className="text-sm text-muted">
        {t(`papel.${role}.pode`)} {t('naoDaParaJogar')}
      </p>

      {accept.isError && <FormAlert>{errorMessage(accept.error)}</FormAlert>}

      {sessionLoading ? (
        <Skeleton className="h-11 w-full" />
      ) : !user ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t('paraAceitar')}</p>
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', invitePath)}>{t('entrar')}</Link>
          </Button>
          <Button asChild variant="secondary" fullWidth>
            <Link href={withNext('/cadastro', invitePath)}>{t('criarConta')}</Link>
          </Button>
        </div>
      ) : !user.emailVerified ? (
        <div className="flex flex-col gap-3">
          <div role="note" className="flex items-start gap-2 rounded-md border border-border-strong bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
            <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{confirmEmailText}</p>
          </div>
          <Button asChild fullWidth>
            <Link href={withNext('/verificar-email', invitePath)}>{t('confirmarEmail')}</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            loading={accept.isPending}
            onClick={() =>
              accept.mutate(token, {
                onSuccess: (res) => {
                  success(t('aceitoTitulo'), t('aceitoDescricao', { papel: t(`papel.${res.role}.nome`), campeonato: tournament.name }));
                  router.replace(managePath(res.tournamentId));
                },
              })
            }
          >
            {t('aceitar')}
          </Button>
          <p className="text-center text-sm text-muted">
            {signedInAsText}{' '}
            <Link href="/" className={textLink}>
              {t('agoraNao')}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
