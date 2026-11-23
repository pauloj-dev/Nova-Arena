'use client';

import { Suspense, use } from 'react';
import { TelaoPage } from '@/features/telao/TelaoPage';

/** `/c/[slug]/telao/tabela?fase=&fundo=transparente&intervalo=&tema=`: classificação ao vivo em tela cheia. */
export default function TelaoTabelaRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return (
    <Suspense>
      <TelaoPage key={slug} slug={slug} view="tabela" />
    </Suspense>
  );
}
