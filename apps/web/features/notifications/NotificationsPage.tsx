'use client';

import { Button, Card, EmptyState, ErrorState, Skeleton, cn } from '@nova/ui';
import { BellOff, CheckCheck, Settings } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMarkAllNotificationsRead, useNotifications, useUnreadCount } from '@/shared/api/hooks/notifications';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { messages } from './messages';
import { NotificationItem } from './NotificationItem';
import { useOpenNotification } from './useOpenNotification';

type Filter = 'all' | 'unread';
const FILTERS: { value: Filter; label: 'filtroTodas' | 'filtroNaoLidas' }[] = [
  { value: 'all', label: 'filtroTodas' },
  { value: 'unread', label: 'filtroNaoLidas' },
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
  const t = useT(messages, 'NotificationsPage');

  return (
    <PageContainer narrow>
      <PageHeader
        title={t('titulo')}
        description={t('descricao', { count: unreadCount })}
        actions={
          <>
            <Button variant="secondary" size="sm" disabled={unreadCount === 0} loading={markAll.isPending} iconLeft={<CheckCheck className="size-4" aria-hidden />} onClick={() => markAll.mutate()}>
              {t('marcarTodas')}
            </Button>
            <Button asChild variant="ghost" size="sm" iconLeft={<Settings className="size-4" aria-hidden />}>
              <Link href="/minha-conta/notificacoes">{t('preferencias')}</Link>
            </Button>
          </>
        }
      />

      <div role="group" aria-label={t('filtrar')} className="flex gap-2">
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
            {t(f.label)}
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Card padding="sm" role="status" aria-label={t('carregando')}>
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
        <ErrorState title={t('erro')} description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        filter === 'unread' ? (
          <EmptyState
            icon={<CheckCheck className="size-7" />}
            title={t('tudoLidoTitulo')}
            description={t('tudoLidoDescricao')}
            action={
              <Button variant="secondary" onClick={() => setFilter('all')}>
                {t('verTodas')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<BellOff className="size-7" />}
            title={t('vazioTitulo')}
            description={t('vazioDescricao')}
            action={
              <Button asChild>
                <Link href="/campeonatos?status=open">{t('verAbertos')}</Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <Card padding="none">
            <ul className="flex flex-col divide-y divide-border p-1" aria-label={filter === 'unread' ? t('listaNaoLidas') : t('listaTodas')}>
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationItem notification={n} onOpen={openNotification} />
                </li>
              ))}
            </ul>
          </Card>
          {list.hasNextPage && (
            <Button variant="secondary" className="self-center" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {t('carregarMais')}
            </Button>
          )}
        </>
      )}
    </PageContainer>
  );
}
