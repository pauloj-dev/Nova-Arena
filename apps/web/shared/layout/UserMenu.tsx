'use client';

import { Avatar, Button } from '@nova/ui';
import { DropdownMenu } from 'radix-ui';
import { ChevronDown, LayoutDashboard, LogOut, Shield, Swords, Trophy, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { isAdminUser, isOrganizerUser, useLogout, useSession } from '../session/useSession';

const item = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-text outline-none data-[highlighted]:bg-neutral-soft';

/** Menu da conta: atalhos, troca de área (para quem tem mais de um papel) e sair. */
export function UserMenu() {
  const { user, isLoading } = useSession();
  const logout = useLogout();
  const router = useRouter();
  const pathname = usePathname();

  if (isLoading) return <div className="size-9 rounded-full bg-neutral-soft" aria-hidden />;
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="hidden xs:inline-flex">
          <Link href={`/entrar?next=${encodeURIComponent(pathname)}`}>Entrar</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/cadastro">Criar conta</Link>
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="flex min-h-11 items-center gap-2 rounded-full pl-1 pr-2 text-inherit hover:bg-neutral-soft/40" aria-label={`Conta de ${user.nickname}`}>
          <Avatar name={user.nickname} src={user.avatarUrl} size="md" />
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="z-50 w-64 rounded-lg border border-border bg-surface p-2 text-text shadow-lg">
          <div className="px-3 py-2">
            <p className="font-semibold">{user.nickname}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={item}>
            <Link href="/minha-conta">
              <User className="size-4" aria-hidden /> Minha conta
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link href="/minha-conta/campeonatos">
              <Trophy className="size-4" aria-hidden /> Meus campeonatos
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}>
            <Link href="/minha-conta/squads">
              <Users className="size-4" aria-hidden /> Meus squads
            </Link>
          </DropdownMenu.Item>
          {(isOrganizerUser(user) || isAdminUser(user)) && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Trocar de área</DropdownMenu.Label>
              <DropdownMenu.Item asChild className={item}>
                <Link href="/">
                  <Swords className="size-4" aria-hidden /> Participante
                </Link>
              </DropdownMenu.Item>
              {isOrganizerUser(user) && (
                <DropdownMenu.Item asChild className={item}>
                  <Link href="/organizador">
                    <LayoutDashboard className="size-4" aria-hidden /> Organização
                  </Link>
                </DropdownMenu.Item>
              )}
              {isAdminUser(user) && (
                <DropdownMenu.Item asChild className={item}>
                  <Link href="/admin">
                    <Shield className="size-4" aria-hidden /> Administração
                  </Link>
                </DropdownMenu.Item>
              )}
            </>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={item}
            onSelect={() => {
              logout.mutate(undefined, { onSuccess: () => router.push('/') });
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sair
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
