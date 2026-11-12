'use client';

import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@nova/ui';
import { ArrowRight, Compass, Medal, Trophy } from 'lucide-react';
import Link from 'next/link';
import { listHref } from '@/features/tournaments/filters';
import { FollowButton } from '@/features/tournaments/FollowButton';
import { TournamentCard, TournamentCardSkeleton, TournamentGrid } from '@/features/tournaments/TournamentCard';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useTournaments } from '@/shared/api/hooks/tournaments';
import { PageContainer } from '@/shared/layout/AreaShell';
import { defaultScoringModels, matchTypeText, scoringLines, teamSizeText } from './scoringText';

function NotFound() {
  return (
    <PageContainer narrow>
      <h1 className="sr-only">Jogo não encontrado</h1>
      <EmptyState
        icon={<Compass className="size-7" />}
        title="Jogo não encontrado"
        description="Este jogo não está no catálogo da Nova Arena, ou o link está errado."
        action={
          <Button asChild>
            <Link href="/jogos">Ver todos os jogos</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}

function OpenTournaments({ slug, gameId, name }: { slug: string; gameId: string; name: string }) {
  const open = useTournaments({ game: slug, status: 'open' }, 8);
  return (
    <section className="flex flex-col gap-4" aria-labelledby="campeonatos-abertos">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="campeonatos-abertos" className="text-lg">
          Campeonatos com inscrições abertas
        </h2>
        <Link href={listHref({ game: slug })} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text underline-offset-2 hover:underline">
          Todos os campeonatos de {name}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {open.isPending ? (
        <TournamentGrid>
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i}>
              <TournamentCardSkeleton />
            </li>
          ))}
        </TournamentGrid>
      ) : open.isError ? (
        <ErrorState title="Não foi possível carregar os campeonatos" description={errorMessage(open.error)} onRetry={() => void open.refetch()} />
      ) : open.data.items.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-7" />}
          title={`Nenhum campeonato de ${name} com inscrições abertas`}
          description="Siga o jogo e a gente avisa quando um campeonato novo abrir inscrições."
          action={<FollowButton type="game" id={gameId} name={name} />}
        />
      ) : (
        <TournamentGrid label={`Campeonatos de ${name} com inscrições abertas`}>
          {open.data.items.map((t) => (
            <li key={t.id}>
              <TournamentCard tournament={t} />
            </li>
          ))}
        </TournamentGrid>
      )}
    </section>
  );
}

/** `/jogos/[game]`: modos, pontuação padrão explicada e campeonatos abertos do jogo. */
export function GamePage({ slug }: { slug: string }) {
  const game = useGame(slug);

  if (game.isPending) {
    return (
      <PageContainer>
        <div role="status" aria-label="Carregando jogo" className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-16" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (game.isError) {
    if (game.error instanceof ApiError && game.error.status === 404) return <NotFound />;
    return (
      <PageContainer narrow>
        <h1 className="sr-only">Jogo</h1>
        <ErrorState title="Não foi possível carregar o jogo" description={errorMessage(game.error)} onRetry={() => void game.refetch()} />
      </PageContainer>
    );
  }

  const g = game.data;
  // Jogo desativado pela administração some da vitrine (o catálogo público só lista os ativos).
  if (!g.active) return <NotFound />;
  const models = defaultScoringModels(g);

  return (
    <PageContainer>
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-4xl" aria-hidden>
            {g.icon}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl break-words md:text-2xl">{g.name}</h1>
            <p className="text-sm text-muted">Plataforma: {g.platform}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FollowButton type="game" id={g.id} name={g.name} />
          <Button asChild variant="secondary">
            <Link href={`/ranking?jogo=${g.slug}`}>
              <Medal className="size-4" aria-hidden />
              Ver ranking
            </Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="modos">
        <h2 id="modos" className="text-lg">
          Modos de jogo
        </h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {g.modes.map((m) => (
            <li key={m.id}>
              <Card padding="sm" className="flex h-full flex-col gap-1 md:p-4">
                <h3 className="text-base">{m.name}</h3>
                <p className="text-sm">{teamSizeText(m)}</p>
                <p className="text-sm text-muted">{matchTypeText(m)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="pontuacao">
        <div>
          <h2 id="pontuacao" className="text-lg">
            Como a pontuação funciona
          </h2>
          <p className="text-sm text-muted">Estes são os modelos padrão do jogo. Cada campeonato diz, na própria página, qual modelo usa em cada fase.</p>
        </div>
        {models.length === 0 ? (
          <p className="text-sm text-muted">Este jogo ainda não tem um modelo de pontuação padrão. A pontuação é definida em cada campeonato.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {models.map((model) => (
              <li key={model.id}>
                <Card padding="sm" className="flex h-full flex-col gap-2 md:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base">{model.name}</h3>
                    <Badge tone="neutral">{matchTypeText({ matchType: model.matchType, maxLobbySize: null, teamSize: 1 })}</Badge>
                  </div>
                  <ul className="list-disc pl-5 text-sm">
                    {scoringLines(model, g).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OpenTournaments slug={g.slug} gameId={g.id} name={g.name} />
    </PageContainer>
  );
}
