import { EmptyState } from '@nova/ui';
import { Hammer } from 'lucide-react';
import { getT } from '../i18n/core';
import { sharedMessages } from '../i18n/messages';
import { PageContainer } from './AreaShell';

/** Marcador de rota prevista no mapa do site cuja tela entra em uma fase posterior. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  const t = getT(sharedMessages, 'ComingSoon');
  return (
    <PageContainer narrow>
      <EmptyState icon={<Hammer className="size-7" />} title={title} description={t('descricao', { fase: phase })} />
    </PageContainer>
  );
}
