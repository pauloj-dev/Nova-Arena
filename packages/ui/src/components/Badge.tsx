import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  Clock,
  Flag,
  Hourglass,
  Lock,
  PauseCircle,
  PencilLine,
  Radio,
  Trophy,
  UserX,
  XCircle,
  Archive,
  type LucideIcon,
} from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'primary' | 'info' | 'warning' | 'danger' | 'gold' | 'accent';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-soft-text',
  primary: 'bg-primary-soft text-primary-soft-text',
  accent: 'bg-accent-soft text-accent-soft-text',
  info: 'bg-info-soft text-info-soft-text',
  warning: 'bg-warning-soft text-warning-soft-text',
  danger: 'bg-danger-soft text-danger-soft-text',
  gold: 'bg-gold-soft text-gold-soft-text',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/** Todos os status do produto. Sempre ícone + texto: nunca só cor (PRD §15.1, princípio 6). */
export type Status =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'CHECK_IN'
  | 'IN_PROGRESS'
  | 'LIVE'
  | 'PAUSED'
  | 'FINISHED'
  | 'ARCHIVED'
  | 'CANCELLED'
  | 'SCHEDULED'
  | 'AWAITING_VALIDATION'
  | 'VALIDATED'
  | 'DISPUTED'
  | 'WALKOVER'
  | 'PENDING'
  | 'PENDING_MEMBERS'
  | 'PENDING_APPROVAL'
  | 'CONFIRMED'
  | 'WAITLIST'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'DISQUALIFIED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'SUSPENDED'
  | 'BANNED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'REVOKED'
  | 'OPEN'
  | 'IN_REVIEW'
  | 'ESCALATED'
  | 'RESOLVED'
  | 'APPROVED';

const statusMap: Record<Status, { label: string; tone: BadgeTone; icon: LucideIcon; live?: boolean }> = {
  DRAFT: { label: 'Rascunho', tone: 'neutral', icon: PencilLine },
  PUBLISHED: { label: 'Publicado', tone: 'info', icon: CalendarClock },
  REGISTRATION_OPEN: { label: 'Inscrições abertas', tone: 'info', icon: ClipboardCheck },
  REGISTRATION_CLOSED: { label: 'Inscrições encerradas', tone: 'neutral', icon: Lock },
  CHECK_IN: { label: 'Check-in', tone: 'warning', icon: Clock },
  IN_PROGRESS: { label: 'Em andamento', tone: 'primary', icon: Radio, live: true },
  LIVE: { label: 'Ao vivo', tone: 'primary', icon: Radio, live: true },
  PAUSED: { label: 'Pausado', tone: 'warning', icon: PauseCircle },
  FINISHED: { label: 'Finalizado', tone: 'neutral', icon: Trophy },
  ARCHIVED: { label: 'Arquivado', tone: 'neutral', icon: Archive },
  CANCELLED: { label: 'Cancelado', tone: 'danger', icon: XCircle },
  SCHEDULED: { label: 'Agendada', tone: 'info', icon: CalendarClock },
  AWAITING_VALIDATION: { label: 'Aguardando validação', tone: 'warning', icon: Hourglass },
  VALIDATED: { label: 'Concluída', tone: 'primary', icon: CheckCircle2 },
  DISPUTED: { label: 'Em disputa', tone: 'warning', icon: AlertTriangle },
  WALKOVER: { label: 'W.O.', tone: 'danger', icon: UserX },
  PENDING: { label: 'Pendente', tone: 'warning', icon: Hourglass },
  PENDING_MEMBERS: { label: 'Aguardando membros', tone: 'warning', icon: Hourglass },
  PENDING_APPROVAL: { label: 'Aguardando aprovação', tone: 'warning', icon: Hourglass },
  CONFIRMED: { label: 'Confirmada', tone: 'primary', icon: CheckCircle2 },
  WAITLIST: { label: 'Lista de espera', tone: 'info', icon: Clock },
  REJECTED: { label: 'Recusada', tone: 'danger', icon: XCircle },
  WITHDRAWN: { label: 'Desistência', tone: 'neutral', icon: Flag },
  DISQUALIFIED: { label: 'Desclassificado', tone: 'danger', icon: UserX },
  ACTIVE: { label: 'Ativo', tone: 'primary', icon: CircleDot },
  COMPLETED: { label: 'Concluída', tone: 'neutral', icon: CheckCircle2 },
  SUSPENDED: { label: 'Suspenso', tone: 'warning', icon: PauseCircle },
  BANNED: { label: 'Banido', tone: 'danger', icon: UserX },
  ACCEPTED: { label: 'Aceito', tone: 'primary', icon: CheckCircle2 },
  DECLINED: { label: 'Recusado', tone: 'danger', icon: XCircle },
  EXPIRED: { label: 'Expirado', tone: 'neutral', icon: Clock },
  REVOKED: { label: 'Revogado', tone: 'danger', icon: XCircle },
  OPEN: { label: 'Aberta', tone: 'warning', icon: AlertTriangle },
  IN_REVIEW: { label: 'Em análise', tone: 'info', icon: Hourglass },
  ESCALATED: { label: 'Escalada', tone: 'danger', icon: AlertTriangle },
  RESOLVED: { label: 'Resolvida', tone: 'primary', icon: CheckCircle2 },
  APPROVED: { label: 'Aprovado', tone: 'primary', icon: CheckCircle2 },
};

export function statusLabel(status: Status): string {
  return statusMap[status].label;
}

export interface StatusPillProps {
  status: Status;
  /** Troca o texto padrão (ex.: "Concluída" → "Aprovada"). */
  label?: string;
  className?: string;
}

export function StatusPill({ status, label, className }: StatusPillProps) {
  const s = statusMap[status];
  const Icon = s.icon;
  return (
    <Badge
      tone={s.tone}
      className={className}
      icon={
        s.live ? (
          <span className="size-2 rounded-full bg-primary-500 animate-pulse-live" aria-hidden />
        ) : (
          <Icon className="size-3.5" aria-hidden />
        )
      }
    >
      {label ?? s.label}
    </Badge>
  );
}
