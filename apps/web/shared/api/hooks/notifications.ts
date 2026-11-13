'use client';

/**
 * Hooks de notificações (F2.10): contador do sino, lista, leitura e preferências.
 * O evento `notification.created` (canal `user:{id}`) já invalida `keys.notifications.all`
 * em `shared/realtime`; aqui só entra o polling de reserva para quando o tempo real cai.
 */
import { Notification, NotificationPreference, page, UnreadCount, type Page } from '@nova/schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { z } from 'zod';
import { useLiveRefetchInterval } from '../../realtime/RealtimeProvider';
import { api } from '../client';
import { keys } from '../keys';

const NotificationPage = page(Notification);
const Preferences = z.array(NotificationPreference);
export type NotificationPage = Page<Notification>;

/** Quantas notificações não lidas. Só consulta com alguém logado. */
export function useUnreadCount(enabled = true) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.notifications.unread,
    queryFn: ({ signal }) => api.get('/notifications/unread-count', { schema: UnreadCount, signal }),
    enabled,
    refetchInterval,
    select: (data) => data.count,
  });
}

/** As notificações mais recentes, para o painel do sino. */
export function useRecentNotifications(limit = 6, enabled = true) {
  return useQuery({
    queryKey: keys.notifications.list({ recent: limit }),
    queryFn: ({ signal }) => api.get('/notifications', { schema: NotificationPage, signal, query: { limit } }),
    enabled,
    select: (data) => data.items,
  });
}

/** Lista completa, paginada por cursor ("carregar mais"). `unread` filtra só as não lidas. */
export function useNotifications(opts: { unread?: boolean } = {}) {
  const unread = Boolean(opts.unread);
  return useInfiniteQuery({
    queryKey: keys.notifications.list({ unread }),
    queryFn: ({ pageParam, signal }) => api.get('/notifications', { schema: NotificationPage, signal, query: { cursor: pageParam, unread: unread ? 1 : undefined } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Marca uma notificação como lida. Atualiza o contador e as listas na hora, sem esperar a resposta. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, undefined, { schema: Notification }),
    onMutate: (id) => {
      const at = new Date().toISOString();
      let wasUnread = false;
      const mark = (n: Notification): Notification => {
        if (n.id !== id || n.readAt !== null) return n;
        wasUnread = true;
        return { ...n, readAt: at };
      };
      qc.setQueriesData<NotificationPage | InfiniteData<NotificationPage>>({ queryKey: ['notifications', 'list'] }, (data) => {
        if (!data) return data;
        if ('pages' in data) return { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(mark) })) };
        return { ...data, items: data.items.map(mark) };
      });
      if (wasUnread) qc.setQueryData<z.infer<typeof UnreadCount>>(keys.notifications.unread, (c) => (c ? { count: Math.max(0, c.count - 1) } : c));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all', undefined, { schema: UnreadCount }),
    onSuccess: (count) => {
      qc.setQueryData(keys.notifications.unread, count);
      return qc.invalidateQueries({ queryKey: keys.notifications.all });
    },
  });
}

/** Preferências por tipo: uma linha por tipo, com os canais "no site" e "e-mail". */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: keys.notifications.preferences,
    queryFn: ({ signal }) => api.get('/me/notification-preferences', { schema: Preferences, signal }),
  });
}

export function useSaveNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (preferences: NotificationPreference[]) => api.put('/me/notification-preferences', { preferences }, { schema: Preferences }),
    onSuccess: (saved) => qc.setQueryData(keys.notifications.preferences, saved),
  });
}
