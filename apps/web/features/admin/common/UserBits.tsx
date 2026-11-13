import type { AdminUser, Role, UserStatus } from '@nova/schemas';
import { Avatar, Badge, StatusPill } from '@nova/ui';
import { BadgeCheck, Crown, Merge, Shield, Target, Trash2 } from 'lucide-react';
import { ROLE_LABELS, USER_STATUS_LABELS } from './format';

/** Avatar + apelido + e-mail, para tabelas e cartões. */
export function UserIdentity({ user, size = 'md' }: { user: Pick<AdminUser, 'nickname' | 'email' | 'avatarUrl'> & { verifiedOrganizer?: boolean }; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={user.nickname} src={user.avatarUrl} size={size} />
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 font-semibold text-text">
          <span className="truncate">{user.nickname}</span>
          {user.verifiedOrganizer && (
            <BadgeCheck className="size-4 shrink-0 text-primary-text" aria-label="Organizador verificado" role="img" />
          )}
        </span>
        <span className="truncate text-xs font-normal text-muted">{user.email}</span>
      </span>
    </span>
  );
}

const ROLE_ICON: Partial<Record<Role, typeof Shield>> = { SUPER_ADMIN: Crown, ADMIN: Shield, ORGANIZER: Target };

/** Papéis além de "Participante" (que todo mundo tem). Sem papel extra, mostra "Participante". */
export function RoleBadges({ roles }: { roles: Role[] }) {
  const shown = roles.filter((r) => r !== 'PARTICIPANT' && !(r === 'ADMIN' && roles.includes('SUPER_ADMIN')));
  if (shown.length === 0) return <span className="text-sm text-muted">{ROLE_LABELS.PARTICIPANT}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((role) => {
        const Icon = ROLE_ICON[role];
        return (
          <Badge key={role} tone={role === 'SUPER_ADMIN' ? 'gold' : role === 'ADMIN' ? 'accent' : 'info'} icon={Icon ? <Icon className="size-3.5" aria-hidden /> : undefined}>
            {ROLE_LABELS[role]}
          </Badge>
        );
      })}
    </span>
  );
}

/** Status da conta, sempre com ícone e texto. */
export function UserStatusPill({ status }: { status: UserStatus }) {
  if (status === 'ACTIVE' || status === 'SUSPENDED' || status === 'BANNED') return <StatusPill status={status} />;
  return (
    <Badge tone="neutral" icon={status === 'MERGED' ? <Merge className="size-3.5" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}>
      {USER_STATUS_LABELS[status]}
    </Badge>
  );
}
