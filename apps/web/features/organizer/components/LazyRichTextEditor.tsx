'use client';

import { Skeleton } from '@nova/ui';
import dynamic from 'next/dynamic';
import { getT } from '@/shared/i18n/core';
import { messages } from '../messages';

/**
 * Editor de texto rico carregado sob demanda (#111): o Tiptap/ProseMirror pesa dezenas de KB e só faz sentido
 * no navegador. Mesma interface do `RichTextEditor`; enquanto carrega, um bloco do mesmo tamanho evita salto.
 */
function EditorLoading() {
  const label = getT(messages, 'LazyRichTextEditor')('carregando');
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-label={label}>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export const RichTextEditor = dynamic(() => import('./RichTextEditor').then((m) => m.RichTextEditor), {
  ssr: false,
  loading: EditorLoading,
});
