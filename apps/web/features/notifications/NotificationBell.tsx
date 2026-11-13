'use client';

import { Button, ErrorState, Skeleton } from '@nova/ui';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Popover } from 'radix-ui';
import { useCallback, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMarkAllNotificationsRead, useRecentNotifications, useUnreadCount } from '@/shared/api/hooks/notifications';
import { useSession } from '@/shared/session/useSession';
import { NotificationItem } from './NotificationItem';
import { useOpenNotification } from './useOpenNotification';

const PANEL_SIZE = 6;

/** Texto do contador no selo: acima de 99 vira "99+". */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Nome acessível do sino: "Notificações, 3 não lidas". */
export function bellLabel(count: number): string {
  if (count <= 0) return 'Notificações';
  return count === 1 ? 'Notificações, 1 não lida' : `Notificações, ${count} não lidas`;
}

/**
 * Sino de notificações: contador de não lidas (some quando zero) e painel com as mais recentes.
 * O contador se atualiza sozinho: o evento `notification.created` do canal do usuário invalida
 * as consultas de notificações (em `shared/realtime`).
 */
export function NotificationBell() {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount(Boolean(user));
  const count = unread.data ?? 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={bellLabel(count)} className="relative flex size-11 items-center justify-center rounded-md text-inherit hover:bg-neutral-soft/40">
          <Bell className="size-5" aria-hidden />
          {count > 0 && (
            <span data-testid="notification-count" aria-hidden className="tabular absolute right-1 top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-danger px-1 text-[0.6875rem] font-bold leading-none text-on-accent">
              {badgeText(count)}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Notificações"
          className="z-50 flex max-h-[min(32rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col rounded-lg border border-border bg-surface text-text shadow-lg animate-fade-in"
        >
          {open && <BellPanel unreadCount={count} onClose={() => setOpen(false)} />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BellPanel({ unreadCount, onClose }: { unreadCount: number; onClose: () => void }) {
  const recent = useRecentNotifications(PANEL_SIZE);
  const markAll = useMarkAllNotificationsRead();
  const close = useCallback(() => onClose(), [onClose]);
  const openNotification = useOpenNotification(close);

  return (
    <>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="font-display text-base font-bold">Notificações</h2>
        <Button variant="ghost" size="sm" disabled={unreadCount === 0} loading={markAll.isPending} iconLeft={<CheckCheck className="size-4" aria-hidden />} onClick={() => markAll.mutate()}>
          Marcar todas como lidas
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {recent.isPending ? (
          <div className="flex flex-col gap-2 p-3" role="status" aria-label="Carregando notificações">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : recent.isError ? (
          <ErrorState className="m-2 border-0 px-4 py-6" title="Não foi possível carregar as notificações" description={errorMessage(recent.error)} onRetry={() => void recent.refetch()} />
        ) : recent.data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <BellOff className="size-6 text-muted" aria-hidden />
            <p className="text-sm font-semibold">Nenhuma notificação por aqui</p>
            <p className="text-sm text-muted">Avisos de inscrição, check-in e resultados aparecem neste painel.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recent.data.map((n) => (
              <li key={n.id}>
                <NotificationItem notification={n} onOpen={openNotification} compact />
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="border-t border-border p-2">
        <Link href="/notificacoes" onClick={onClose} className="flex min-h-11 items-center justify-center rounded-md text-sm font-semibold text-primary-text hover:bg-neutral-soft">
          Ver todas
        </Link>
      </footer>
    </>
  );
}
