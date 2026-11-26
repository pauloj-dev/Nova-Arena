'use client';

import type { GameRanking, GameRankingEntry } from '@nova/schemas';
import { Avatar, Button, cn, DataTable, EmptyState, Skeleton, type Column } from '@nova/ui';
import { Info, Medal, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SeasonRankingSection } from '@/features/seasons/SeasonRankingSection';
import { listHref } from '@/features/tournaments/filters';
import { useGameRanking, useGames } from '@/shared/api/hooks/games';
import { getFormat, getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer } from '@/shared/layout/AreaShell';
import { messages } from './messages';

/** Número que ainda não é contado: traço na tela e explicação para leitor de tela. */
function Pending() {
  const t = useT(messages, 'Pending');
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">{t('naoContabilizado')}</span>
    </>
  );
}

function count(value: number | null) {
  return value === null ? <Pending /> : <span className="tabular">{getFormat().number(value)}</span>;
}

/** Colunas do ranking. A estatística de destaque muda com o jogo: kills no Battle Royale, placar nos duelos. */
export function rankingColumns(highlight: GameRanking['highlight']): Column<GameRankingEntry>[] {
  const t = getT(messages, 'rankingColumns');
  return [
  { id: 'position', header: t('posicao'), cell: (r) => <span className="tabular">{t('posicaoValor', { posicao: String(r.position) })}</span>, className: 'w-20' },
  {
    id: 'player',
    header: t('jogador'),
    primary: true,
    cell: (r) => (
      <Link href={`/u/${encodeURIComponent(r.nickname)}`} className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold underline-offset-2 hover:underline md:min-h-0">
        <Avatar name={r.nickname} src={r.avatarUrl} size="sm" />
        <span className="truncate">{r.nickname}</span>
      </Link>
    ),
  },
  { id: 'titles', header: t('titulos'), align: 'right', cell: (r) => count(r.titles) },
  { id: 'wins', header: t('vitorias'), align: 'right', cell: (r) => count(r.wins) },
  highlight === 'KILLS'
    ? { id: 'kills', header: t('kills'), align: 'right', cell: (r) => count(r.kills) }
    : { id: 'score', header: t('placarAFavor'), align: 'right', cell: (r) => count(r.score) },
  { id: 'matches', header: t('partidas'), align: 'right', cell: (r) => count(r.matches) },
  { id: 'played', header: t('campeonatos'), align: 'right', cell: (r) => <span className="tabular">{r.tournamentsPlayed}</span> },
  ];
}

const chip = 'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text transition-colors hover:border-accent';

/** `/ranking`: ranking por jogo com os dados que já existem (ADR-0001), sem ELO. O jogo escolhido fica em `?jogo=`. */
export function RankingPage() {
  const games = useGames();
  const requested = useSearchParams().get('jogo');
  const selected = games.data?.find((g) => g.slug === requested) ?? games.data?.[0];
  const ranking = useGameRanking(selected?.slug);
  const t = useT(messages, 'RankingPage');

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl md:text-2xl">{t('titulo')}</h1>
        <p className="mt-1 text-sm text-muted">{t('descricao')}</p>
      </div>

      {games.isPending ? (
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-4">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-32 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : games.isError ? (
        <EmptyState
          icon={<Medal className="size-7" />}
          title={t('erroJogos')}
          description={t('erroJogosDescricao')}
          action={
            <Button variant="secondary" onClick={() => void games.refetch()}>
              {t('tentarNovamente')}
            </Button>
          }
        />
      ) : !selected ? (
        <EmptyState icon={<Medal className="size-7" />} title={t('semJogosTitulo')} description={t('semJogosDescricao')} />
      ) : (
        <>
          <nav aria-label={t('escolherJogo')}>
            <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {games.data.map((g) => {
                const active = g.id === selected.id;
                return (
                  <li key={g.id}>
                    <Link href={`/ranking?jogo=${g.slug}`} scroll={false} aria-current={active ? 'page' : undefined} className={cn(chip, active && 'border-accent bg-accent-soft text-accent-soft-text')}>
                      <span aria-hidden>{g.icon}</span>
                      {g.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <SeasonRankingSection key={selected.slug} game={selected} />

          <p className="flex items-center gap-2 text-sm">
            <Trophy className="size-4 text-accent" aria-hidden />
            <Link href="/ligas" className="font-semibold text-accent underline-offset-2 hover:underline">
              {t('verLigas')}
            </Link>
            <span className="text-muted">{t('ligasDescricao')}</span>
          </p>

          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {ranking.data?.resultsAvailable === false
                ? t('semResultados')
                : t('ordem', { destaque: ranking.data?.highlight === 'KILLS' ? 'KILLS' : 'SCORE' })}
            </span>
          </p>

          <section aria-labelledby="ranking-jogo" className="flex flex-col gap-3">
            <h2 id="ranking-jogo" className="text-lg">
              {t('rankingDe', { jogo: selected.name })}
            </h2>
            {ranking.isError ? (
              <EmptyState
                icon={<Medal className="size-7" />}
                title={t('erroRanking')}
                description={t('erroRankingDescricao')}
                action={
                  <Button variant="secondary" onClick={() => void ranking.refetch()}>
                    {t('tentarNovamente')}
                  </Button>
                }
              />
            ) : (
              <DataTable
                caption={t('rankingDe', { jogo: selected.name })}
                columns={rankingColumns(ranking.data?.highlight ?? 'SCORE')}
                rows={ranking.data?.entries ?? []}
                getRowId={(r) => r.userId}
                loading={ranking.isPending}
                empty={
                  <EmptyState
                    icon={<Medal className="size-7" />}
                    title={t('vazioTitulo', { jogo: selected.name })}
                    description={t('vazioDescricao')}
                    action={
                      <Button asChild>
                        <Link href={listHref({ game: selected.slug })}>{t('verCampeonatosDe', { jogo: selected.name })}</Link>
                      </Button>
                    }
                  />
                }
              />
            )}
          </section>
        </>
      )}
    </PageContainer>
  );
}
