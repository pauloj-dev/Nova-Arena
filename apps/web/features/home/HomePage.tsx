'use client';

import type { TournamentSummary } from '@nova/schemas';
import { Button, cn, EmptyState, ErrorState, Skeleton, StatusPill } from '@nova/ui';
import { ArrowRight, Gamepad2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { UpcomingMatches } from '@/features/registrations/UpcomingMatches';
import { listHref } from '@/features/tournaments/filters';
import { slotsText, TournamentCard, TournamentCardSkeleton, TournamentGrid } from '@/features/tournaments/TournamentCard';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useTournaments } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { messages } from './messages';
import { GameIcon } from '@/shared/brand/GameIcon';

const container = 'mx-auto w-full max-w-[1280px] px-4 md:px-6';

function useHeroT() {
  return useT(messages, 'Hero');
}

/** O que a pessoa faz a seguir, dito no botão do destaque. */
function heroAction(tournament: TournamentSummary, t: ReturnType<typeof useHeroT>): string {
  if (tournament.status === 'REGISTRATION_OPEN') {
    if (tournament.takenSlots >= tournament.maxParticipants) return t('acaoListaDeEspera');
    return tournament.participantType === 'TEAM' ? t('acaoInscreverSquad') : t('acaoInscrever');
  }
  if (tournament.status === 'IN_PROGRESS' || tournament.status === 'PAUSED' || tournament.status === 'CHECK_IN') return t('acaoAcompanhar');
  return t('acaoVer');
}

function Hero({ tournament, loading }: { tournament: TournamentSummary | undefined; loading: boolean }) {
  const t = useHeroT();
  const vagas = tournament
    ? t.rich('vagas', {
        ocupadas: tournament.takenSlots,
        total: tournament.maxParticipants,
        situacao: slotsText(tournament.takenSlots, tournament.maxParticipants),
        detalhe: (chunks) => <span className="font-sans text-sm font-normal">{chunks}</span>,
      })
    : null;
  return (
    <section aria-labelledby="hero-title" className="bg-hero text-white">
      {/* Altura mínima do conteúdo típico (título em 2 linhas), para o esqueleto e o campeonato ocuparem o mesmo espaço (#111, CLS). */}
      <div className={cn(container, 'flex min-h-[23.5rem] flex-col gap-4 py-8 md:min-h-[19.5rem] md:flex-row md:items-end md:justify-between md:gap-8 md:py-12 lg:min-h-[16rem]')}>
        {loading ? (
          <div role="status" aria-label={t('carregando')} className="flex w-full flex-col gap-3">
            <Skeleton className="h-5 w-40 opacity-40" />
            <Skeleton className="h-10 w-4/5 opacity-40 md:w-1/2" />
            <Skeleton className="h-5 w-56 opacity-40" />
            <Skeleton className="h-12 w-48 opacity-40" />
          </div>
        ) : tournament ? (
          <>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide">{t('emDestaque')}</span>
                <StatusPill status={tournament.status} />
              </div>
              <h2 id="hero-title" className="text-2xl uppercase break-words md:text-3xl">
                {tournament.name}
              </h2>
              <div className="flex flex-col gap-1 text-sm md:text-base">
                <p className="flex items-center gap-2">
                  <GameIcon icon={tournament.gameIcon} coverUrl={tournament.gameCoverUrl} className="size-6 rounded-sm bg-transparent" px={24} />
                  <span>
                    {tournament.gameName}
                    {tournament.modeName && t('modo', { modo: tournament.modeName })}
                  </span>
                </p>
                {tournament.startsAt && <p>{t('comeca', { data: formatDateTime(tournament.startsAt) })}</p>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 md:items-end">
              <p className="tabular text-base md:text-lg">{vagas}</p>
              <Button asChild variant="gold" size="lg">
                <Link href={`/c/${tournament.slug}`}>
                  {heroAction(tournament, t)}
                  <ArrowRight className="size-5" aria-hidden />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h2 id="hero-title" className="text-2xl uppercase md:text-3xl">
                {t('vazioTitulo')}
              </h2>
              <p className="text-sm md:text-base">{t('vazioDescricao')}</p>
            </div>
            <Button asChild variant="gold" size="lg" className="shrink-0">
              <Link href="/campeonatos">
                {t('verCampeonatos')}
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

const chip =
  'flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface px-4 text-sm font-semibold text-text transition-colors hover:border-accent hover:bg-accent-soft hover:text-accent-soft-text';

function GameShortcuts() {
  const games = useGames();
  const t = useT(messages, 'GameShortcuts');
  return (
    <nav aria-label={t('rotulo')} className={container}>
      {/* No celular os atalhos rolam na horizontal dentro da própria faixa, sem empurrar a página. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
        {games.isPending &&
          Array.from({ length: 4 }).map((_, i) => (
            <li key={i} aria-hidden>
              <Skeleton className="h-11 w-32 rounded-full" />
            </li>
          ))}
        {games.data?.map((g) => (
          <li key={g.id}>
            <Link href={listHref({ game: g.slug })} className={chip}>
              <GameIcon icon={g.icon} coverUrl={g.coverUrl} className="size-6 rounded-sm bg-transparent" px={24} />
              {g.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/campeonatos" className={chip}>
            <Gamepad2 className="size-4" aria-hidden />
            {t('todos')}
          </Link>
        </li>
      </ul>
    </nav>
  );
}

interface ShowcaseProps {
  /** `id` do título da seção (âncora do `aria-labelledby`). */
  id: string;
  title: string;
  query: ReturnType<typeof useTournaments>;
  /** Campeonato que já está no destaque do topo e não precisa se repetir. */
  exclude?: string;
  moreHref: string;
  moreLabel: string;
  /** Sem itens: some com a seção (em vez de mostrar o estado vazio). */
  hideWhenEmpty?: boolean;
  empty?: React.ReactNode;
}

function Showcase({ id, title, query, exclude, moreHref, moreLabel, hideWhenEmpty, empty }: ShowcaseProps) {
  const t = useT(messages, 'Showcase');
  const items = (query.data?.items ?? []).filter((t) => t.id !== exclude);
  // Vitrine opcional (a dos destaques): só aparece quando tem o que mostrar. Sem esqueleto enquanto carrega, porque no caso
  // comum ela fica vazia (o 1º destaque já está no topo) e o espaço reservado sumiria, puxando a página (#111, CLS).
  if (hideWhenEmpty && (query.isPending || (!query.isError && items.length === 0))) return null;
  return (
    <section aria-labelledby={id} className={cn(container, 'flex flex-col gap-4')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-xl">
          {title}
        </h2>
        <Link href={moreHref} className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text underline-offset-2 hover:underline">
          {moreLabel}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {query.isPending ? (
        <TournamentGrid wide>
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <TournamentCardSkeleton />
            </li>
          ))}
        </TournamentGrid>
      ) : query.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        empty
      ) : (
        <TournamentGrid wide label={title}>
          {items.map((t) => (
            <li key={t.id}>
              <TournamentCard tournament={t} />
            </li>
          ))}
        </TournamentGrid>
      )}
    </section>
  );
}

/** Home (PRD §15.6): destaque, atalhos por jogo, próximas partidas de quem está logado e vitrines. */
export function HomePage() {
  const { user } = useSession();
  const t = useT(messages, 'HomePage');
  const featured = useTournaments({ featured: '1' }, 5);
  const open = useTournaments({ status: 'open' }, 8);

  // O destaque é o primeiro campeonato marcado pela administração; sem nenhum, o primeiro com inscrições abertas.
  const hero = featured.data?.items[0] ?? (featured.isPending ? undefined : open.data?.items[0]);
  const heroLoading = featured.isPending || (!hero && open.isPending);

  return (
    <main id="conteudo" className="flex flex-col gap-8 pb-10 md:gap-10">
      <h1 className="sr-only">{t('titulo')}</h1>
      <Hero tournament={hero} loading={heroLoading} />
      <GameShortcuts />
      {user && <UpcomingMatches />}
      <Showcase id="vitrine-campeonatos-em-destaque" title={t('destaques')} query={featured} exclude={hero?.id} moreHref="/campeonatos" moreLabel={t('verTodos')} hideWhenEmpty />
      <Showcase
        id="vitrine-inscri-es-abertas"
        title={t('inscricoesAbertas')}
        query={open}
        moreHref={listHref({ status: 'open' })}
        moreLabel={t('verTodos')}
        empty={
          <EmptyState
            icon={<Trophy className="size-7" />}
            title={t('vazioTitulo')}
            description={t('vazioDescricao')}
            action={
              <Button asChild>
                <Link href="/jogos">{t('escolherJogo')}</Link>
              </Button>
            }
          />
        }
      />
    </main>
  );
}
