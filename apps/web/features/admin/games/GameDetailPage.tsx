'use client';

import { Button, EmptyState, ErrorState, Skeleton, StatusPill, useToast } from '@nova/ui';
import { ArrowLeft, Gamepad2 } from 'lucide-react';
import Link from 'next/link';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGame } from '@/shared/api/hooks/games';
import { useUpdateGame } from '@/shared/api/hooks/games-admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { GameForm } from './GameForm';
import { gameToForm } from './game-values';
import { ScoringModelsSection } from './ScoringModelsSection';

const backLink = 'inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-semibold text-primary-text hover:underline md:min-h-0';

/** `/admin/jogos/[id]`: modelos de pontuação e dados de um jogo do catálogo. */
export function GameDetailPage({ gameId }: { gameId: string }) {
  const toast = useToast();
  const query = useGame(gameId);
  const update = useUpdateGame();
  const game = query.data;

  const back = (
    <Link href="/admin/jogos" className={backLink}>
      <ArrowLeft className="size-4" aria-hidden />
      Jogos e regras
    </Link>
  );

  if (query.isPending) {
    return (
      <PageContainer>
        {back}
        <div className="flex flex-col gap-6" role="status" aria-label="Carregando o jogo">
          <Skeleton className="h-9 w-64" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-56 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
          <Skeleton className="h-72 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError || !game) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <PageContainer>
        {back}
        {missing ? (
          <>
            <h1 className="sr-only">Jogo não encontrado</h1>
            <EmptyState
              icon={<Gamepad2 className="size-7" />}
              title="Jogo não encontrado"
              description="Este jogo não está no catálogo. Ele pode ter sido cadastrado em outro navegador."
              action={
                <Button asChild>
                  <Link href="/admin/jogos">Ver o catálogo</Link>
                </Button>
              }
            />
          </>
        ) : (
          <>
            <h1 className="sr-only">Jogo</h1>
            <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
          </>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {back}
      <PageHeader
        title={`${game.icon} ${game.name}`}
        description={`${game.platform} · /jogos/${game.slug}`}
        actions={game.active ? <StatusPill status="ACTIVE" /> : <StatusPill status="PAUSED" label="Inativo" />}
      />
      <ScoringModelsSection game={game} />
      <GameForm
        // Remonta se o jogo mudar de identidade; depois de salvar, o próprio formulário se atualiza com a resposta.
        key={game.id}
        mode="edit"
        defaultValues={gameToForm(game)}
        cancelHref="/admin/jogos"
        onSubmit={async (input) => {
          const saved = await update.mutateAsync({ gameId: game.id, patch: input });
          toast.success('Jogo salvo', saved.name);
          return saved;
        }}
      />
    </PageContainer>
  );
}
