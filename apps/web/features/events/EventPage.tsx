'use client';

/** `/e/[slug]`: página pública do evento — a regra de participação em palavras simples e os campeonatos (ADR-0005). */
import { EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { CalendarHeart } from 'lucide-react';
import Link from 'next/link';
import { TournamentCard } from '@/features/tournaments/TournamentCard';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useEvent } from '@/shared/api/hooks/events';
import { useT } from '@/shared/i18n/react';
import { PageContainer } from '@/shared/layout/AreaShell';
import { EventRuleNote } from './EventRule';
import { messages } from './messages';

export function EventPage({ slug }: { slug: string }) {
  const q = useEvent(slug);
  const t = useT(messages, 'EventPage');
  if (q.isPending) {
    return (
      <PageContainer>
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-4">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </PageContainer>
    );
  }
  if (q.isError) {
    return (
      <PageContainer>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={<CalendarHeart className="size-7" />} title={t('naoEncontradoTitulo')} description={t('naoEncontradoDescricao')} />
        ) : (
          <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const event = q.data;
  const organizer = t.rich('organizacao', {
    nome: event.owner.nickname,
    link: (chunks) => (
      <Link href={`/u/${encodeURIComponent(event.owner.nickname)}`} className="font-semibold text-text underline-offset-2 hover:underline">
        {chunks}
      </Link>
    ),
  });
  return (
    <PageContainer>
      <header className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-accent">
          <CalendarHeart className="size-4" aria-hidden />
          {t('evento')}
        </p>
        <h1 className="text-2xl [overflow-wrap:anywhere] md:text-3xl">{event.name}</h1>
        {event.description && <p className="max-w-prose text-muted [overflow-wrap:anywhere] whitespace-pre-line">{event.description}</p>}
        <p className="text-sm text-muted">{organizer}</p>
        <EventRuleNote rule={event.participationRule} className="rounded-md border border-border bg-surface px-3 py-2" />
      </header>
      <section aria-labelledby="evento-campeonatos" className="flex flex-col gap-3">
        <h2 id="evento-campeonatos" className="text-lg">
          {t('campeonatos')}
        </h2>
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {event.tournaments.map((tournament) => (
            <li key={tournament.id}>
              <TournamentCard tournament={tournament} />
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
