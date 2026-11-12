import { Button, EmptyState } from '@nova/ui';
import { ShieldX } from 'lucide-react';
import Link from 'next/link';

/** Página 403: a pessoa está logada, mas não tem o papel exigido pela área. */
export function Forbidden({ area }: { area?: string }) {
  return (
    <main id="conteudo" className="mx-auto flex min-h-[60dvh] max-w-xl items-center px-4 py-10">
      <EmptyState
        className="w-full"
        icon={<ShieldX className="size-7" />}
        title="Você não tem acesso a esta área"
        description={
          area
            ? `A área ${area} é restrita. Se você acha que deveria ter acesso, fale com a administração da Nova Arena.`
            : 'Esta página é restrita. Se você acha que deveria ter acesso, fale com a administração da Nova Arena.'
        }
        action={
          <Button asChild>
            <Link href="/">Voltar para o início</Link>
          </Button>
        }
      />
      <p className="sr-only">Erro 403</p>
    </main>
  );
}
