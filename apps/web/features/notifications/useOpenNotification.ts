'use client';

import type { Notification } from '@nova/schemas';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { useMarkNotificationRead } from '@/shared/api/hooks/notifications';

/** Só navega para caminhos internos do site (o `link` vem do servidor, mas nunca vira redirecionamento para fora). */
export function isInternalLink(link: string | null): link is string {
  return typeof link === 'string' && link.startsWith('/') && !link.startsWith('//');
}

/** Abrir uma notificação: marca como lida (se ainda não estava) e leva ao `link`. */
export function useOpenNotification(onNavigate?: () => void) {
  const router = useRouter();
  const { mutate } = useMarkNotificationRead();
  return useCallback(
    (n: Notification) => {
      if (n.readAt === null) mutate(n.id);
      if (isInternalLink(n.link)) {
        onNavigate?.();
        router.push(n.link);
      }
    },
    [mutate, onNavigate, router],
  );
}
