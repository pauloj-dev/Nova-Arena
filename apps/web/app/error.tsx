'use client';

import { ErrorState } from '@nova/ui';
import { useEffect } from 'react';
import { useT } from '@/shared/i18n/react';
import { appMessages } from './messages';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT(appMessages, 'GlobalError');
  useEffect(() => {
    console.error(error);
    // Monitoramento de erros (issue #116): só com DSN, e baixado só quando algo quebra.
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => undefined);
  }, [error]);
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <ErrorState className="w-full" title={t('titulo')} description={t('descricao')} onRetry={reset} />
    </main>
  );
}
