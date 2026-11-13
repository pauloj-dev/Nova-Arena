'use client';

import type { PublicUser } from '@nova/schemas';
import { Avatar, Button, Card, ErrorState, Skeleton } from '@nova/ui';
import { CalendarDays, MapPin, Pencil, UserX } from 'lucide-react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/shared/api/client';
import { usePublicProfile } from '@/shared/api/hooks/users';
import { ReportButton } from '@/features/reports/ReportButton';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { CompetitiveHistory } from './competitive/CompetitiveHistory';
import { locationLabel, SOCIAL_NETWORKS, socialHref } from './profileLib';
import { VerifiedBadge } from './VerifiedBadge';

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="Carregando perfil">
      <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-4 xs:flex-row xs:items-start md:p-6">
        <Skeleton className="size-20 shrink-0 rounded-full" />
        <div className="flex w-full flex-col items-center gap-3 xs:items-start">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function Socials({ socials }: { socials: PublicUser['socials'] }) {
  const filled = SOCIAL_NETWORKS.map((n) => ({ ...n, value: socials[n.key]?.trim() ?? '' })).filter((n) => n.value !== '');
  if (filled.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1.5 text-sm">
      {filled.map((n) => {
        const href = socialHref(n.value);
        return (
          <div key={n.key} className="flex min-w-0 flex-wrap gap-x-2">
            <dt className="font-semibold text-text">{n.label}</dt>
            <dd className="min-w-0 text-muted [overflow-wrap:anywhere]">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary-text underline underline-offset-2">
                  {n.value}
                  <span className="sr-only"> (abre em nova aba)</span>
                </a>
              ) : (
                n.value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** `/u/[nick]`: perfil público. Só o que está em `PublicUser` — nunca e-mail nem IDs de jogo (RNF-10). */
export function PublicProfile({ nickname }: { nickname: string }) {
  const profile = usePublicProfile(nickname);
  const { user: me } = useSession();

  if (profile.isPending) {
    return (
      <PageContainer narrow>
        <ProfileSkeleton />
      </PageContainer>
    );
  }

  if (profile.isError) {
    const missing = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <PageContainer narrow>
        {missing ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
              <UserX className="size-7" />
            </div>
            <h1 className="text-xl">Perfil não encontrado</h1>
            <p className="max-w-md text-sm text-muted">Não existe jogador com este apelido. Ele pode ter mudado de apelido ou a conta pode ter sido excluída.</p>
            <Button asChild>
              <Link href="/campeonatos">Ver campeonatos</Link>
            </Button>
          </div>
        ) : (
          <>
            <h1 className="text-xl md:text-2xl">Perfil</h1>
            <ErrorState title="Não foi possível carregar este perfil" description={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
          </>
        )}
      </PageContainer>
    );
  }

  const user = profile.data;
  const location = locationLabel(user.state, user.country);
  const isMine = me?.id === user.id;

  return (
    <PageContainer narrow>
      <Card>
        <div className="flex flex-col items-center gap-4 text-center xs:flex-row xs:items-start xs:text-left">
          <Avatar name={user.nickname} src={user.avatarUrl} size="xl" />
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3 xs:items-start">
            <div className="flex min-w-0 max-w-full flex-wrap items-center justify-center gap-2 xs:justify-start">
              <h1 className="min-w-0 text-xl [overflow-wrap:anywhere] md:text-2xl">{user.nickname}</h1>
              {user.verifiedOrganizer && <VerifiedBadge />}
            </div>
            {user.bio && <p className="max-w-prose text-sm text-text [overflow-wrap:anywhere]">{user.bio}</p>}
            <ul className="flex flex-col gap-1 text-sm text-muted">
              {location && (
                <li className="flex items-center justify-center gap-2 xs:justify-start">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  {location}
                </li>
              )}
              <li className="flex items-center justify-center gap-2 xs:justify-start">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                Na Nova Arena desde {formatDate(user.createdAt)}
              </li>
            </ul>
            <Socials socials={user.socials} />
            {isMine ? (
              <Button asChild variant="secondary" size="sm" iconLeft={<Pencil className="size-4" aria-hidden />}>
                <Link href="/minha-conta">Editar perfil</Link>
              </Button>
            ) : (
              <ReportButton targetType="USER" targetId={user.id} targetLabel={user.nickname} />
            )}
          </div>
        </div>
      </Card>

      <CompetitiveHistory nickname={user.nickname} isMine={isMine} />
    </PageContainer>
  );
}
