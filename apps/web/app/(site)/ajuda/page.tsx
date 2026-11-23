import type { Metadata } from 'next';
import { appMessages } from '@/app/messages';
import { getT } from '@/shared/i18n/core';
import { HelpCenter } from '@/features/help/HelpCenter';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(appMessages, 'paginas.ajuda');
  return { title: t('titulo'), description: t('descricao') };
}

export default function HelpRoute() {
  return <HelpCenter />;
}
