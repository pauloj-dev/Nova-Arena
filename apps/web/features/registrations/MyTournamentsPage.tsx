'use client';

import type { MyTournamentEntry } from '@nova/schemas';
import { Button, EmptyState, ErrorState, Skeleton, Tabs } from '@nova/ui';
import { History, Trophy } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CalendarExport } from '@/features/calendar/CalendarExport';
import { errorMessage } from '@/shared/api/client';
import { useMyRegistrations } from '@/shared/api/hooks/registrations';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { isCurrentEntry } from './lib/rules';
import { messages } from './messages';
import { RegistrationEntryCard } from './RegistrationEntryCard';

function Explore() {
  const t = useT(messages, 'MyTournamentsPage');
  return (
    <Button asChild>
      <Link href="/campeonatos">{t('explorar')}</Link>
    </Button>
  );
}

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
  const t = useT(messages, 'MyTournamentsPage');

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} actions={user ? <CalendarExport scope={{ kind: 'mine' }} /> : undefined} />
      {entries.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="hidden h-40 w-full xl:block" />
        </div>
      ) : entries.isError ? (
        <ErrorState title={t('erroCarregar')} description={errorMessage(entries.error)} onRetry={() => void entries.refetch()} />
      ) : (
        <Tabs
          label={t('titulo')}
          items={[
            {
              value: 'atuais',
              label: t('abaAtuais'),
              content: (
                <EntryList
                  entries={entries.data.filter(isCurrentEntry)}
                  viewerId={viewerId}
                  empty={
                    <EmptyState
                      icon={<Trophy className="size-7" />}
                      title={t('atuaisVazioTitulo')}
                      description={t('atuaisVazioDescricao')}
                      action={<Explore />}
                    />
                  }
                />
              ),
            },
            {
              value: 'historico',
              label: t('abaHistorico'),
              content: (
                <EntryList
                  entries={entries.data.filter((e) => !isCurrentEntry(e))}
                  viewerId={viewerId}
                  empty={
                    <EmptyState
                      icon={<History className="size-7" />}
                      title={t('historicoVazioTitulo')}
                      description={t('historicoVazioDescricao')}
                      action={<Explore />}
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
