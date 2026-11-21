import { EmptyIllustration } from '@nova/ui';
import { WifiOff } from 'lucide-react';
import type { Metadata } from 'next';
import { Logo } from '@/shared/layout/Logo';
import { RetryButton } from './RetryButton';

export const metadata: Metadata = {
  title: 'Sem conexão',
  robots: { index: false },
};

/**
 * Página offline do PWA (issue #105). Pré-carregada pelo service worker e mostrada quando uma tela é aberta sem
 * internet. Não depende da API: nada de campeonato, resultado ou conta fica guardado no aparelho.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg px-safe">
      <header className="border-b border-border bg-surface px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 md:px-6">
        <Logo />
      </header>
      <main id="conteudo" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-10">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
          <div className="relative flex h-28 w-44 items-center justify-center" aria-hidden>
            <EmptyIllustration className="absolute inset-0 size-full" />
            <div className="relative -mt-6 flex size-14 items-center justify-center rounded-full bg-surface text-accent-soft-text shadow-sm ring-4 ring-accent-soft">
              <WifiOff className="size-7" />
            </div>
          </div>
          <h1 className="text-xl">Você está sem internet</h1>
          <p className="max-w-md text-sm text-muted">
            Assim que a conexão voltar, a Nova Arena carrega de novo. Tabelas, partidas e a sua conta só aparecem com internet, para estarem sempre atualizadas.
          </p>
          <RetryButton />
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          <li>Confira o Wi-Fi ou os dados móveis.</li>
          <li>Em partida marcada, avise a organização pelo grupo do campeonato se a queda for longa.</li>
        </ul>
      </main>
    </div>
  );
}
