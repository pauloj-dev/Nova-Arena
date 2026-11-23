import { Button, EmptyState } from '@nova/ui';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { getT } from '@/shared/i18n/core';
import { sharedMessages } from '@/shared/i18n/messages';

/** Página 403: a pessoa está logada, mas não tem o papel exigido pela área. */
export function Forbidden({ area }: { area?: string }) {
  const t = getT(sharedMessages, 'Forbidden');
  const common = getT(sharedMessages, 'comum');
  return (
    <main id="conteudo" className="mx-auto flex min-h-[60dvh] max-w-xl items-center px-4 py-10">
      <EmptyState
        className="w-full"
        icon={<ShieldX className="size-7" />}
        title={t('titulo')}
        description={area ? t('descricaoArea', { area }) : t('descricao')}
        action={
          <Button asChild>
            <Link href="/">{common('voltarParaInicio')}</Link>
          </Button>
        }
      />
      <p className="sr-only">{t('erro403')}</p>
    </main>
  );
}
