'use client';

import type { Notification, NotificationType } from '@nova/schemas';
import { cn } from '@nova/ui';
import { AlertTriangle, Bell, CalendarCheck, CheckCircle2, Clock, Megaphone, Scale, ShieldAlert, Trophy, Users, XCircle, type LucideIcon } from 'lucide-react';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';

const ICONS: Record<NotificationType, LucideIcon> = {
  REGISTRATION_CONFIRMED: CheckCircle2,
  TEAM_INVITE: Users,
  CHECKIN_OPEN: CalendarCheck,
  MATCH_SOON: Clock,
  RESULT_POSTED: Trophy,
  QUALIFIED: Trophy,
  ELIMINATED: XCircle,
  ANNOUNCEMENT: Megaphone,
  ORGANIZER_REQUEST_RESULT: Bell,
  DISPUTE_UPDATE: Scale,
  SANCTION: ShieldAlert,
};

export interface NotificationItemProps {
  notification: Notification;
  /** Chamado ao tocar: quem usa marca como lida e navega até o `link`. */
  onOpen: (notification: Notification) => void;
  /** `compact`: painel do sino (corpo em até 2 linhas). */
  compact?: boolean;
}

/** Uma notificação: ícone do tipo, título, corpo, tempo relativo e marca de "não lida" (ponto + texto para leitor de tela). */
export function NotificationItem({ notification: n, onOpen, compact }: NotificationItemProps) {
  const Icon = ICONS[n.type] ?? AlertTriangle;
  const unread = n.readAt === null;
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn('flex w-full items-start gap-3 rounded-md px-3 py-3 text-left hover:bg-neutral-soft', unread && 'bg-primary-soft/40')}
      data-unread={unread || undefined}
    >
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', unread ? 'bg-primary-soft text-primary-soft-text' : 'bg-neutral-soft text-neutral-soft-text')} aria-hidden>
        <Icon className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-sm text-text [overflow-wrap:anywhere]', unread ? 'font-semibold' : 'font-medium')}>{n.title}</span>
        <span className={cn('text-sm text-muted [overflow-wrap:anywhere]', compact && 'line-clamp-2')}>{n.body}</span>
        <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)} className="text-xs text-muted">
          {formatRelative(n.createdAt)}
        </time>
      </span>
      {unread && (
        <span className="mt-1.5 flex shrink-0 items-center">
          <span className="size-2.5 rounded-full bg-primary-500" aria-hidden />
          <span className="sr-only">Não lida</span>
        </span>
      )}
    </button>
  );
}
