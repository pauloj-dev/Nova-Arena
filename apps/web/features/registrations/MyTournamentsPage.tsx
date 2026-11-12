'use client';

import type { MyTournamentEntry } from '@nova/schemas';
import { Button, EmptyState, ErrorState, Skeleton, Tabs } from '@nova/ui';
import { History, Trophy } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMyRegistrations } from '@/shared/api/hooks/registrations';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { isCurrentEntry } from './lib/rules';
import { RegistrationEntryCard } from './RegistrationEntryCard';

const explore = (
  <Button asChild>
    <Link href="/campeonatos">Explorar campeonatos</Link>
  </Button>
);

function EntryList({ entries, viewerId, empty }: { entries: MyTournamentEntry[]; viewerId: string | null; empty: ReactNode }) {
  if (entries.length === 0) return <>{empty}</>;
  return (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry) => (
        <li key={entry.registration.id}>
          <RegistrationEntryCard entry={entry} viewerId={viewerId} />
        </li>
      ))}
    </ul>
  );
}

/** `/minha-conta/campeonatos`: minhas inscrições, separadas em atuais e histórico. */
export function MyTournamentsPage() {
  const { user } = useSession();
  const entries = useMyRegistrations({ enabled: Boolean(user) });
  const viewerId = user?.id ?? null;

  return (
    <PageContainer>
      <PageHeader title="Meus campeonatos" description="Suas inscrições, o que falta resolver em cada uma e o histórico do que você já jogou." />
      {entries.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Carregando seus campeonatos">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="hidden h-40 w-full xl:block" />
        </div>
      ) : entries.isError ? (
        <ErrorState title="Não foi possível carregar seus campeonatos" description={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
      ) : (
        <Tabs
          label="Meus campeonatos"
          items={[
            {
              value: 'atuais',
              label: 'Em andamento e próximos',
              content: (
                <EntryList
                  entries={entries.data.filter(isCurrentEntry)}
                  viewerId={viewerId}
                  empty={
                    <EmptyState
                      icon={<Trophy className="size-7" />}
                      title="Você não está inscrito em nenhum campeonato"
                      description="Encontre um campeonato com inscrições abertas e garanta a sua vaga."
                      action={explore}
                    />
                  }
                />
              ),
            },
            {
              value: 'historico',
              label: 'Histórico',
              content: (
                <EntryList
                  entries={entries.data.filter((e) => !isCurrentEntry(e))}
                  viewerId={viewerId}
                  empty={
                    <EmptyState
                      icon={<History className="size-7" />}
                      title="Seu histórico ainda está vazio"
                      description="Os campeonatos que você terminar de jogar aparecem aqui, com a sua colocação."
                      action={explore}
                    />
                  }
                />
              ),
            },
          ]}
        />
      )}
    </PageContainer>
  );
}
