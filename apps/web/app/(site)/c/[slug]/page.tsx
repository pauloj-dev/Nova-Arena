'use client';

import { Skeleton } from '@nova/ui';
import { Suspense, use } from 'react';
import { TournamentPage } from '@/features/tournaments/TournamentPage';

function Fallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8" role="status" aria-label="Carregando campeonato">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function TournamentRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  // A aba ativa fica em `?aba=`: `useSearchParams` exige um limite de Suspense (Next.js 16).
  return (
    <Suspense fallback={<Fallback />}>
      <TournamentPage slug={slug} />
    </Suspense>
  );
}
