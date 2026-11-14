'use client';

import type { GameRanking, GameRankingEntry } from '@nova/schemas';
import { Avatar, Button, cn, DataTable, EmptyState, ErrorState, Skeleton, type Column } from '@nova/ui';
import { Info, Medal } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { listHref } from '@/features/tournaments/filters';
import { errorMessage } from '@/shared/api/client';
import { useGameRanking, useGames } from '@/shared/api/hooks/games';
import { PageContainer } from '@/shared/layout/AreaShell';

/** Número que ainda não é contado: traço na tela e explicação para leitor de tela. */
function Pending() {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">ainda não contabilizado</span>
    </>
  );
}

function count(value: number | null) {
  return value === null ? <Pending /> : <span className="tabular">{value.toLocaleString('pt-BR')}</span>;
}

/** Colunas do ranking. A estatística de destaque muda com o jogo: kills no Battle Royale, placar nos duelos. */
export function rankingColumns(highlight: GameRanking['highlight']): Column<GameRankingEntry>[] {
  return [
  { id: 'position', header: 'Posição', cell: (r) => <span className="tabular">{r.position}º</span>, className: 'w-20' },
  {
    id: 'player',
    header: 'Jogador',
    primary: true,
    cell: (r) => (
      <Link href={`/u/${encodeURIComponent(r.nickname)}`} className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold underline-offset-2 hover:underline md:min-h-0">
        <Avatar name={r.nickname} src={r.avatarUrl} size="sm" />
        <span className="truncate">{r.nickname}</span>
      </Link>
    ),
  },
  { id: 'titles', header: 'Títulos', align: 'right', cell: (r) => count(r.titles) },
  { id: 'wins', header: 'Vitórias', align: 'right', cell: (r) => count(r.wins) },
  highlight === 'KILLS'
    ? { id: 'kills', header: 'Kills', align: 'right', cell: (r) => count(r.kills) }
    : { id: 'score', header: 'Placar a favor', align: 'right', cell: (r) => count(r.score) },
  { id: 'matches', header: 'Partidas', align: 'right', cell: (r) => count(r.matches) },
  { id: 'played', header: 'Campeonatos', align: 'right', cell: (r) => <span className="tabular">{r.tournamentsPlayed}</span> },
  ];
}

const chip = 'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text transition-colors hover:border-accent';

/** `/ranking`: ranking por jogo com os dados que já existem (ADR-0001), sem ELO. O jogo escolhido fica em `?jogo=`. */
export function RankingPage() {
  const games = useGames();
  const requested = useSearchParams().get('jogo');
  const selected = games.data?.find((g) => g.slug === requested) ?? games.data?.[0];
  const ranking = useGameRanking(selected?.slug);

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl md:text-2xl">Ranking</h1>
        <p className="mt-1 text-sm text-muted">Quem mais vence campeonatos e partidas em cada jogo.</p>
      </div>

      {games.isPending ? (
        <div role="status" aria-label="Carregando ranking" className="flex flex-col gap-4">
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-32 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
        </div>
      ) : games.isError ? (
        <ErrorState title="Não foi possível carregar os jogos" description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      ) : !selected ? (
        <EmptyState icon={<Medal className="size-7" />} title="Nenhum jogo disponível no momento" description="O ranking aparece quando houver jogos no catálogo." />
      ) : (
        <>
          <nav aria-label="Escolher o jogo do ranking">
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

          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {ranking.data?.resultsAvailable === false
                ? 'Por enquanto o ranking conta campeonatos disputados e finalizados. Títulos, vitórias e kills passam a contar quando os resultados das partidas entrarem.'
                : `A ordem é por títulos, depois vitórias, depois ${ranking.data?.highlight === 'KILLS' ? 'kills' : 'placar a favor'} e, por fim, campeonatos disputados. Só contam resultados validados.`}
            </span>
          </p>

          <section aria-labelledby="ranking-jogo" className="flex flex-col gap-3">
            <h2 id="ranking-jogo" className="text-lg">
              Ranking de {selected.name}
            </h2>
            {ranking.isError ? (
              <ErrorState title="Não foi possível carregar o ranking" description={errorMessage(ranking.error)} onRetry={() => void ranking.refetch()} />
            ) : (
              <DataTable
                caption={`Ranking de ${selected.name}`}
                columns={rankingColumns(ranking.data?.highlight ?? 'SCORE')}
                rows={ranking.data?.entries ?? []}
                getRowId={(r) => r.userId}
                loading={ranking.isPending}
                empty={
                  <EmptyState
                    icon={<Medal className="size-7" />}
                    title={`Ninguém no ranking de ${selected.name} ainda`}
                    description="O ranking começa quando o primeiro campeonato deste jogo entrar em andamento. Inscreva-se em um para aparecer aqui."
                    action={
                      <Button asChild>
                        <Link href={listHref({ game: selected.slug })}>Ver campeonatos de {selected.name}</Link>
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
