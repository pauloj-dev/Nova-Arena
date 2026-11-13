'use client';

import { Badge, Button, ErrorState, Skeleton, StatusPill, Tabs, type TabItem } from '@nova/ui';
import { ExternalLink, Hourglass } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useOrganizerTournament } from '@/shared/api/hooks/organizer';
import { LiveIndicator } from '@/shared/realtime/LiveIndicator';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { NoAccess, TournamentNotFound } from '../components/NoAccess';
import { permissionsOf } from '../operation/stageUtils';
import { AnnouncementsTab } from './AnnouncementsTab';
import { AuditTab } from './AuditTab';
import { MatchesTab } from './MatchesTab';
import { PublicPageTab } from './PublicPageTab';
import { RegistrationsTab } from './RegistrationsTab';
import { StaffTab } from './StaffTab';
import { StagesTab } from './StagesTab';
import { SummaryTab } from './SummaryTab';
import { ValidationTab } from './ValidationTab';

const TABS = ['resumo', 'inscricoes', 'fases', 'partidas', 'validacao', 'equipe', 'comunicados', 'auditoria', 'pagina'] as const;
type TabId = (typeof TABS)[number];
const isTab = (value: string | null): value is TabId => TABS.includes(value as TabId);

function ManageInner({ tournamentId }: { tournamentId: string }) {
  const params = useSearchParams();
  const query = useOrganizerTournament(tournamentId);
  const games = useGames({ includeInactive: true });
  const [tab, setTab] = useState<TabId>(() => {
    const initial = params.get('aba');
    return isTab(initial) ? initial : 'resumo';
  });
  const [celebrate, setCelebrate] = useState(false);
  // Chave, partidas e tabelas desta tela se atualizam sozinhas com os eventos do campeonato.
  useTournamentChannel(query.data?.id);

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
  const perms = permissionsOf(t.access);
  const isDraft = t.status === 'DRAFT';
  const game = games.data?.find((g) => g.id === t.gameId) ?? null;
  const running = t.status === 'IN_PROGRESS' || t.status === 'PAUSED';

  function changeTab(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    // A aba fica no endereço (dá para compartilhar o link direto para as inscrições) sem recarregar a tela.
    const url = new URL(window.location.href);
    if (value === 'resumo') url.searchParams.delete('aba');
    else url.searchParams.set('aba', value);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  const items: TabItem[] = [
          {
            value: 'resumo',
            label: 'Resumo',
            content: (
              <SummaryTab
                tournament={t}
                celebrate={celebrate}
                onGoToStages={() => changeTab('fases')}
                onFinished={() => setCelebrate(true)}
              />
            ),
          },
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
          ...(isDraft
            ? []
            : [
                {
                  value: 'fases',
                  label: 'Fases e chave',
                  content: (
                    <StagesTab
                      tournament={t}
                      game={game}
                      onGoToMatches={() => changeTab('partidas')}
                      onFinished={() => {
                        setCelebrate(true);
                        changeTab('resumo');
                      }}
                    />
                  ),
                },
                { value: 'partidas', label: 'Partidas e resultados', content: <MatchesTab tournament={t} game={game} onGoToStages={() => changeTab('fases')} /> },
                { value: 'validacao', label: 'Validação', content: <ValidationTab tournamentId={t.id} /> },
              ]),
          // O moderador só vê o que ele opera: agenda, resultados, validação e inscrições (PRD §6).
          ...(perms.canManage && !isDraft
            ? [
                { value: 'equipe', label: 'Equipe', content: <StaffTab tournament={t} /> },
                { value: 'comunicados', label: 'Comunicados', content: <AnnouncementsTab tournament={t} /> },
                { value: 'auditoria', label: 'Auditoria', content: <AuditTab tournamentId={t.id} /> },
              ]
            : []),
          ...(perms.canManage ? [{ value: 'pagina', label: 'Página pública', content: <PublicPageTab tournament={t} /> }] : []),
  ];
  // Aba pedida no endereço que este papel não enxerga (ex.: moderador em `?aba=equipe`): cai no Resumo.
  const activeTab = items.some((item) => item.value === tab) ? tab : 'resumo';

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
            {running && <LiveIndicator />}
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
        value={activeTab}
        onValueChange={changeTab}
        items={items}
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
