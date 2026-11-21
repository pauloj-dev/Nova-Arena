import type { Metadata } from 'next';
import { appMessages } from '@/app/messages';
import { getT } from '@/shared/i18n/core';
import { MaintenancePage } from '@/features/help/MaintenancePage';

export async function generateMetadata(): Promise<Metadata> {
  const t = getT(appMessages, 'paginas.manutencao');
  return { title: t('titulo'), description: t('descricao') };
}

export default function MaintenanceRoute() {
  return <MaintenancePage />;
}
