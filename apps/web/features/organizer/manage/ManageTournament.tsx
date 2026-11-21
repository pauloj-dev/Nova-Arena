'use client';

import { Badge, Button, ErrorState, Skeleton, StatusPill, Tabs, type TabItem } from '@nova/ui';
import { ExternalLink, Hourglass } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useOrganizerTournament } from '@/shared/api/hooks/organizer';
import { LiveIndicator } from '@/shared/realtime/LiveIndicator';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { NoAccess, TournamentNotFound } from '../components/NoAccess';
import { permissionsOf } from '../operation/stageUtils';
import { messages } from './messages';
import { SummaryTab } from './SummaryTab';

// As outras abas (chave com arrastar e soltar, editor de texto, importação de CSV…) só descem quando abertas (#111).
function TabLoading() {
  const t = useT(sharedMessages, 'comum');
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
const AnnouncementsTab = dynamic(() => import('./AnnouncementsTab').then((m) => m.AnnouncementsTab), { loading: TabLoading });
const DiscordTab = dynamic(() => import('./DiscordTab').then((m) => m.DiscordTab), { loading: TabLoading });
const AuditTab = dynamic(() => import('./AuditTab').then((m) => m.AuditTab), { loading: TabLoading });
const MatchesTab = dynamic(() => import('./MatchesTab').then((m) => m.MatchesTab), { loading: TabLoading });
const PublicPageTab = dynamic(() => import('./PublicPageTab').then((m) => m.PublicPageTab), { loading: TabLoading });
const RegistrationsTab = dynamic(() => import('./RegistrationsTab').then((m) => m.RegistrationsTab), { loading: TabLoading });
const StaffTab = dynamic(() => import('./StaffTab').then((m) => m.StaffTab), { loading: TabLoading });
const StagesTab = dynamic(() => import('./StagesTab').then((m) => m.StagesTab), { loading: TabLoading });
const ValidationTab = dynamic(() => import('./ValidationTab').then((m) => m.ValidationTab), { loading: TabLoading });

const TABS = ['resumo', 'inscricoes', 'fases', 'partidas', 'validacao', 'equipe', 'comunicados', 'auditoria', 'pagina', 'discord'] as const;
type TabId = (typeof TABS)[number];
const isTab = (value: string | null): value is TabId => TABS.includes(value as TabId);

function ManageInner({ tournamentId }: { tournamentId: string }) {
  const t = useT(messages, 'ManageTournament');
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
          <div className="flex flex-col gap-4" role="status" aria-label={t('carregandoCampeonato')}>
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-11 w-full max-w-md" />
            <Skeleton className="h-72 w-full" />
          </div>
        )}
      </PageContainer>
    );
  }

  const tournament = query.data;
  const perms = permissionsOf(tournament.access);
  const isDraft = tournament.status === 'DRAFT';
  const game = games.data?.find((g) => g.id === tournament.gameId) ?? null;
  const running = tournament.status === 'IN_PROGRESS' || tournament.status === 'PAUSED';

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
            label: t('abas.resumo'),
            content: (
              <SummaryTab
                tournament={tournament}
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
                {t('abas.inscricoes')}
                {tournament.pendingApprovals > 0 && (
                  <Badge tone="warning" icon={<Hourglass className="size-3" aria-hidden />}>
                    {tournament.pendingApprovals}
                    <span className="sr-only">{t('abas.aguardandoAprovacao')}</span>
                  </Badge>
                )}
              </span>
            ),
            content: <RegistrationsTab tournament={tournament} />,
          },
          ...(isDraft
            ? []
            : [
                {
                  value: 'fases',
                  label: t('abas.fases'),
                  content: (
                    <StagesTab
                      tournament={tournament}
                      game={game}
                      onGoToMatches={() => changeTab('partidas')}
                      onFinished={() => {
                        setCelebrate(true);
                        changeTab('resumo');
                      }}
                    />
                  ),
                },
                { value: 'partidas', label: t('abas.partidas'), content: <MatchesTab tournament={tournament} game={game} onGoToStages={() => changeTab('fases')} /> },
                { value: 'validacao', label: t('abas.validacao'), content: <ValidationTab tournamentId={tournament.id} /> },
              ]),
          // O moderador só vê o que ele opera: agenda, resultados, validação e inscrições (PRD §6).
          ...(perms.canManage && !isDraft
            ? [
                { value: 'equipe', label: t('abas.equipe'), content: <StaffTab tournament={tournament} /> },
                { value: 'comunicados', label: t('abas.comunicados'), content: <AnnouncementsTab tournament={tournament} /> },
                { value: 'auditoria', label: t('abas.auditoria'), content: <AuditTab tournamentId={tournament.id} /> },
              ]
            : []),
          ...(perms.canManage ? [{ value: 'pagina', label: t('abas.pagina'), content: <PublicPageTab tournament={tournament} /> }] : []),
          // Bot do Discord (issue 121): só quem gerencia vincula o servidor.
          ...(perms.canManage ? [{ value: 'discord', label: t('abas.discord'), content: <DiscordTab tournamentId={tournament.id} /> }] : []),
  ];
  // Aba pedida no endereço que este papel não enxerga (ex.: moderador em `?aba=equipe`): cai no Resumo.
  const activeTab = items.some((item) => item.value === tab) ? tab : 'resumo';

  return (
    <PageContainer>
      <PageHeader
        title={tournament.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill status={tournament.status} />
            <span>
              <span aria-hidden>{tournament.gameIcon} </span>
              {tournament.gameName} · {tournament.modeName}
            </span>
            {running && <LiveIndicator />}
          </span>
        }
        actions={
          !isDraft && (
            <Button asChild variant="secondary">
              <Link href={`/c/${tournament.slug}`}>
                <ExternalLink className="size-4" aria-hidden />
                {t('verPaginaPublica')}
              </Link>
            </Button>
          )
        }
      />
      <Tabs
        label={t('secoes')}
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
