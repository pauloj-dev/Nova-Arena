import { Button, EmptyState } from '@nova/ui';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';
import { PageContainer } from '@/shared/layout/AreaShell';

/** 403 dentro da área: a pessoa é organizadora, mas este campeonato é de outra organização. */
export function NoAccess() {
  return (
    <PageContainer narrow>
      <EmptyState
        icon={<ShieldX className="size-7" />}
        title="Este campeonato é de outra organização"
        description="Você só pode gerenciar os campeonatos em que é responsável ou faz parte da equipe do evento. Se deveria ter acesso, peça para quem organiza adicionar você."
        action={
          <Button asChild>
            <Link href="/organizador/campeonatos">Ver meus campeonatos</Link>
          </Button>
        }
      />
      <p className="sr-only">Erro 403</p>
    </PageContainer>
  );
}

/** 404 dentro da área. */
export function TournamentNotFound() {
  return (
    <PageContainer narrow>
      <EmptyState
        title="Campeonato não encontrado"
        description="Ele pode ter sido excluído, ou o endereço está errado."
        action={
          <Button asChild>
            <Link href="/organizador/campeonatos">Ver meus campeonatos</Link>
          </Button>
        }
      />
    </PageContainer>
  );
}
