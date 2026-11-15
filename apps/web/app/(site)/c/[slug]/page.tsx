/**
 * Página pública do campeonato (issue #77). Renderizada no servidor com os dados em cache (ISR): a API avisa
 * quando o campeonato muda e a próxima visita já vem atualizada. A tela em si continua sendo o componente do
 * navegador (abas, inscrição, tempo real), que recebe os dados prontos e não precisa buscar de novo.
 *
 * Com a API simulada (protótipo), não há dados no servidor: a página carrega no navegador, como antes.
 */
import { Skeleton } from '@nova/ui';
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TournamentPage } from '@/features/tournaments/TournamentPage';
import { keys } from '@/shared/api/keys';
import { getPublicTournament } from '@/shared/server/public-data';
import { jsonLdScript, tournamentDescription, tournamentJsonLd } from '@/shared/server/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const canonical = `/c/${slug}`;
  const t = await getPublicTournament(slug).catch(() => null);
  if (!t) return { title: 'Campeonato', alternates: { canonical } };
  const description = tournamentDescription(t);
  return {
    title: t.name,
    description,
    alternates: { canonical },
    // A imagem vem de `opengraph-image.tsx` nesta mesma pasta.
    openGraph: { type: 'website', url: canonical, title: t.name, description, siteName: 'Nova Arena', locale: 'pt_BR' },
    twitter: { card: 'summary_large_image', title: t.name, description },
  };
}

function Fallback() {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-6 md:px-6 md:py-8" role="status" aria-label="Carregando campeonato">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default async function TournamentRoute({ params }: Props) {
  const { slug } = await params;
  const t = await getPublicTournament(slug).catch(() => null);
  const client = new QueryClient();
  if (t) client.setQueryData(keys.tournaments.detail(slug), t);
  return (
    <>
      {t && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(tournamentJsonLd(t)) }} />}
      <HydrationBoundary state={dehydrate(client)}>
        {/* A aba ativa fica em `?aba=`: `useSearchParams` exige um limite de Suspense (Next.js 16). */}
        <Suspense fallback={<Fallback />}>
          <TournamentPage slug={slug} />
        </Suspense>
      </HydrationBoundary>
    </>
  );
}
