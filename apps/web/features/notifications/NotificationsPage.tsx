'use client';

import { Button, Card, EmptyState, ErrorState, Skeleton, cn } from '@nova/ui';
import { BellOff, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMarkAllNotificationsRead, useNotifications, useUnreadCount } from '@/shared/api/hooks/notifications';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { NotificationItem } from './NotificationItem';
import { useOpenNotification } from './useOpenNotification';

type Filter = 'all' | 'unread';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
];

/** `/notificacoes`: lista completa, com filtro de não lidas e "carregar mais". */
export function NotificationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const list = useNotifications({ unread: filter === 'unread' });
  const unread = useUnreadCount();
  const markAll = useMarkAllNotificationsRead();
  const openNotification = useOpenNotification();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = unread.data ?? 0;

  return (
    <PageContainer narrow>
      <PageHeader
        title="Notificações"
        description={unreadCount === 0 ? 'Você está em dia: nenhuma notificação por ler.' : unreadCount === 1 ? '1 notificação não lida.' : `${unreadCount} notificações não lidas.`}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={unreadCount === 0} loading={markAll.isPending} iconLeft={<CheckCheck className="size-4" aria-hidden />} onClick={() => markAll.mutate()}>
              Marcar todas como lidas
            </Button>
            <Button asChild variant="ghost" size="sm" iconLeft={<Settings className="size-4" aria-hidden />}>
              <Link href="/minha-conta/notificacoes">Preferências</Link>
            </Button>
          </>
        }
      />

      <div role="group" aria-label="Filtrar notificações" className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
              filter === f.value ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-border-strong bg-surface text-muted hover:text-text',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Card padding="sm" role="status" aria-label="Carregando notificações">
          <div className="flex flex-col gap-4 p-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : list.isError ? (
        <ErrorState title="Não foi possível carregar as notificações" description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState
            icon={<CheckCheck className="size-7" />}
            title="Tudo lido"
            description="Você não tem notificações por ler."
            action={
              <Button variant="secondary" onClick={() => setFilter('all')}>
                Ver todas
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<BellOff className="size-7" />}
            title="Nenhuma notificação ainda"
            description="Quando você se inscrever em um campeonato, os avisos de check-in, partidas e resultados aparecem aqui."
            action={
              <Button asChild>
                <Link href="/campeonatos?status=open">Ver campeonatos abertos</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <Card padding="none">
            <ul className="flex flex-col divide-y divide-border p-1" aria-label={filter === 'unread' ? 'Notificações não lidas' : 'Todas as notificações'}>
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} onOpen={openNotification} />
                </li>
              ))}
            </ul>
          </Card>
          {list.hasNextPage && (
            <Button variant="secondary" className="self-center" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              Carregar mais
            </Button>
          )}
        </>
      )}
    </PageContainer>
  );
}
