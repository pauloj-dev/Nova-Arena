'use client';

import type { Tournament } from '@nova/schemas';
import { Avatar, Badge, Button, EmptyState, ErrorState, Progress, Skeleton, StatusPill, Tabs } from '@nova/ui';
import { CalendarClock, CalendarDays, Compass, Settings, User, Users } from 'lucide-react';
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
import { formatDateTime } from '@/shared/lib/datetime';
import { LiveIndicator } from '@/shared/realtime/LiveIndicator';
import { useTournamentChannel } from '@/shared/realtime/RealtimeProvider';
import { useSession } from '@/shared/session/useSession';
import { BracketTab, MatchesTab, ResultsTab } from './CompetitionTabs';
import { FollowButton } from './FollowButton';
import { ShareButton } from './ShareButton';
import { slotsText } from './TournamentCard';
import { AnnouncementsTab, OverviewTab, RegistrationsTab, RulesTab } from './TournamentTabs';

/**
 * Abas da página pública (PAR-03). As de competição (`competition: true`) só aparecem quando o
 * campeonato já tem chave confirmada ou terminou — sem aba vazia antes disso.
 */
const TABS = [
  { value: 'visao-geral', label: 'Visão geral', competition: false },
  { value: 'regulamento', label: 'Regulamento', competition: false },
  { value: 'inscritos', label: 'Inscritos', competition: false },
  { value: 'chave', label: 'Chave/Tabela', competition: true },
  { value: 'partidas', label: 'Partidas', competition: true },
  { value: 'resultados', label: 'Resultados', competition: true },
  { value: 'comunicados', label: 'Comunicados', competition: false },
] as const;
type TabValue = (typeof TABS)[number]['value'];
const DEFAULT_TAB: TabValue = 'visao-geral';
/** Links antigos e notificações usam `?aba=tabela`. */
const TAB_ALIASES: Record<string, TabValue> = { tabela: 'chave' };

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
  return (
    <PageContainer>
      <div role="status" aria-label="Carregando campeonato" className="flex flex-col gap-6">
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
  return (
    <PageContainer narrow>
      <h1 className="sr-only">Campeonato não encontrado</h1>
      <EmptyState
        icon={<Compass className="size-7" />}
        title="Campeonato não encontrado"
        description="O link pode estar errado, ou o campeonato ainda não foi publicado ou já foi arquivado."
        action={
          <Button asChild>
            <Link href="/campeonatos">Ver campeonatos</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}

function Header({ t, canManage }: { t: Tournament; canManage: boolean }) {
  const solo = t.participantType === 'SOLO';
  const ModeIcon = solo ? User : Users;
  // O resumo do campeonato traz só o id do jogo; o slug da página do jogo vem do catálogo.
  const game = useGame(t.gameId);
  return (
    <header className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="relative flex h-28 items-end bg-hero p-4 md:h-40 md:p-6">
        {t.bannerUrl && (
          // Banner enviado pelo organizador (URL arbitrária): `next/image` exigiria liberar cada domínio.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.bannerUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <span className="relative flex size-14 items-center justify-center rounded-lg border border-border bg-surface text-3xl shadow-md" aria-hidden>
          {t.gameIcon}
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {game.data ? (
              <Link href={`/jogos/${game.data.slug}`} className="font-semibold text-primary-text underline-offset-2 hover:underline">
                {t.gameName}
              </Link>
            ) : (
              <span className="font-semibold text-text">{t.gameName}</span>
            )}
            <span className="flex items-center gap-1 text-muted">
              <ModeIcon className="size-4" aria-hidden />
              {solo ? 'Solo' : 'Equipe'}
              {t.modeName && ` · ${t.modeName}`}
            </span>
            <StatusPill status={t.status} />
            {t.status === 'IN_PROGRESS' && <LiveIndicator />}
            {t.free && <Badge tone="gold">Gratuito</Badge>}
          </div>
          <h1 className="text-xl break-words md:text-2xl">{t.name}</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Avatar name={t.organizer.nickname} src={t.organizer.avatarUrl} size="sm" />
            <span>
              Organizado por{' '}
              <Link href={`/u/${encodeURIComponent(t.organizer.nickname)}`} className="font-semibold text-text underline-offset-2 hover:underline">
                {t.organizer.nickname}
              </Link>
            </span>
            {t.organizer.verifiedOrganizer && <VerifiedBadge />}
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
          <div className="flex items-start gap-2">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <div>
              <dt className="text-xs text-muted">Início</dt>
              <dd className="font-medium">{t.startsAt ? formatDateTime(t.startsAt) : 'A definir'}</dd>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <div>
              <dt className="text-xs text-muted">Inscrições</dt>
              <dd className="font-medium">
                {t.registrationOpensAt && t.registrationClosesAt
                  ? `De ${formatDateTime(t.registrationOpensAt, { withZone: false })} até ${formatDateTime(t.registrationClosesAt)}`
                  : t.registrationClosesAt
                    ? `Até ${formatDateTime(t.registrationClosesAt)}`
                    : 'Período a definir'}
              </dd>
            </div>
          </div>
        </dl>

        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Vagas</span>
            <span className="text-muted">
              {slotsText(t.takenSlots, t.maxParticipants)}
              {t.waitlistCount > 0 && ` · ${t.waitlistCount} na lista de espera`}
            </span>
          </div>
          <Progress value={t.takenSlots} max={t.maxParticipants} label="Vagas preenchidas" />
        </div>

        <div className="flex flex-wrap gap-2">
          <FollowButton type="tournament" id={t.id} name={t.name} />
          <ShareButton title={t.name} text={`${t.name} — ${t.gameName} na Nova Arena`} />
          {canManage && (
            <Button asChild variant="ghost">
              <Link href={`/organizador/campeonatos/${t.id}`}>
                <Settings className="size-4" aria-hidden />
                Gerenciar campeonato
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function TournamentPage({ slug }: { slug: string }) {
  const { user } = useSession();
  const tournament = useTournament(slug);
  const t = tournament.data;
  const access = useTournamentAccess(t?.id, Boolean(user));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('aba');

  // Competição (F2): partidas das fases com chave confirmada, minha inscrição e tempo real.
  // Cada evento do canal invalida as consultas; se a conexão cair, elas passam a atualizar a cada 10 s (CT-10).
  const mayHaveMatches = t !== undefined && !NO_COMPETITION_STATUSES.includes(t.status);
  const matches = useTournamentMatches(mayHaveMatches ? t.id : undefined);
  const myRegistration = useMyRegistration(t?.id, { enabled: Boolean(user) });
  useTournamentChannel(t?.id);

  if (tournament.isPending) return <PageSkeleton />;
  if (tournament.isError) {
    if (tournament.error instanceof ApiError && tournament.error.status === 404) return <NotFound />;
    return (
      <PageContainer narrow>
        <h1 className="sr-only">Campeonato</h1>
        <ErrorState title="Não foi possível carregar o campeonato" description={errorMessage(tournament.error)} onRetry={() => void tournament.refetch()} />
      </PageContainer>
    );
  }
  if (!t) return <NotFound />;

  // Dono, co-organizador e admin gerenciam; moderador não tem a área de gestão.
  const canManage = access.data === 'OWNER' || access.data === 'CO_ORGANIZER' || access.data === 'ADMIN';

  const hasCompetition = t.status === 'FINISHED' || (matches.data?.length ?? 0) > 0;
  const showCompetition = hasCompetition || (mayHaveMatches && matches.isPending && wantsCompetitionTab(requestedTab));
  const tab = parseTab(requestedTab, showCompetition);
  const viewer: MatchViewer = { userId: user?.id ?? null, registration: (user && myRegistration.data) || null, checkIn: t.checkIn, isStaff: user !== null && access.data != null };

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
    'visao-geral': <OverviewTab tournament={t} />,
    regulamento: <RulesTab tournament={t} />,
    inscritos: <RegistrationsTab tournament={t} />,
    chave: <BracketTab tournament={t} />,
    partidas: <MatchesTab tournament={t} matches={matches} />,
    resultados: <ResultsTab tournament={t} matches={matches} />,
    comunicados: <AnnouncementsTab tournament={t} />,
  };
  const tabs = TABS.filter((x) => showCompetition || !x.competition);

  return (
    <PageContainer>
      {/* Celular: cabeçalho, inscrição, abas. Desktop: a inscrição vai para a lateral (quando o painel tem conteúdo). */}
      <div className="grid grid-cols-1 gap-6 lg:has-[[data-registration-panel]:not(:empty)]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 lg:col-start-1">
          <Header t={t} canManage={canManage} />
        </div>
        <aside data-registration-panel aria-label="Inscrição" className="min-w-0 empty:hidden lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <RegistrationPanel tournament={t} />
        </aside>
        <div className="min-w-0 lg:col-start-1">
          <MatchViewerProvider value={viewer}>
            <Tabs label="Seções do campeonato" value={tab} onValueChange={onTabChange} items={tabs.map((x) => ({ value: x.value, label: x.label, content: content[x.value] }))} />
          </MatchViewerProvider>
        </div>
      </div>
    </PageContainer>
  );
}
