'use client';

import { Card, EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { ChevronRight, Gamepad2 } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { PageContainer } from '@/shared/layout/AreaShell';

/** `/jogos`: grade dos jogos ativos do catálogo. */
export function GamesPage() {
  const games = useGames();
  return (
    <PageContainer>
      <div>
        <h1 className="text-xl md:text-2xl">Jogos</h1>
        <p className="mt-1 text-sm text-muted">Veja os modos, como a pontuação funciona e os campeonatos abertos de cada jogo.</p>
      </div>

      {games.isPending ? (
        <ul className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-4" role="status" aria-label="Carregando jogos">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-40 w-full" />
            </li>
          ))}
        </ul>
      ) : games.isError ? (
        <ErrorState title="Não foi possível carregar os jogos" description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      ) : games.data.length === 0 ? (
        <EmptyState
          icon={<Gamepad2 className="size-7" />}
          title="Nenhum jogo disponível no momento"
          description="O catálogo está sendo atualizado. Enquanto isso, veja os campeonatos."
          action={
            <Link href="/campeonatos" className="font-semibold text-primary-text underline underline-offset-2">
              Ver campeonatos
            </Link>
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-4" aria-label="Jogos">
          {games.data.map((g) => (
            <li key={g.id}>
              <Link href={`/jogos/${g.slug}`} className="group block h-full rounded-lg">
                <Card interactive className="flex h-full flex-col gap-3">
                  <span className="flex size-14 items-center justify-center rounded-lg bg-accent-soft text-3xl" aria-hidden>
                    {g.icon}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg group-hover:text-primary-text">{g.name}</h2>
                    <p className="text-sm text-muted">{g.platform}</p>
                  </div>
                  <p className="text-sm text-muted">{g.modes.map((m) => m.name).join(' · ')}</p>
                  <span className="mt-auto flex items-center gap-1 text-sm font-semibold text-primary-text">
                    Ver jogo
                    <ChevronRight className="size-4" aria-hidden />
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
