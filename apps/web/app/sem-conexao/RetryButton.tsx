'use client';

import { Button } from '@nova/ui';
import { RefreshCw } from 'lucide-react';

/** Recarrega a página que a pessoa tentou abrir (o service worker devolve a página offline só sem rede). */
export function RetryButton() {
  return (
    <Button iconLeft={<RefreshCw className="size-4" aria-hidden />} onClick={() => window.location.reload()}>
      Tentar de novo
    </Button>
  );
}
