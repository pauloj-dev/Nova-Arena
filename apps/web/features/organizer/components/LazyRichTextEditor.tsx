'use client';

import { Skeleton } from '@nova/ui';
import dynamic from 'next/dynamic';

/**
 * Editor de texto rico carregado sob demanda (#111): o Tiptap/ProseMirror pesa dezenas de KB e só faz sentido
 * no navegador. Mesma interface do `RichTextEditor`; enquanto carrega, um bloco do mesmo tamanho evita salto.
 */
export const RichTextEditor = dynamic(() => import('./RichTextEditor').then((m) => m.RichTextEditor), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-1.5" role="status" aria-label="Carregando o editor de texto">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-48 w-full" />
    </div>
  ),
});
