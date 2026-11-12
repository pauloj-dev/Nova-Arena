'use client';

import { DisputeList } from '@/features/disputes/DisputeList';
import { ValidationQueue } from '@/features/disputes/ValidationQueue';

/** Aba Validação (ORG-08): a fila "Resultados para validar" e as disputas do campeonato. */
export function ValidationTab({ tournamentId }: { tournamentId: string }) {
  return (
    <div className="flex flex-col gap-8">
      <ValidationQueue tournamentId={tournamentId} />
      <DisputeList tournamentId={tournamentId} />
    </div>
  );
}
