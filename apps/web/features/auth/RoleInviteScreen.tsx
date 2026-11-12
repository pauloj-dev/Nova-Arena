'use client';

import type { RoleInvitePreview } from '@nova/schemas';
import { Button, Skeleton, useToast } from '@nova/ui';
import { CalendarClock, CircleCheck, CircleX, MailWarning, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAcceptRoleInvite, useRoleInvite } from '@/shared/api/hooks/users';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { AuthHeader, FormAlert, textLink } from './AuthParts';
import { withNext } from './safeNext';

type InviteRole = RoleInvitePreview['role'];

const ROLE: Record<InviteRole, { title: string; noun: string; area: string; areaName: string; can: string }> = {
  ADMIN: {
    title: 'Convite para ser administrador',
    noun: 'administrador',
    area: '/admin',
    areaName: 'área de administração',
    can: 'Administradores cuidam de usuários, organizadores, jogos e moderação. A área de administração exige verificação em duas etapas.',
  },
  ORGANIZER: {
    title: 'Convite para ser organizador',
    noun: 'organizador',
    area: '/organizador',
    areaName: 'área de organização',
    can: 'Organizadores criam campeonatos, gerenciam inscrições e lançam resultados.',
  },
};

const INVALID: Record<Exclude<RoleInvitePreview['state'], 'VALID'>, { title: string; description: string }> = {
  EXPIRED: { title: 'Este convite expirou', description: 'O prazo para aceitar terminou. Peça um convite novo a quem convidou você.' },
  REVOKED: { title: 'Este convite foi cancelado', description: 'Quem criou o convite cancelou antes de ele ser aceito. Se foi engano, peça um convite novo.' },
  EXHAUSTED: { title: 'Este convite já foi usado', description: 'O convite atingiu o número máximo de usos. Peça um convite novo a quem convidou você.' },
};

function HomeLink() {
  return (
    <Button asChild variant="secondary" fullWidth>
      <Link href="/">Ir para o início</Link>
    </Button>
  );
}

/** `/convite/[token]`: convite para virar Admin ou Organizador (PRD §7.3). */
export function RoleInviteScreen({ token }: { token: string }) {
  const router = useRouter();
  const invite = useRoleInvite(token);
  const { user, isLoading: sessionLoading } = useSession();
  const accept = useAcceptRoleInvite();
  const { success } = useToast();
  const invitePath = `/convite/${encodeURIComponent(token)}`;

  if (accept.isSuccess) {
    // Depois do aceite a prévia é recarregada (e pode virar "já foi usado"): esta tela fica até o redirecionamento.
    const role = ROLE[accept.data.role];
    return (
      <div className="flex flex-col gap-5" role="status">
        <AuthHeader icon={<CircleCheck className="size-6" />} title={`Você agora é ${role.noun}`} description={`Levando você para a ${role.areaName}…`} />
        <Button asChild fullWidth>
          <Link href={role.area}>Abrir a {role.areaName}</Link>
        </Button>
      </div>
    );
  }

  if (invite.isPending) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-label="Carregando convite">
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
            title="Convite não encontrado"
            description="Este link de convite não existe. Confira se o endereço foi copiado inteiro ou peça um novo a quem convidou você."
          />
          <HomeLink />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title="Não foi possível carregar o convite" />
        <FormAlert>{errorMessage(invite.error)}</FormAlert>
        <Button fullWidth onClick={() => void invite.refetch()} loading={invite.isRefetching}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { role: roleKey, state, invitedBy, expiresAt } = invite.data;
  const role = ROLE[roleKey];

  if (state !== 'VALID') {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader icon={<CircleX className="size-6" />} title={INVALID[state].title} description={INVALID[state].description} />
        <p className="text-sm text-muted">
          Era um convite de {invitedBy} para ser {role.noun}. Nenhuma permissão foi concedida.
        </p>
        <HomeLink />
      </div>
    );
  }

  const alreadyHasRole = Boolean(user?.roles.includes(roleKey));

  return (
    <div className="flex flex-col gap-5">
      <AuthHeader
        icon={roleKey === 'ADMIN' ? <ShieldCheck className="size-6" /> : <Trophy className="size-6" />}
        title={role.title}
        description={`${invitedBy} convidou você para ser ${role.noun} da Nova Arena.`}
      />

      <ul className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm">
        <li className="flex items-start gap-2">
          <UserRound className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            Convidado por <strong>{invitedBy}</strong>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>Válido até {formatDateTime(expiresAt)}</span>
        </li>
      </ul>
      <p className="text-sm text-muted">{role.can}</p>

      {accept.isError && <FormAlert>{errorMessage(accept.error)}</FormAlert>}

      {sessionLoading ? (
        <Skeleton className="h-11 w-full" />
      ) : !user ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">Para aceitar, entre na sua conta ou crie uma. Depois você volta direto para este convite.</p>
          <Button asChild fullWidth>
            <Link href={withNext('/entrar', invitePath)}>Entrar</Link>
          </Button>
          <Button asChild variant="secondary" fullWidth>
            <Link href={withNext('/cadastro', invitePath)}>Criar conta</Link>
          </Button>
        </div>
      ) : alreadyHasRole ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Você entrou como <strong>{user.nickname}</strong> e já é {role.noun}: não precisa aceitar este convite.
          </p>
          <Button asChild fullWidth>
            <Link href={role.area}>Abrir a {role.areaName}</Link>
          </Button>
        </div>
      ) : !user.emailVerified ? (
        <div className="flex flex-col gap-3">
          <div role="note" className="flex items-start gap-2 rounded-md border border-border-strong bg-warning-soft px-3 py-2 text-sm text-warning-soft-text">
            <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Confirme seu e-mail antes de aceitar o convite. Enviamos um link para <strong className="[overflow-wrap:anywhere]">{user.email}</strong>.
            </p>
          </div>
          <Button asChild fullWidth>
            <Link href={withNext('/verificar-email', invitePath)}>Confirmar meu e-mail</Link>
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
                  success('Convite aceito', `Agora você é ${ROLE[granted].noun}.`);
                  router.replace(ROLE[granted].area);
                },
              })
            }
          >
            Aceitar convite
          </Button>
          <p className="text-center text-sm text-muted">
            Você entrou como <strong className="text-text">{user.nickname}</strong>.{' '}
            <Link href="/" className={textLink}>
              Agora não
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
