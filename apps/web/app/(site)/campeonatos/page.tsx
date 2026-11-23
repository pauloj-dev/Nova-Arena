/** Lista pública de campeonatos (filtros na URL). A lista carrega no navegador; os metadados vêm do servidor. */
import { Skeleton } from '@nova/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { appMessages } from '@/app/messages';
import { TournamentListPage } from '@/features/tournaments/TournamentListPage';
import { getT } from '@/shared/i18n/core';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(appMessages, 'paginas.campeonatos');
  return { title: t('titulo'), description: t('descricao'), alternates: { canonical: '/campeonatos' } };
}

// Renderizada a cada visita (#111): com os filtros da URL em mãos, o servidor já manda o cabeçalho e os filtros
// prontos no HTML. Estática, a página inteira esperava o JavaScript (o `useSearchParams` só existe no navegador) e o
// LCP no celular passava de 4 s.
export const dynamic = 'force-dynamic';

function Fallback() {
  const t = getT(appMessages, 'paginas.campeonatos');
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8" role="status" aria-label={t('carregando')}>
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
