import type { TournamentSummary } from '@nova/schemas';
import { Badge, cn, Progress, Skeleton, StatusPill } from '@nova/ui';
import { CalendarDays, User, Users } from 'lucide-react';
import Link from 'next/link';
import { VerifiedBadge } from '@/features/profile/VerifiedBadge';
import { getT } from '@/shared/i18n/core';
import { formatDateTime } from '@/shared/lib/datetime';
import { messages } from './messages';
import { GameIcon } from '@/shared/brand/GameIcon';

/** "36 vagas livres", "Última vaga", "Vagas esgotadas". */
export function slotsText(taken: number, max: number): string {
  const t = getT(messages, 'TournamentCard');
  const left = Math.max(0, max - taken);
  if (left === 0) return t('vagasEsgotadas');
  if (left === 1) return t('ultimaVaga');
  return t('vagasLivres', { n: left });
}

export interface TournamentCardProps {
  tournament: TournamentSummary;
  /** Nível do título do card, conforme a seção onde ele está. */
  headingLevel?: 'h2' | 'h3';
  className?: string;
}

/** Card de campeonato das vitrines e da lista. O card inteiro é um link para a página do campeonato. */
export function TournamentCard({ tournament, headingLevel: Heading = 'h3', className }: TournamentCardProps) {
  const t = getT(messages, 'TournamentCard');
  const solo = tournament.participantType === 'SOLO';
  const ModeIcon = solo ? User : Users;
  return (
    <Link
      href={`/c/${tournament.slug}`}
      className={cn(
        'group flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:shadow-md',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GameIcon icon={tournament.gameIcon} coverUrl={tournament.gameCoverUrl} className="size-10 rounded-md text-xl" px={40} />
        <div className="min-w-0 text-sm">
          <p className="truncate font-semibold text-text">{tournament.gameName}</p>
          <p className="flex items-center gap-1 text-muted">
            <ModeIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {solo ? t('solo') : t('equipe')}
              {tournament.modeName && ` · ${tournament.modeName}`}
            </span>
          </p>
        </div>
      </div>

      <div className="flex flex-col items-start gap-2">
        <StatusPill status={tournament.status} />
        <Heading className="text-lg break-words text-text group-hover:text-primary-text">{tournament.name}</Heading>
      </div>

      <p className="flex items-start gap-1.5 text-sm text-muted">
        <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{tournament.startsAt ? t('comeca', { data: formatDateTime(tournament.startsAt) }) : t('inicioADefinir')}</span>
      </p>

      <div className="mt-auto flex flex-col gap-1">
        <Progress value={tournament.takenSlots} max={tournament.maxParticipants} label={t('vagasPreenchidas', { nome: tournament.name })} />
        <p className="text-xs text-muted">{slotsText(tournament.takenSlots, tournament.maxParticipants)}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-3 text-sm">
        <span className="flex min-w-0 items-center gap-1.5 text-muted">
          <span className="truncate">{t('organizador', { nickname: tournament.organizerNickname })}</span>
          {tournament.organizerVerified && <VerifiedBadge compact />}
        </span>
        {tournament.free && <Badge tone="gold">{t('gratuito')}</Badge>}
      </div>
    </Link>
  );
}

/** Esqueleto no formato do card, para as vitrines enquanto a lista carrega. */
export function TournamentCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="size-10" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-5 w-32 rounded-full" />
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}

/** Grade das vitrines: 1 coluna no celular, 2 no tablet, 3 ou 4 no desktop. */
export function TournamentGrid({ children, wide = false, label }: { children: React.ReactNode; wide?: boolean; label?: string }) {
  return (
    <ul aria-label={label} className={cn('grid grid-cols-1 gap-4 md:grid-cols-2', wide ? 'lg:grid-cols-3 xl:grid-cols-4' : 'xl:grid-cols-3')}>
      {children}
    </ul>
  );
}
