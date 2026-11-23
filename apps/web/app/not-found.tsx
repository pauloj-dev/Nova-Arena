import { Button, EmptyState } from '@nova/ui';
import { Compass } from 'lucide-react';
import Link from 'next/link';
import { getT } from '@/shared/i18n/core';
import { appMessages } from './messages';

export default function NotFound() {
  const t = getT(appMessages, 'NotFound');
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <EmptyState
        className="w-full"
        icon={<Compass className="size-7" />}
        title={t('titulo')}
        description={t('descricao')}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/campeonatos">{t('verCampeonatos')}</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">{t('irParaInicio')}</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
