import { Button } from '@nova/ui';
import { IdCard } from 'lucide-react';
import Link from 'next/link';

/** Aviso de que falta o ID do jogo, com o caminho para resolver (Minha conta → IDs de jogo). */
export function GameAccountWarning({ gameName, context }: { gameName: string; context: 'register' | 'confirm' }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-warning bg-warning-soft p-3 text-warning-soft-text">
      <p className="flex items-start gap-2 text-sm">
        <IdCard className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong>Falta o seu ID de {gameName}.</strong> {context === 'register' ? 'A organização precisa dele para montar as partidas. Informe o ID e volte para se inscrever.' : 'Informe o ID para poder confirmar sua participação.'}
        </span>
      </p>
      <Button asChild variant="secondary" size="sm" className="self-start">
        <Link href="/minha-conta">Informar meu ID de {gameName}</Link>
      </Button>
    </div>
  );
}
