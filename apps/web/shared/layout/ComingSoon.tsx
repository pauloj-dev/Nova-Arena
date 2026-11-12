import { EmptyState } from '@nova/ui';
import { Hammer } from 'lucide-react';
import { PageContainer } from './AreaShell';

/** Marcador de rota prevista no mapa do site cuja tela entra em uma fase posterior. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <PageContainer narrow>
      <EmptyState icon={<Hammer className="size-7" />} title={title} description={`Esta tela faz parte da fase ${phase} do plano e ainda não foi construída.`} />
    </PageContainer>
  );
}
