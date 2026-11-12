import { Button, EmptyState } from '@nova/ui';
import { Compass } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="conteudo" className="mx-auto flex min-h-dvh max-w-xl items-center px-4 py-10">
      <EmptyState
        className="w-full"
        icon={<Compass className="size-7" />}
        title="Página não encontrada"
        description="O endereço pode ter mudado ou o campeonato pode ter sido arquivado."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/campeonatos">Ver campeonatos</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/">Ir para o início</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}
