'use client';

import { ErrorState, Skeleton } from '@nova/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { errorMessage } from '@/shared/api/client';
import { useMyRegistrations } from '@/shared/api/hooks/registrations';
import { useSession } from '@/shared/session/useSession';
import { isCurrentEntry } from './lib/rules';
import { RegistrationEntryCard } from './RegistrationEntryCard';

/** Quantas inscrições cabem na home. O resto fica em "Meus campeonatos". */
const MAX_ON_HOME = 3;

/**
 * "Suas próximas partidas" da home (só para quem está logado).
 * As inscrições com partida marcada vêm primeiro, pela mais próxima, com adversário, horário e
 * check-in no próprio cartão; as demais inscrições ativas vêm em seguida.
 * Não aparece para visitante nem sem inscrições.
 */
export function UpcomingMatches() {
  const { user } = useSession();
  const entries = useMyRegistrations({ enabled: Boolean(user) });

  if (!user) return null;

  const active = (entries.data ?? []).filter(isCurrentEntry);
  if (entries.isSuccess && active.length === 0) return null;
  // Quem tem partida por jogar vem na frente: a com horário mais próximo primeiro, sem horário por último.
  const withMatch = active.filter((e) => e.nextMatch !== null).sort((a, b) => (a.nextMatch?.scheduledAt ?? '9999').localeCompare(b.nextMatch?.scheduledAt ?? '9999'));
  const current = [...withMatch, ...active.filter((e) => e.nextMatch === null)];

  return (
    // A home não tem contêiner próprio: cada seção dela traz a largura máxima e as margens.
    <section aria-labelledby="proximos-campeonatos" className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="proximos-campeonatos" className="text-xl">
          {withMatch.length > 0 ? 'Suas próximas partidas' : 'Seus próximos campeonatos'}
        </h2>
        <Link href="/minha-conta/campeonatos" aria-label="Ver todos os meus campeonatos" className="flex min-h-11 items-center gap-1 text-sm font-semibold text-primary-text underline-offset-2 hover:underline">
          Ver todos
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
      {entries.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Carregando seus campeonatos">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="hidden h-40 w-full md:block" />
        </div>
      ) : entries.isError ? (
        <ErrorState title="Não foi possível carregar seus campeonatos" description={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {current.slice(0, MAX_ON_HOME).map((entry) => (
            <li key={entry.registration.id}>
              <RegistrationEntryCard entry={entry} viewerId={user.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
