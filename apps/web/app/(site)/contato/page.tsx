import type { Metadata } from 'next';
import { appMessages } from '@/app/messages';
import { getT } from '@/shared/i18n/core';
import { ContactPage } from '@/features/help/ContactPage';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(appMessages, 'paginas.contato');
  return { title: t('titulo'), description: t('descricao') };
}

export default function ContactRoute() {
  return <ContactPage />;
}
