'use client';

/** `/ligas/[slug]`: página pública da liga — regra, campeonatos e a tabela da temporada da liga (issue #120). */
import type { LeagueDetail, LeagueStandingRow } from '@nova/schemas';
import { Avatar, Badge, Card, DataTable, EmptyState, ErrorState, Skeleton, StatusPill, type Column, type Status } from '@nova/ui';
import { CalendarRange, CheckCircle2, Clock, Trophy, UserRound } from 'lucide-react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useLeague } from '@/shared/api/hooks/seasons';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { LEAGUE_STATUS, periodText, placementText, ruleSummary } from './leagueText';
import { messages } from './messages';

export function leagueTableColumns(detail: LeagueDetail): Column<LeagueStandingRow>[] {
  const counted = detail.league.tournaments.filter((item) => item.counted).length;
  const t = getT(messages, 'LeaguePage.colunas');
  return [
    { id: 'position', header: t('posicao'), cell: (r) => <span className="tabular">{placementText(r.position)}</span>, className: 'w-20' },
    {
      id: 'name',
      header: t('participante'),
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
    { id: 'points', header: t('pontos'), align: 'right', cell: (r) => <span className="tabular text-base font-bold">{r.points}</span> },
    { id: 'played', header: t('campeonatos'), align: 'right', cell: (r) => <span className="tabular">{t('jogadosDe', { jogados: String(r.played), total: String(counted) })}</span> },
    { id: 'wins', header: t('titulos'), align: 'right', cell: (r) => <span className="tabular">{r.wins}</span> },
    { id: 'best', header: t('melhorColocacao'), align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{placementText(r.bestPlacement)}</span> },
  ];
}

function LeagueSkeleton() {
  const t = useT(messages, 'LeaguePage');
  return (
    <PageContainer>
      <div role="status" aria-label={t('carregando')} className="flex flex-col gap-4">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    </PageContainer>
  );
}

export function LeaguePage({ slug }: { slug: string }) {
  const q = useLeague(slug);
  const t = useT(messages, 'LeaguePage');
  if (q.isPending) return <LeagueSkeleton />;
  if (q.isError) {
    return (
      <PageContainer>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={<Trophy className="size-7" />} title={t('naoEncontradaTitulo')} description={t('naoEncontradaDescricao')} />
        ) : (
          <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const { league, table } = q.data;
  const status = LEAGUE_STATUS[league.status];
  const organizer = t.rich('organizacao', {
    nome: league.owner.nickname,
    link: (chunks) => (
      <Link href={`/u/${encodeURIComponent(league.owner.nickname)}`} className="font-semibold text-text underline-offset-2 hover:underline">
        {chunks}
      </Link>
    ),
  });
  const scoringText = t.rich('comoFuncionaTexto', { regra: ruleSummary(league.rule, 10), destaque: (chunks) => <span className="font-semibold text-text">{chunks}</span> });

  return (
    <PageContainer>
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-sm text-muted">
          <span aria-hidden className="text-lg leading-none">
            {league.game.icon}
          </span>
          {t('ligaSemanalDe', { jogo: league.game.name })}
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
            {organizer}
          </span>
        </div>
        {league.description && <p className="max-w-3xl whitespace-pre-line text-sm text-text">{league.description}</p>}
      </header>

      <Card className="flex flex-col gap-1">
        <h2 className="text-base">{t('comoFunciona')}</h2>
        <p className="text-sm text-muted">
          {scoringText}
        </p>
      </Card>

      <section aria-labelledby="liga-tabela" className="flex flex-col gap-3">
        <h2 id="liga-tabela" className="text-lg">
          {t('tabela')}
        </h2>
        <DataTable
          caption={t('tabelaLegenda', { nome: league.name })}
          columns={leagueTableColumns(q.data)}
          rows={table}
          getRowId={(r) => r.key}
          empty={<EmptyState icon={<Trophy className="size-7" />} title={t('tabelaVaziaTitulo')} description={t('tabelaVaziaDescricao')} />}
        />
      </section>

      <section aria-labelledby="liga-campeonatos" className="flex flex-col gap-3">
        <h2 id="liga-campeonatos" className="text-lg">
          {t('campeonatos')}
        </h2>
        {league.tournaments.length === 0 ? (
          <EmptyState icon={<CalendarRange className="size-7" />} title={t('campeonatosVazioTitulo')} description={t('campeonatosVazioDescricao')} />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {league.tournaments.map((tournament) => (
              <li key={tournament.id}>
                <Card className="flex h-full flex-col gap-2">
                  <Link href={`/c/${tournament.slug}`} className="font-semibold text-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {tournament.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <StatusPill status={tournament.status as Status} />
                    {tournament.startsAt && <span>{formatDate(tournament.startsAt)}</span>}
                    <span>{tournament.counted ? t('jaContaPontos') : t('contaQuandoTerminar')}</span>
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
