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
import { formatDateTime } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';

const container = 'mx-auto w-full max-w-[1280px] px-4 md:px-6';

/** O que a pessoa faz a seguir, dito no botão do destaque. */
function heroAction(t: TournamentSummary): string {
  if (t.status === 'REGISTRATION_OPEN') {
    if (t.takenSlots >= t.maxParticipants) return 'Entrar na lista de espera';
    return t.participantType === 'TEAM' ? 'Inscrever squad' : 'Quero me inscrever';
  }
  if (t.status === 'IN_PROGRESS' || t.status === 'PAUSED' || t.status === 'CHECK_IN') return 'Acompanhar campeonato';
  return 'Ver campeonato';
}

function Hero({ tournament: t, loading }: { tournament: TournamentSummary | undefined; loading: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="bg-hero text-white">
      <div className={cn(container, 'flex flex-col gap-4 py-8 md:flex-row md:items-end md:justify-between md:gap-8 md:py-12')}>
        {loading ? (
          <div role="status" aria-label="Carregando o campeonato em destaque" className="flex w-full flex-col gap-3">
            <Skeleton className="h-5 w-40 opacity-40" />
            <Skeleton className="h-10 w-4/5 opacity-40 md:w-1/2" />
            <Skeleton className="h-5 w-56 opacity-40" />
            <Skeleton className="h-12 w-48 opacity-40" />
          </div>
        ) : t ? (
          <>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold uppercase tracking-wide">Campeonato em destaque</span>
                <StatusPill status={t.status} />
              </div>
              <h2 id="hero-title" className="text-2xl uppercase break-words md:text-3xl">
                {t.name}
              </h2>
              <div className="flex flex-col gap-1 text-sm md:text-base">
                <p className="flex items-center gap-2">
                  <span aria-hidden>{t.gameIcon}</span>
                  <span>
                    {t.gameName}
                    {t.modeName && ` · ${t.modeName}`}
                  </span>
                </p>
                {t.startsAt && <p>Começa {formatDateTime(t.startsAt)}</p>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2 md:items-end">
              <p className="tabular text-base md:text-lg">
                {t.takenSlots}/{t.maxParticipants} vagas <span className="font-sans text-sm font-normal">· {slotsText(t.takenSlots, t.maxParticipants)}</span>
              </p>
              <Button asChild variant="gold" size="lg">
                <Link href={`/c/${t.slug}`}>
                  {heroAction(t)}
                  <ArrowRight className="size-5" aria-hidden />
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h2 id="hero-title" className="text-2xl uppercase md:text-3xl">
                Onde todo campeonato vira história
              </h2>
              <p className="text-sm md:text-base">Campeonatos de Free Fire, Clash Royale, 8 Ball Pool, eFootball e mais. Ache um e entre na disputa.</p>
            </div>
            <Button asChild variant="gold" size="lg" className="shrink-0">
              <Link href="/campeonatos">
                Ver campeonatos
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
  return (
    <nav aria-label="Campeonatos por jogo" className={container}>
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
              <span aria-hidden>{g.icon}</span>
              {g.name}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/campeonatos" className={chip}>
            <Gamepad2 className="size-4" aria-hidden />
            Todos
          </Link>
        </li>
      </ul>
    </nav>
  );
}

interface ShowcaseProps {
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

function Showcase({ title, query, exclude, moreHref, moreLabel, hideWhenEmpty, empty }: ShowcaseProps) {
  const id = `vitrine-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const items = (query.data?.items ?? []).filter((t) => t.id !== exclude);
  if (hideWhenEmpty && !query.isPending && !query.isError && items.length === 0) return null;
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
        <ErrorState title="Não foi possível carregar os campeonatos" description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
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
  const featured = useTournaments({ featured: '1' }, 5);
  const open = useTournaments({ status: 'open' }, 8);

  // O destaque é o primeiro campeonato marcado pela administração; sem nenhum, o primeiro com inscrições abertas.
  const hero = featured.data?.items[0] ?? (featured.isPending ? undefined : open.data?.items[0]);
  const heroLoading = featured.isPending || (!hero && open.isPending);

  return (
    <main id="conteudo" className="flex flex-col gap-8 pb-10 md:gap-10">
      <h1 className="sr-only">Nova Arena: campeonatos de eSports mobile</h1>
      <Hero tournament={hero} loading={heroLoading} />
      <GameShortcuts />
      {user && <UpcomingMatches />}
      <Showcase title="Campeonatos em destaque" query={featured} exclude={hero?.id} moreHref="/campeonatos" moreLabel="Ver todos" hideWhenEmpty />
      <Showcase
        title="Inscrições abertas"
        query={open}
        moreHref={listHref({ status: 'open' })}
        moreLabel="Ver todos"
        empty={
          <EmptyState
            icon={<Trophy className="size-7" />}
            title="Nenhum campeonato com inscrições abertas agora"
            description="Siga um jogo para ser avisado quando um campeonato novo abrir inscrições."
            action={
              <Button asChild>
                <Link href="/jogos">Escolher um jogo para seguir</Link>
              </Button>
            }
          />
        }
      />
    </main>
  );
}
