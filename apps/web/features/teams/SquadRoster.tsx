'use client';

import type { Team, TeamInvite, TeamMember } from '@nova/schemas';
import { Avatar, Badge, Button, StatusPill } from '@nova/ui';
import { ArrowLeftRight, Crown, Link2, LogOut, MoreVertical, UserMinus, UserRoundCheck, UserRoundCog, X } from 'lucide-react';
import Link from 'next/link';
import { DropdownMenu } from 'radix-ui';
import { formatDateTime, formatRelative } from '@/shared/lib/datetime';

const menuItem = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-text outline-none data-[highlighted]:bg-neutral-soft';

export interface SquadRosterProps {
  team: Team;
  /** Quem está vendo. Nulo = visitante. */
  viewerId: string | null;
  /** Ações do capitão e de quem quer sair. Sem elas, o elenco é só leitura. */
  onToggleSub?: (member: TeamMember) => void;
  onTransfer?: (member: TeamMember) => void;
  onRemove?: (member: TeamMember) => void;
  onLeave?: () => void;
  onRevokeInvite?: (invite: TeamInvite) => void;
  /** Convite sendo revogado agora (mostra o botão carregando). */
  revokingInviteId?: string | null;
}

/** Elenco do squad: capitão com a coroa, reservas, convites pendentes (só para o capitão) e as ações de cada membro. */
export function SquadRoster({ team, viewerId, onToggleSub, onTransfer, onRemove, onLeave, onRevokeInvite, revokingInviteId }: SquadRosterProps) {
  const isCaptain = viewerId !== null && viewerId === team.captainId;
  // Capitão primeiro, depois titulares, depois reservas; dentro de cada grupo, por ordem de entrada.
  const members = [...team.members].sort(
    (a, b) => Number(b.role === 'CAPTAIN') - Number(a.role === 'CAPTAIN') || Number(a.isSub) - Number(b.isSub) || a.joinedAt.localeCompare(b.joinedAt),
  );

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border" aria-label={`Membros do ${team.name}`}>
        {members.map((member) => {
          const isMe = member.userId === viewerId;
          const canManage = isCaptain && !isMe;
          return (
            <li key={member.userId} className="flex items-center gap-3 py-3">
              <Avatar name={member.nickname} src={member.avatarUrl} size="md" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Link href={`/u/${encodeURIComponent(member.nickname)}`} className="truncate font-semibold text-text hover:underline">
                  {member.nickname}
                  {isMe && <span className="font-normal text-muted"> (você)</span>}
                </Link>
                <div className="flex flex-wrap gap-1.5">
                  {member.role === 'CAPTAIN' && (
                    <Badge tone="gold" icon={<Crown className="size-3.5" aria-hidden />}>
                      Capitão
                    </Badge>
                  )}
                  {member.isSub ? <Badge tone="neutral">Reserva</Badge> : member.role !== 'CAPTAIN' && <Badge tone="accent">Titular</Badge>}
                </div>
              </div>

              {(canManage || (isCaptain && isMe && onToggleSub)) && (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger asChild>
                    <button type="button" aria-label={`Ações de ${member.nickname}`} className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text">
                      <MoreVertical className="size-5" aria-hidden />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-60 rounded-lg border border-border bg-surface p-2 text-text shadow-lg">
                      {onToggleSub && (
                        <DropdownMenu.Item className={menuItem} onSelect={() => onToggleSub(member)}>
                          {member.isSub ? <UserRoundCheck className="size-4" aria-hidden /> : <UserRoundCog className="size-4" aria-hidden />}
                          {member.isSub ? 'Tirar da reserva' : 'Marcar como reserva'}
                        </DropdownMenu.Item>
                      )}
                      {canManage && onTransfer && (
                        <DropdownMenu.Item className={menuItem} onSelect={() => onTransfer(member)}>
                          <ArrowLeftRight className="size-4" aria-hidden /> Passar a capitania
                        </DropdownMenu.Item>
                      )}
                      {canManage && onRemove && (
                        <DropdownMenu.Item className={`${menuItem} text-danger`} onSelect={() => onRemove(member)}>
                          <UserMinus className="size-4" aria-hidden /> Remover do squad
                        </DropdownMenu.Item>
                      )}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )}

              {isMe && !isCaptain && onLeave && (
                <Button variant="ghost" size="sm" iconLeft={<LogOut className="size-4" aria-hidden />} onClick={onLeave}>
                  Sair
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {isCaptain && team.pendingInvites.length > 0 && (
        <section aria-labelledby={`convites-${team.id}`} className="flex flex-col gap-1">
          <h3 id={`convites-${team.id}`} className="text-sm font-semibold uppercase tracking-wide text-muted">
            Convites pendentes
          </h3>
          <ul className="flex flex-col divide-y divide-border">
            {team.pendingInvites.map((invite) => (
              <li key={invite.id} className="flex items-center gap-3 py-3">
                {invite.invitedNickname ? (
                  <Avatar name={invite.invitedNickname} size="md" className="opacity-70" />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted" aria-hidden>
                    <Link2 className="size-4" />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {invite.invitedNickname ? (
                    <p className="truncate font-semibold text-text">{invite.invitedNickname}</p>
                  ) : (
                    <p className="flex flex-wrap gap-x-1.5 font-semibold text-text">
                      Link de convite <span className="tabular">{invite.code}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusPill status="PENDING" label={invite.invitedNickname ? 'Aguardando resposta' : 'Link ativo'} />
                    <span className="text-xs text-muted" title={formatDateTime(invite.expiresAt)}>
                      Expira {formatRelative(invite.expiresAt)} ({formatDateTime(invite.expiresAt)})
                    </span>
                  </div>
                </div>
                {onRevokeInvite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={revokingInviteId === invite.id}
                    iconLeft={<X className="size-4" aria-hidden />}
                    aria-label={invite.invitedNickname ? `Cancelar o convite de ${invite.invitedNickname}` : `Cancelar o link de convite ${invite.code}`}
                    onClick={() => onRevokeInvite(invite)}
                  >
                    Cancelar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
