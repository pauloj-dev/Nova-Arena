'use client';

import { cn } from '@nova/ui';
import { Gamepad2, Home, Medal, Trophy, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useFlag } from '../flags/useFlag';
import { useSession } from '../session/useSession';
import { ThemeToggle } from '../theme/ThemeToggle';
import { Logo } from './Logo';
import { SiteFooter } from './SiteFooter';
import { SiteBanner } from './SiteBanner';
import { UserMenu } from './UserMenu';

const allNav = [
  { href: '/campeonatos', label: 'Campeonatos', icon: Trophy },
  { href: '/jogos', label: 'Jogos', icon: Gamepad2 },
  { href: '/ranking', label: 'Ranking', icon: Medal },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/campeonatos') return pathname.startsWith('/campeonatos') || pathname.startsWith('/c/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Casca das áreas pública e do participante: header no desktop, barra inferior no celular. */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  // O ranking pode ser desligado nas configurações do site (flag `ranking`).
  const rankingOn = useFlag('ranking');
  const nav = allNav.filter((n) => n.href !== '/ranking' || rankingOn);
  const bottom = [{ href: '/', label: 'Início', icon: Home }, ...nav, { href: user ? '/minha-conta' : '/entrar', label: user ? 'Conta' : 'Entrar', icon: User }];

  return (
    // Celular: espaço embaixo para a barra inferior fixa (56 px + área segura), para o rodapé não ficar escondido.
    <div className="flex min-h-dvh flex-col px-safe pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0" data-area="participant">
      <SiteBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 pt-safe backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 md:h-16 md:px-6 lg:gap-4">
          <Logo />
          <nav aria-label="Principal" className="hidden items-center gap-1 md:ml-1 md:flex lg:ml-4">
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(pathname, n.href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-muted hover:bg-neutral-soft hover:text-text lg:px-3',
                  isActive(pathname, n.href) && 'bg-accent-soft text-accent-soft-text',
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            {user && <NotificationBell />}
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <SiteFooter />

      <nav aria-label="Principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-safe pb-safe md:hidden">
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${bottom.length}, minmax(0, 1fr))` }}>
          {bottom.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted', active && 'text-primary-text')}
                >
                  <n.icon className="size-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
