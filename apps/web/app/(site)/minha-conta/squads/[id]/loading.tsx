import { appMessages } from '@/app/messages';
import { getT } from '@/shared/i18n/core';
import { RouteSkeleton } from '@/shared/layout/RouteSkeleton';

export default function Loading() {
  const t = getT(appMessages, 'carregando.site');
  return <RouteSkeleton variant="detalhe" label={t('minhaContaSquadsDetalhe')} />;
}
