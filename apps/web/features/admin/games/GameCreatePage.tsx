'use client';

import { useToast } from '@nova/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCreateGame } from '@/shared/api/hooks/games-admin';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { GameForm } from './GameForm';
import { emptyGame } from './game-values';
import { adminGamesMessages } from './messages';

const backLink = 'inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-semibold text-primary-text hover:underline md:min-h-0';

/** `/admin/jogos/novo`: cadastro de um jogo. Os modelos de pontuação entram na página do jogo, logo depois. */
export function GameCreatePage() {
  const t = useT(adminGamesMessages, 'GameCreatePage');
  const router = useRouter();
  const toast = useToast();
  const create = useCreateGame();

  return (
    <PageContainer>
      <Link href="/admin/jogos" className={backLink}>
        <ArrowLeft className="size-4" aria-hidden />
        {t('voltarJogos')}
      </Link>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <GameForm
        mode="create"
        defaultValues={emptyGame()}
        cancelHref="/admin/jogos"
        onSubmit={async (input) => {
          const game = await create.mutateAsync(input);
          toast.success(t('toastCriado'), t('toastCriadoDetalhe'));
          router.push(`/admin/jogos/${game.id}`);
          return game;
        }}
      />
    </PageContainer>
  );
}
