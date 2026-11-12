'use client';

import { Badge, Button, ErrorState, Skeleton, StatusPill, Tabs } from '@nova/ui';
import { ExternalLink, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useOrganizerTournament } from '@/shared/api/hooks/organizer';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { NoAccess, TournamentNotFound } from '../components/NoAccess';
import { PublicPageTab } from './PublicPageTab';
import { RegistrationsTab } from './RegistrationsTab';
import { SummaryTab } from './SummaryTab';

const TABS = ['resumo', 'inscricoes', 'pagina'] as const;
type TabId = (typeof TABS)[number];
const isTab = (value: string | null): value is TabId => TABS.includes(value as TabId);

function ManageInner({ tournamentId }: { tournamentId: string }) {
  const params = useSearchParams();
  const query = useOrganizerTournament(tournamentId);
  const [tab, setTab] = useState<TabId>(() => {
    const initial = params.get('aba');
    return isTab(initial) ? initial : 'resumo';
  });

  if (!query.data) {
    if (query.error instanceof ApiError && query.error.status === 403) return <NoAccess />;
    if (query.error instanceof ApiError && query.error.status === 404) return <TournamentNotFound />;
    return (
      <PageContainer>
        {query.error ? (
          <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : (
          <div className="flex flex-col gap-4" role="status" aria-label="Carregando o campeonato">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-11 w-full max-w-md" />
            <Skeleton className="h-72 w-full" />
          </div>
        )}
      </PageContainer>
    );
  }

  const t = query.data;
  const isModerator = t.access === 'MODERATOR';
  const isDraft = t.status === 'DRAFT';

  function changeTab(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    // A aba fica no endereço (dá para compartilhar o link direto para as inscrições) sem recarregar a tela.
    const url = new URL(window.location.href);
    if (value === 'resumo') url.searchParams.delete('aba');
    else url.searchParams.set('aba', value);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  return (
    <PageContainer>
      <PageHeader
        title={t.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={t.status} />
            <span>
              <span aria-hidden>{t.gameIcon} </span>
              {t.gameName} · {t.modeName}
            </span>
          </span>
        }
        actions={
          !isDraft && (
            <Button asChild variant="secondary">
              <Link href={`/c/${t.slug}`}>
                <ExternalLink className="size-4" aria-hidden />
                Ver página pública
              </Link>
            </Button>
          )
        }
      />
      <Tabs
        label="Seções do campeonato"
        value={tab}
        onValueChange={changeTab}
        items={[
          { value: 'resumo', label: 'Resumo', content: <SummaryTab tournament={t} /> },
          {
            value: 'inscricoes',
            label: (
              <span className="flex items-center gap-2">
                Inscrições
                {t.pendingApprovals > 0 && (
                  <Badge tone="warning" icon={<Hourglass className="size-3" aria-hidden />}>
                    {t.pendingApprovals}
                    <span className="sr-only"> aguardando aprovação</span>
                  </Badge>
                )}
              </span>
            ),
            content: <RegistrationsTab tournament={t} />,
          },
          ...(isModerator ? [] : [{ value: 'pagina', label: 'Página pública', content: <PublicPageTab tournament={t} /> }]),
        ]}
      />
    </PageContainer>
  );
}

/** `/organizador/campeonatos/[id]` — gerenciamento: Resumo, Inscrições e Página pública (issue #24). */
export function ManageTournament({ tournamentId }: { tournamentId: string }) {
  return (
    <Suspense
      fallback={
        <PageContainer>
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-72 w-full" />
        </PageContainer>
      }
    >
      <ManageInner tournamentId={tournamentId} />
    </Suspense>
  );
}
