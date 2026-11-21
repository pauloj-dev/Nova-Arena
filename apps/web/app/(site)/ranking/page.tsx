'use client';

import { Skeleton } from '@nova/ui';
import { Suspense } from 'react';
import { appMessages } from '@/app/messages';
import { RankingPage } from '@/features/games/RankingPage';
import { FlagGate } from '@/shared/flags/FlagGate';
import { useT } from '@/shared/i18n/react';

function Fallback() {
  const t = useT(appMessages, 'paginas.ranking');
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8" role="status" aria-label={t('carregando')}>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function RankingRoute() {
  // O jogo escolhido fica em `?jogo=`: `useSearchParams` exige um limite de Suspense (Next.js 16).
  return (
    <FlagGate flag="ranking">
      <Suspense fallback={<Fallback />}>
        <RankingPage />
      </Suspense>
    </FlagGate>
  );
}
