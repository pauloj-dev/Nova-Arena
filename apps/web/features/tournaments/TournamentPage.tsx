'use client';

import type { Tournament } from '@nova/schemas';
import { Avatar, Badge, Button, EmptyState, ErrorState, Progress, Skeleton, StatusPill, Tabs } from '@nova/ui';
import { CalendarClock, CalendarDays, Compass, Settings, User, Users } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MatchViewerProvider, type MatchViewer } from '@/features/matches/viewer';
import { VerifiedBadge } from '@/features/profile/VerifiedBadge';
import { RegistrationPanel } from '@/features/registrations/RegistrationPanel';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useTournamentMatches } from '@/shared/api/hooks/competition';
import { useGame } from '@/shared/api/hooks/games';
import { useMyRegistration } from '@/shared/api/hooks/registrations';
import { useTournament, useTournamentAccess } from '@/shared/api/hooks/tournaments';
import { PageContainer } from '@/shared/layout/AreaShell';
import { BlobImage } from '@/shared/lib/blob-image';
import { formatDateTime } from '@/shared/lib/datetime';
import { useT } from '@/shared/i18n/react';
import { LiveIndicator } from '@/shared/realtime/LiveIndicator';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { useSession } from '@/shared/session/useSession';
import { FollowButton } from './FollowButton';
import { messages } from './messages';
import { ShareButton } from './ShareButton';
import { slotsText } from './TournamentCard';
import { AnnouncementsTab, OverviewTab, RegistrationsTab, RulesTab } from './TournamentTabs';

// Chave, partidas e resultados (chave, tabela, modal da partida, envio de resultado) só descem quando a aba abre:
// fora do JS inicial da página pública (#111).
function CompetitionTabLoading() {
  const t = useT(messages, 'TournamentPage');
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
const BracketTab = dynamic(() => import('./CompetitionTabs').then((m) => m.BracketTab), { loading: CompetitionTabLoading });
const MatchesTab = dynamic(() => import('./CompetitionTabs').then((m) => m.MatchesTab), { loading: CompetitionTabLoading });
const ResultsTab = dynamic(() => import('./CompetitionTabs').then((m) => m.ResultsTab), { loading: CompetitionTabLoading });

/**
 * Abas da página pública (PAR-03). As de competição (`competition: true`) só aparecem quando o
 * campeonato já tem chave confirmada ou terminou — sem aba vazia antes disso.
 */
const TABS = [
  { value: 'visao-geral', label: 'visaoGeral', competition: false },
  { value: 'regulamento', label: 'regulamento', competition: false },
  { value: 'inscritos', label: 'inscritos', competition: false },
  { value: 'chave', label: 'chave', competition: true },
  { value: 'partidas', label: 'partidas', competition: true },
  { value: 'resultados', label: 'resultados', competition: true },
  { value: 'comunicados', label: 'comunicados', competition: false },
] as const;
type TabValue = (typeof TABS)[number]['value'];
const DEFAULT_TAB: TabValue = 'visao-geral';
/** Links antigos e notificações usam `?aba=tabela`. */
// `classificacao` era o nome da aba em uma versão anterior da página: links antigos continuam funcionando.
const TAB_ALIASES: Record<string, TabValue> = { tabela: 'chave', classificacao: 'chave' };

/** Antes disso não existe chave confirmada: nem vale perguntar à API. */
const NO_COMPETITION_STATUSES: Tournament['status'][] = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN'];

export function parseTab(value: string | null, competition = true): TabValue {
  const wanted = value !== null ? (TAB_ALIASES[value] ?? value) : null;
  const tab = TABS.find((t) => t.value === wanted);
  return tab && (competition || !tab.competition) ? tab.value : DEFAULT_TAB;
}

/** A aba pedida na URL é uma das de competição (para não piscar a "Visão geral" enquanto as partidas carregam). */
function wantsCompetitionTab(value: string | null): boolean {
  return TABS.some((t) => t.competition && t.value === parseTab(value));
}

function PageSkeleton() {
  const t = useT(messages, 'TournamentPage');
  return (
    <PageContainer>
      <div role="status" aria-label={t('carregandoCampeonato')} className="flex flex-col gap-6">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Skeleton className="h-28 w-full rounded-none md:h-40" />
          <div className="flex flex-col gap-3 p-4 md:p-6">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-2 w-full" />
          </div>
        </div>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </PageContainer>
  );
}

function NotFound() {
  const t = useT(messages, 'TournamentPage');
  return (
    <PageContainer narrow>
      <h1 className="sr-only">{t('naoEncontrado')}</h1>
      <EmptyState
        icon={<Compass className="size-7" />}
        title={t('naoEncontrado')}
        description={t('naoEncontradoDescricao')}
        action={
          <Button asChild>
            <Link href="/campeonatos">{t('verCampeonatos')}</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}

function Header({ tournament, canManage }: { tournament: Tournament; canManage: boolean }) {
  const t = useT(messages, 'TournamentPage');
  const solo = tournament.participantType === 'SOLO';
  const ModeIcon = solo ? User : Users;
  // O resumo do campeonato traz só o id do jogo; o slug da página do jogo vem do catálogo.
  const game = useGame(tournament.gameId);
  const organizedBy = t.rich('organizadoPor', {
    nickname: tournament.organizer.nickname,
    link: (chunks) => (
      <Link href={`/u/${encodeURIComponent(tournament.organizer.nickname)}`} className="font-semibold text-text underline-offset-2 hover:underline">
        {chunks}
      </Link>
    ),
  });
  return (
    <header className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="relative flex h-28 items-end bg-hero p-4 md:h-40 md:p-6">
        {tournament.bannerUrl && (
          // Banner do organizador: otimizado quando vem do Vercel Blob; é o topo da página (candidato a LCP).
          <BlobImage src={tournament.bannerUrl} alt="" sizes="(min-width: 1280px) 1200px, 100vw" className="object-cover" priority />
        )}
        <span className="relative flex size-14 items-center justify-center rounded-lg border border-border bg-surface text-3xl shadow-md" aria-hidden>
          {tournament.gameIcon}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {game.data ? (
              <Link href={`/jogos/${game.data.slug}`} className="-my-3 inline-block py-3 font-semibold text-primary-text underline-offset-2 hover:underline">
                {tournament.gameName}
              </Link>
            ) : (
              <span className="font-semibold text-text">{tournament.gameName}</span>
            )}
            <span className="flex items-center gap-1 text-muted">
              <ModeIcon className="size-4" aria-hidden />
              {solo ? t('solo') : t('equipe')}
              {tournament.modeName && ` · ${tournament.modeName}`}
            </span>
            <StatusPill status={tournament.status} />
            {tournament.status === 'IN_PROGRESS' && <LiveIndicator />}
            {tournament.free && <Badge tone="gold">{t('gratuito')}</Badge>}
          </div>
          <h1 className="text-xl break-words md:text-2xl">{tournament.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Avatar name={tournament.organizer.nickname} src={tournament.organizer.avatarUrl} size="sm" />
            <span>{organizedBy}</span>
            {tournament.organizer.verifiedOrganizer && <VerifiedBadge />}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="relative pl-6">
            <dt className="text-xs text-muted">
              <CalendarDays className="absolute left-0 top-0.5 size-4 text-muted" aria-hidden />
              {t('inicio')}
            </dt>
            <dd className="font-medium">{tournament.startsAt ? formatDateTime(tournament.startsAt) : t('aDefinir')}</dd>
          </div>
          <div className="relative pl-6">
            <dt className="text-xs text-muted">
              <CalendarClock className="absolute left-0 top-0.5 size-4 text-muted" aria-hidden />
              {t('inscricoes')}
            </dt>
            <dd className="font-medium">
              {tournament.registrationOpensAt && tournament.registrationClosesAt
                ? t('periodoInscricoes', { abre: formatDateTime(tournament.registrationOpensAt, { withZone: false }), fecha: formatDateTime(tournament.registrationClosesAt) })
                : tournament.registrationClosesAt
                  ? t('inscricoesAte', { fecha: formatDateTime(tournament.registrationClosesAt) })
                  : t('periodoADefinir')}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{t('vagas')}</span>
            <span className="text-muted">
              {slotsText(tournament.takenSlots, tournament.maxParticipants)}
              {tournament.waitlistCount > 0 && ` · ${t('listaDeEspera', { n: tournament.waitlistCount })}`}
            </span>
          </div>
          <Progress value={tournament.takenSlots} max={tournament.maxParticipants} label={t('vagasPreenchidas')} />
        </div>

        <div className="flex flex-wrap gap-2">
          <FollowButton type="tournament" id={tournament.id} name={tournament.name} />
          <ShareButton title={tournament.name} text={t('textoCompartilhar', { nome: tournament.name, jogo: tournament.gameName })} />
          {canManage && (
            <Button asChild variant="ghost">
              <Link href={`/organizador/campeonatos/${tournament.id}`}>
                <Settings className="size-4" aria-hidden />
                {t('gerenciar')}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function TournamentPage({ slug }: { slug: string }) {
  const t = useT(messages, 'TournamentPage');
  const { user } = useSession();
  const query = useTournament(slug);
  const tournament = query.data;
  const access = useTournamentAccess(tournament?.id, Boolean(user));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('aba');

  // Competição (F2): partidas das fases com chave confirmada, minha inscrição e tempo real.
  // Cada evento do canal invalida as consultas; se a conexão cair, elas passam a atualizar a cada 10 s (CT-10).
  const mayHaveMatches = tournament !== undefined && !NO_COMPETITION_STATUSES.includes(tournament.status);
  const matches = useTournamentMatches(mayHaveMatches ? tournament.id : undefined);
  const myRegistration = useMyRegistration(tournament?.id, { enabled: Boolean(user) });
  useTournamentChannel(tournament?.id);

  if (query.isPending) return <PageSkeleton />;
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />;
    return (
      <PageContainer narrow>
        <h1 className="sr-only">{t('campeonato')}</h1>
        <ErrorState title={t('erroCarregar')} description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </PageContainer>
    );
  }
  if (!tournament) return <NotFound />;

  // Dono, co-organizador e admin gerenciam; moderador não tem a área de gestão.
  const canManage = access.data === 'OWNER' || access.data === 'CO_ORGANIZER' || access.data === 'ADMIN';

  const hasCompetition = tournament.status === 'FINISHED' || (matches.data?.length ?? 0) > 0;
  const showCompetition = hasCompetition || (mayHaveMatches && matches.isPending && wantsCompetitionTab(requestedTab));
  const tab = parseTab(requestedTab, showCompetition);
  const viewer: MatchViewer = { userId: user?.id ?? null, registration: (user && myRegistration.data) || null, checkIn: tournament.checkIn, isStaff: user !== null && access.data != null };

  function onTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === DEFAULT_TAB) params.delete('aba');
    else params.set('aba', value);
    // O detalhe aberto em "Partidas" não acompanha a troca de aba.
    params.delete('partida');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const content: Record<TabValue, React.ReactNode> = {
    'visao-geral': <OverviewTab tournament={tournament} />,
    regulamento: <RulesTab tournament={tournament} />,
    inscritos: <RegistrationsTab tournament={tournament} />,
    chave: <BracketTab tournament={tournament} />,
    partidas: <MatchesTab tournament={tournament} matches={matches} />,
    resultados: <ResultsTab tournament={tournament} matches={matches} />,
    comunicados: <AnnouncementsTab tournament={tournament} />,
  };
  const tabs = TABS.filter((x) => showCompetition || !x.competition);

  return (
    <PageContainer>
      {/* Celular: cabeçalho, inscrição, abas. Desktop: a inscrição vai para a lateral (quando o painel tem conteúdo). */}
      <div className="grid grid-cols-1 gap-6 lg:has-[[data-registration-panel]:not(:empty)]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:col-start-1">
          <Header tournament={tournament} canManage={canManage} />
        </div>
        <aside data-registration-panel aria-label={t('inscricao')} className="min-w-0 empty:hidden lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <RegistrationPanel tournament={tournament} />
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <MatchViewerProvider value={viewer}>
            <Tabs label={t('secoes')} value={tab} onValueChange={onTabChange} items={tabs.map((x) => ({ value: x.value, label: t(`abas.${x.label}`), content: content[x.value] }))} />
          </MatchViewerProvider>
        </div>
      </div>
    </PageContainer>
  );
}
