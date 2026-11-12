'use client';

import { Skeleton } from '@nova/ui';
import { Suspense } from 'react';
import { TournamentListPage } from '@/features/tournaments/TournamentListPage';

function Fallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8" role="status" aria-label="Carregando campeonatos">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function TournamentsPage() {
  // `useSearchParams` exige um limite de Suspense (Next.js 16).
  return (
    <Suspense fallback={<Fallback />}>
      <TournamentListPage />
    </Suspense>
  );
}
