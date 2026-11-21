'use client';

/** `/ligas`: ligas semanais de todos os jogos (issue #120). */
import type { League } from '@nova/schemas';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { CalendarRange, Trophy } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useLeagues } from '@/shared/api/hooks/seasons';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { LEAGUE_STATUS, periodText } from './leagueText';

export function LeagueCard({ league, href }: { league: League; href: string }) {
  const status = LEAGUE_STATUS[league.status];
  const counted = league.tournaments.filter((t) => t.counted).length;
  return (
    <Card interactive className="flex h-full flex-col gap-2">
      <p className="flex items-center gap-2 text-sm text-muted">
        <span aria-hidden className="text-lg leading-none">
          {league.game.icon}
        </span>
        {league.game.name}
        <Badge tone={status.tone} className="ml-auto">
          {status.label}
        </Badge>
      </p>
      <h2 className="text-base">
        <Link href={href} className="text-text underline-offset-2 [overflow-wrap:anywhere] after:absolute after:inset-0 hover:underline">
          {league.name}
        </Link>
      </h2>
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <CalendarRange className="size-4" aria-hidden />
        {periodText(league.startsAt, league.endsAt)}
      </p>
      <p className="text-sm text-muted">
        {league.tournaments.length} {league.tournaments.length === 1 ? 'campeonato' : 'campeonatos'} · {counted} {counted === 1 ? 'encerrado' : 'encerrados'} · por {league.owner.nickname}
      </p>
    </Card>
  );
}

export function LeaguesPage() {
  const q = useLeagues();
  return (
    <PageContainer>
      <PageHeader title="Ligas semanais" description="Campeonatos toda semana que somam pontos numa tabela da temporada." />
      {q.isPending ? (
        <div role="status" aria-label="Carregando as ligas" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState title="Não foi possível carregar as ligas" description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title="Nenhuma liga por enquanto" description="Quando uma organização criar uma liga semanal, ela aparece aqui." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {q.data.map((league) => (
            <li key={league.id} className="relative">
              <LeagueCard league={league} href={`/ligas/${league.slug}`} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
