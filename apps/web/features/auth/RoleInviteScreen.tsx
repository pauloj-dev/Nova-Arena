'use client';

import type { RoleInvitePreview } from '@nova/schemas';
import { Button, Skeleton, useToast } from '@nova/ui';
import { CalendarClock, CircleCheck, CircleX, MailWarning, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAcceptRoleInvite, useRoleInvite } from '@/shared/api/hooks/users';
import { formatDateTime } from '@/shared/lib/datetime';
import { useT } from '@/shared/i18n/react';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader, FormAlert, textLink } from './AuthParts';
import { messages } from './messages';
import { withNext } from './safeNext';

type InviteRole = RoleInvitePreview['role'];

/** Área de cada papel. Os textos (título, nome do papel, nome da área, o que pode) ficam no catálogo. */
const ROLE_AREA: Record<InviteRole, string> = { ADMIN: '/admin', ORGANIZER: '/organizador' };

type RoleText = (key: `papel.${InviteRole}.${'titulo' | 'nome' | 'area' | 'pode'}`) => string;

function roleInfo(t: RoleText, role: InviteRole) {
  return {
    title: t(`papel.${role}.titulo`),
    noun: t(`papel.${role}.nome`),
    area: ROLE_AREA[role],
    areaName: t(`papel.${role}.area`),
    can: t(`papel.${role}.pode`),
  };
}

function HomeLink() {
  const t = useT(messages, 'RoleInviteScreen');
  return (
    <Button asChild variant="secondary" fullWidth>
      <Link href="/">{t('irInicio')}</Link>
    </Button>
  );
}

/** `/convite/[token]`: convite para virar Admin ou Organizador (PRD §7.3). */
export function RoleInviteScreen({ token }: { token: string }) {
  const t = useT(messages, 'RoleInviteScreen');
  const router = useRouter();
  const invite = useRoleInvite(token);
  const { user, isLoading: sessionLoading } = useSession();
  const accept = useAcceptRoleInvite();
  const { success } = useToast();
  const invitePath = `/convite/${encodeURIComponent(token)}`;

  if (accept.isSuccess) {
    // Depois do aceite a prévia é recarregada (e pode virar "já foi usado"): esta tela fica até o redirecionamento.
    const role = roleInfo(t, accept.data.role);
    return (
      <div className="flex flex-col gap-5" role="status">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={t('voceAgoraE', { papel: role.noun })} description={t('levando', { area: role.areaName })} />
        <Button asChild fullWidth>
          <Link href={role.area}>{t('abrirArea', { area: role.areaName })}</Link>
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
          <AuthHeader
            icon={<CircleX className="size-6" />}
            title={t('naoEncontradoTitulo')}
            description={t('naoEncontradoDescricao')}
          />
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

  const { role: roleKey, state, invitedBy, expiresAt } = invite.data;
  const role = roleInfo(t, roleKey);

  if (state !== 'VALID') {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={t(`invalido.${state}.titulo`)} description={t(`invalido.${state}.descricao`)} />
        <p className="text-sm text-muted">{t('eraConvite', { quem: invitedBy, papel: role.noun })}</p>
        <HomeLink />
      </div>
    );
  }

  const alreadyHasRole = Boolean(user?.roles.includes(roleKey));
  const invitedByText = t.rich('convidadoPor', { quem: invitedBy, strong: (chunks) => <strong>{chunks}</strong> });
  const alreadyHasRoleText = user && t.rich('jaTemPapel', { nick: user.nickname, papel: role.noun, strong: (chunks) => <strong>{chunks}</strong> });
  const confirmEmailText = user && t.rich('confirmeEmail', { email: user.email, strong: (chunks) => <strong className="[overflow-wrap:anywhere]">{chunks}</strong> });
  const signedInAsText = user && t.rich('entrouComo', { nick: user.nickname, strong: (chunks) => <strong className="text-text">{chunks}</strong> });

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        icon={roleKey === 'ADMIN' ? <ShieldCheck className="size-6" /> : <Trophy className="size-6" />}
        title={role.title}
        description={t('convidouVoce', { quem: invitedBy, papel: role.noun })}
      />

      <ul className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm">
        <li className="flex items-start gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{invitedByText}</span>
        </li>
        <li className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>{t('validoAte', { data: formatDateTime(expiresAt) })}</span>
        </li>
      </ul>
      <p className="text-sm text-muted">{role.can}</p>

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
      ) : alreadyHasRole ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{alreadyHasRoleText}</p>
          <Button asChild fullWidth>
            <Link href={role.area}>{t('abrirArea', { area: role.areaName })}</Link>
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
                onSuccess: ({ role: granted }) => {
                  success(t('aceitoTitulo'), t('aceitoDescricao', { papel: t(`papel.${granted}.nome`) }));
                  router.replace(ROLE_AREA[granted]);
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
