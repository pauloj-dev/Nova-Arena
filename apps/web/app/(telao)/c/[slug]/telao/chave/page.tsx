'use client';

import { Suspense, use } from 'react';
import { TelaoPage } from '@/features/telao/TelaoPage';

/** `/c/[slug]/telao/chave?fase=&fundo=transparente&intervalo=&tema=`: chave ao vivo em tela cheia. */
export default function TelaoChaveRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Suspense>
      <TelaoPage key={slug} slug={slug} view="chave" />
    </Suspense>
  );
}
