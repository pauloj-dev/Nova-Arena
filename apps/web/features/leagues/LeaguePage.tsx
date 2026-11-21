'use client';

/** `/ligas/[slug]`: página pública da liga — regra, campeonatos e a tabela da temporada da liga (issue #120). */
import type { LeagueDetail, LeagueStandingRow } from '@nova/schemas';
import { Avatar, Badge, Card, DataTable, EmptyState, ErrorState, Skeleton, StatusPill, type Column, type Status } from '@nova/ui';
import { CalendarRange, CheckCircle2, Clock, Trophy, UserRound } from 'lucide-react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useLeague } from '@/shared/api/hooks/seasons';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { LEAGUE_STATUS, periodText, ruleSummary } from './leagueText';

export function leagueTableColumns(detail: LeagueDetail): Column<LeagueStandingRow>[] {
  const counted = detail.league.tournaments.filter((t) => t.counted).length;
  return [
    { id: 'position', header: 'Posição', cell: (r) => <span className="tabular">{r.position}º</span>, className: 'w-20' },
    {
      id: 'name',
      header: 'Participante',
      primary: true,
      cell: (r) => {
        const content = (
          <>
            <Avatar name={r.name} src={r.avatarUrl} size="sm" />
            <span className="truncate">{r.name}</span>
          </>
        );
        return r.href ? (
          <Link href={r.href} className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold underline-offset-2 hover:underline md:min-h-0">
            {content}
          </Link>
        ) : (
          <span className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold md:min-h-0">{content}</span>
        );
      },
    },
    { id: 'points', header: 'Pontos', align: 'right', cell: (r) => <span className="tabular text-base font-bold">{r.points}</span> },
    { id: 'played', header: 'Campeonatos', align: 'right', cell: (r) => <span className="tabular">{`${r.played} de ${counted}`}</span> },
    { id: 'wins', header: 'Títulos', align: 'right', cell: (r) => <span className="tabular">{r.wins}</span> },
    { id: 'best', header: 'Melhor colocação', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.bestPlacement}º</span> },
  ];
}

function LeagueSkeleton() {
  return (
    <PageContainer>
      <div role="status" aria-label="Carregando a liga" className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  );
}

export function LeaguePage({ slug }: { slug: string }) {
  const q = useLeague(slug);
  if (q.isPending) return <LeagueSkeleton />;
  if (q.isError) {
    return (
      <PageContainer>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={<Trophy className="size-7" />} title="Liga não encontrada" description="O endereço pode estar errado ou a liga foi encerrada pela organização." />
        ) : (
          <ErrorState title="Não foi possível carregar a liga" description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const { league, table } = q.data;
  const status = LEAGUE_STATUS[league.status];

  return (
    <PageContainer>
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="text-lg leading-none">
            {league.game.icon}
          </span>
          Liga semanal de {league.game.name}
        </p>
        <h1 className="text-2xl [overflow-wrap:anywhere] md:text-3xl">{league.name}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
          <Badge tone={status.tone} icon={league.status === 'ENDED' ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Clock className="size-3.5" aria-hidden />}>
            {status.label}
          </Badge>
          <span className="inline-flex items-center gap-1.5">
            <CalendarRange className="size-4" aria-hidden />
            {periodText(league.startsAt, league.endsAt)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="size-4" aria-hidden />
            Organização:{' '}
            <Link href={`/u/${encodeURIComponent(league.owner.nickname)}`} className="font-semibold text-text underline-offset-2 hover:underline">
              {league.owner.nickname}
            </Link>
          </span>
        </div>
        {league.description && <p className="max-w-3xl whitespace-pre-line text-sm text-text">{league.description}</p>}
      </header>

      <Card className="flex flex-col gap-1">
        <h2 className="text-base">Como a pontuação funciona</h2>
        <p className="text-sm text-muted">
          Cada campeonato encerrado da liga dá pontos pela colocação final: <span className="font-semibold text-text">{ruleSummary(league.rule, 10)}</span>. Os pontos somam na tabela da temporada da liga.
        </p>
      </Card>

      <section aria-labelledby="liga-tabela" className="flex flex-col gap-3">
        <h2 id="liga-tabela" className="text-lg">
          Tabela da liga
        </h2>
        <DataTable
          caption={`Tabela da ${league.name}`}
          columns={leagueTableColumns(q.data)}
          rows={table}
          getRowId={(r) => r.key}
          empty={<EmptyState icon={<Trophy className="size-7" />} title="A tabela ainda está vazia" description="Os pontos entram quando o primeiro campeonato da liga for encerrado." />}
        />
      </section>

      <section aria-labelledby="liga-campeonatos" className="flex flex-col gap-3">
        <h2 id="liga-campeonatos" className="text-lg">
          Campeonatos da liga
        </h2>
        {league.tournaments.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-7" />} title="Nenhum campeonato na liga ainda" description="A organização inclui aqui os campeonatos de cada semana." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {league.tournaments.map((t) => (
              <li key={t.id}>
                <Card className="flex h-full flex-col gap-2">
                  <Link href={`/c/${t.slug}`} className="font-semibold text-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {t.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <StatusPill status={t.status as Status} />
                    {t.startsAt && <span>{formatDate(t.startsAt)}</span>}
                    <span>{t.counted ? 'Já conta pontos' : 'Conta pontos quando terminar'}</span>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
