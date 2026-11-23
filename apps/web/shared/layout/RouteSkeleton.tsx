import { cn, Skeleton } from '@nova/ui';
import { getT } from '@/shared/i18n/core';
import { sharedMessages } from '@/shared/i18n/messages';

export type RouteSkeletonVariant = 'inicio' | 'lista' | 'detalhe' | 'tabela' | 'formulario' | 'texto' | 'painel' | 'auth';

/**
 * Esqueleto de carregamento de cada rota (`loading.tsx`, issue 107): o formato do conteúdo que vem, nunca um
 * spinner de tela cheia (PRD §15.8). É o `<main id="conteudo">` da página enquanto ela carrega, para o
 * "Pular para o conteúdo" funcionar, e avisa o leitor de tela (`role="status"`) sem roubar o foco.
 */
export function RouteSkeleton({ variant, label }: { variant: RouteSkeletonVariant; label: string }) {
  const t = getT(sharedMessages, 'comum');
  if (variant === 'auth') {
    return (
      <div className="flex flex-col gap-4" role="status" aria-busy="true" aria-label={t('carregandoAlgo', { oque: label })}>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  return (
    <main id="conteudo" className={cn('mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-6 md:py-8', variant === 'texto' || variant === 'formulario' ? 'max-w-3xl' : 'max-w-[1280px]')}>
      <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label={t('carregandoAlgo', { oque: label })}>
        <Body variant={variant} />
      </div>
    </main>
  );
}

function Header({ action = false }: { action?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action && <Skeleton className="h-11 w-40" />}
    </div>
  );
}

function CardGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-2 w-full rounded-full" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function Rows({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <Skeleton className="h-6 w-full" />
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  );
}

function Body({ variant }: { variant: Exclude<RouteSkeletonVariant, 'auth'> }) {
  switch (variant) {
    case 'inicio':
      return (
        <>
          <Skeleton className="h-52 w-full rounded-lg md:h-64" />
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-7 w-48" />
          <CardGrid count={3} />
        </>
      );
    case 'lista':
      return (
        <>
          <Header action />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 w-full xs:w-64" />
            <Skeleton className="h-11 w-32" />
          </div>
          <CardGrid />
        </>
      );
    case 'detalhe':
      return (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 md:p-6">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
          <div className="flex gap-2 overflow-hidden border-b border-border pb-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-24 shrink-0" />
            ))}
          </div>
          <Rows count={4} />
        </>
      );
    case 'tabela':
      return (
        <>
          <Header action />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
          <Rows count={8} />
        </>
      );
    case 'formulario':
      return (
        <>
          <Header />
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 md:p-6">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
            <Skeleton className="h-11 w-40 self-end" />
          </div>
        </>
      );
    case 'texto':
      return (
        <>
          <Skeleton className="h-8 w-64 max-w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className={cn('h-4', i % 3 === 2 ? 'w-4/5' : 'w-full')} />
          ))}
          <Skeleton className="h-24 w-full" />
        </>
      );
    case 'painel':
      return (
        <>
          <Header action />
          <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        </>
      );
  }
}
