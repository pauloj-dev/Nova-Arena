'use client';

import { Button } from '@nova/ui';
import { RefreshCw } from 'lucide-react';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';

/** Recarrega a página que a pessoa tentou abrir (o service worker devolve a página offline só sem rede). */
export function RetryButton() {
  const t = useT(sharedMessages, 'comum');
  return (
    <Button iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => window.location.reload()}>
      {t('tentarDeNovo')}
    </Button>
  );
}
