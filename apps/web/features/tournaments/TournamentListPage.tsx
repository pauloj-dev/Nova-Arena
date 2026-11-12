'use client';

import { Button, Drawer, EmptyState, ErrorState, Input } from '@nova/ui';
import { SearchX, SlidersHorizontal } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useTournamentList } from '@/shared/api/hooks/tournaments';
import { PageContainer } from '@/shared/layout/AreaShell';
import { countActiveFilters, EMPTY_FILTERS, hasAnyFilter, parseFilters, serializeFilters, toApiFilters, type ListFilters } from './filters';
import { TournamentCard, TournamentCardSkeleton, TournamentGrid } from './TournamentCard';
import { TournamentFiltersPanel } from './TournamentFiltersPanel';
import { useIsDesktop } from './useMediaQuery';

const SEARCH_DEBOUNCE_MS = 350;

/** Lista de campeonatos: filtros na URL, busca com debounce e rolagem infinita (US-PAR-02). */
export function TournamentListPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A URL é a fonte da verdade: abrir o link reproduz a lista.
  const queryString = searchParams.toString();
  const urlFilters = useMemo(() => parseFilters(new URLSearchParams(queryString)), [queryString]);
  // Enquanto a URL não termina de mudar, a tela já mostra a escolha (o controle responde na hora).
  const [filters, setOptimisticFilters] = useOptimistic(urlFilters);
  const [, startTransition] = useTransition();
  const activeCount = countActiveFilters(filters);

  const setFilters = useCallback(
    (next: ListFilters) => {
      const qs = serializeFilters(next);
      startTransition(() => {
        setOptimisticFilters(next);
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname, setOptimisticFilters],
  );
  const patchFilters = (patch: Partial<ListFilters>) => setFilters({ ...filters, ...patch });

  // Busca: o campo responde na hora; a URL (e a consulta) só mudam depois de uma pausa na digitação.
  const [text, setText] = useState(filters.q);
  const [pushedQ, setPushedQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    // A URL mudou. Se não foi por causa da digitação (voltar do navegador, "Limpar filtros"), o campo acompanha.
    setSeenQ(filters.q);
    if (filters.q !== pushedQ) {
      setText(filters.q);
      setPushedQ(filters.q);
    }
  }
  useEffect(() => {
    const q = text.trim();
    if (q === filters.q) return;
    const timer = setTimeout(() => {
      setPushedQ(q);
      setFilters({ ...filters, q });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, filters, setFilters]);

  function clearAll() {
    setText('');
    setPushedQ('');
    setFilters(EMPTY_FILTERS);
  }

  const games = useGames();
  const list = useTournamentList(toApiFilters(filters));
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? items.length;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  // Falha ao buscar a próxima página mantém o que já foi carregado; só a primeira carga derruba a lista inteira.
  const nextPageFailed = list.isFetchNextPageError;
  const firstLoadFailed = list.isError && !nextPageFailed;
  const loadError = list.error;

  // Rolagem infinita: quando o fim da lista chega perto da tela, busca a próxima página.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    // Depois de uma falha, só o botão "Tentar novamente" busca de novo (sem laço de tentativas automáticas).
    if (!el || !hasNextPage || nextPageFailed || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, nextPageFailed, fetchNextPage, items.length]);

  const panel = (hideClear: boolean) => <TournamentFiltersPanel filters={filters} games={games.data} onChange={patchFilters} onClear={clearAll} hideClear={hideClear} />;

  return (
    <PageContainer>
      <div>
        <h1 className="text-xl md:text-2xl">Campeonatos</h1>
        <p className="mt-1 text-sm text-muted">Encontre um campeonato para jogar ou acompanhar. Os filtros ficam no link: é só copiar e mandar para o time.</p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {isDesktop && (
          <aside aria-label="Filtros" className="sticky top-20 w-64 shrink-0 rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-3 text-base">Filtros</h2>
            {panel(false)}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex items-end gap-2">
            <Input
              className="min-w-0 flex-1"
              label="Buscar campeonato pelo nome"
              hideLabel
              type="search"
              placeholder="Buscar pelo nome"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={80}
              enterKeyHint="search"
            />
            {!isDesktop && (
              <Button variant="secondary" onClick={() => setDrawerOpen(true)} iconLeft={<SlidersHorizontal className="size-4" aria-hidden />} aria-label={activeCount > 0 ? `Filtros, ${activeCount} ${activeCount === 1 ? 'ativo' : 'ativos'}` : 'Filtros'}>
                Filtros
                {activeCount > 0 && (
                  <span className="tabular flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent" data-testid="active-filter-count">
                    {activeCount}
                  </span>
                )}
              </Button>
            )}
          </div>

          <p className="text-sm text-muted" role="status" aria-live="polite">
            {list.isPending ? 'Carregando campeonatos…' : firstLoadFailed ? '' : total === 0 ? 'Nenhum campeonato encontrado' : `Mostrando ${items.length} de ${total} ${total === 1 ? 'campeonato' : 'campeonatos'}`}
          </p>

          {list.isPending ? (
            <TournamentGrid>
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i}>
                  <TournamentCardSkeleton />
                </li>
              ))}
            </TournamentGrid>
          ) : firstLoadFailed ? (
            <ErrorState title="Não foi possível carregar os campeonatos" description={errorMessage(loadError)} onRetry={() => void list.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-7" />}
              title="Nenhum campeonato encontrado"
              description={hasAnyFilter(filters) ? 'Nenhum campeonato combina com esses filtros. Tire algum filtro ou limpe todos para ver mais opções.' : 'Ainda não há campeonatos publicados. Volte em breve!'}
              action={
                hasAnyFilter(filters) ? (
                  <Button onClick={clearAll}>Limpar filtros</Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TournamentGrid label="Campeonatos">
                {items.map((t) => (
                  <li key={t.id}>
                    <TournamentCard tournament={t} headingLevel="h2" />
                  </li>
                ))}
                {isFetchingNextPage &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <li key={`loading-${i}`} aria-hidden>
                      <TournamentCardSkeleton />
                    </li>
                  ))}
              </TournamentGrid>

              {nextPageFailed && <ErrorState title="Não foi possível carregar mais campeonatos" description={errorMessage(loadError)} onRetry={() => void fetchNextPage()} />}

              {nextPageFailed ? null : hasNextPage ? (
                <div className="flex justify-center">
                  {/* Alternativa acessível à rolagem infinita: funciona por teclado e sem IntersectionObserver. */}
                  <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                    Carregar mais
                  </Button>
                </div>
              ) : items.length > 6 ? (
                <p className="text-center text-sm text-muted">Você chegou ao fim da lista.</p>
              ) : null}
              <div ref={sentinel} aria-hidden className="h-px" />
            </>
          )}
        </div>
      </div>

      <Drawer
        open={drawerOpen && !isDesktop}
        onOpenChange={setDrawerOpen}
        title="Filtros"
        side="bottom"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={clearAll} disabled={activeCount === 0}>
              Limpar filtros
            </Button>
            <Button className="flex-1" onClick={() => setDrawerOpen(false)}>
              {list.isPending ? 'Ver campeonatos' : `Ver ${total} ${total === 1 ? 'campeonato' : 'campeonatos'}`}
            </Button>
          </>
        }
      >
        {panel(true)}
      </Drawer>
    </PageContainer>
  );
}
