'use client';

import { useToast } from '@nova/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCreateGame } from '@/shared/api/hooks/games-admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { GameForm } from './GameForm';
import { emptyGame } from './game-values';

const backLink = 'inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-semibold text-primary-text hover:underline md:min-h-0';

/** `/admin/jogos/novo`: cadastro de um jogo. Os modelos de pontuação entram na página do jogo, logo depois. */
export function GameCreatePage() {
  const router = useRouter();
  const toast = useToast();
  const create = useCreateGame();

  return (
    <PageContainer>
      <Link href="/admin/jogos" className={backLink}>
        <ArrowLeft className="size-4" aria-hidden />
        Jogos e regras
      </Link>
      <PageHeader title="Novo jogo" description="Cadastre o jogo e seus modos. Depois de salvar, você cria os modelos de pontuação." />
      <GameForm
        mode="create"
        defaultValues={emptyGame()}
        cancelHref="/admin/jogos"
        onSubmit={async (input) => {
          const game = await create.mutateAsync(input);
          toast.success('Jogo cadastrado', 'Agora crie um modelo de pontuação para ele.');
          router.push(`/admin/jogos/${game.id}`);
          return game;
        }}
      />
    </PageContainer>
  );
}
