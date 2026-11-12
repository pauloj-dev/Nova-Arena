import type { Registration } from '@nova/schemas';
import { Avatar, Badge } from '@nova/ui';
import { CheckCircle2, Crown, Hourglass, IdCard } from 'lucide-react';

/** Elenco do squad naquele campeonato: quem já confirmou e quem falta. */
export function RegistrationMembers({ registration, viewerId }: { registration: Registration; viewerId: string | null }) {
  const members = [...registration.members].sort((a, b) => Number(b.isCaptain) - Number(a.isCaptain) || Number(a.isSub) - Number(b.isSub));
  return (
    <ul className="flex flex-col divide-y divide-border" aria-label={`Elenco do ${registration.displayName}`}>
      {members.map((m) => (
        <li key={m.userId} className="flex items-center gap-3 py-2">
          <Avatar name={m.nickname} src={m.avatarUrl} size="sm" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">
              {m.nickname}
              {m.userId === viewerId && <span className="font-normal text-muted"> (você)</span>}
            </span>
            {m.isCaptain && (
              <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
                Capitão
              </Badge>
            )}
            {m.isSub && <Badge tone="neutral">Reserva</Badge>}
            {!m.hasGameAccount && (
              <Badge tone="warning" icon={<IdCard className="size-3.5" aria-hidden />}>
                Sem ID do jogo
              </Badge>
            )}
          </div>
          {m.confirmedAt ? (
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-text">
              <CheckCircle2 className="size-4" aria-hidden /> Confirmou
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted">
              <Hourglass className="size-4" aria-hidden /> Falta confirmar
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
