'use client';

import { cn } from '@nova/ui';
import { Gamepad2, Home, Medal, Trophy, User } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NotificationBell } from '@/features/notifications/LazyNotificationBell';
import { useFlag } from '../flags/useFlag';
import { sharedMessages } from '../i18n/messages';
import { useT } from '../i18n/react';
import { useSession } from '../session/useSession';
import { ThemeToggle } from '../theme/ThemeToggle';
import { Logo } from './Logo';
import { SiteFooter } from './SiteFooter';
import { UnreadAnnouncer } from './UnreadAnnouncer';
import { SiteBanner } from './SiteBanner';
import { UserMenu } from './UserMenu';

const allNav = [
  { href: '/campeonatos', label: 'campeonatos', icon: Trophy },
  { href: '/jogos', label: 'jogos', icon: Gamepad2 },
  { href: '/ranking', label: 'ranking', icon: Medal },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/campeonatos') return pathname.startsWith('/campeonatos') || pathname.startsWith('/c/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Casca das áreas pública e do participante: header no desktop, barra inferior no celular. */
export function SiteShell({ children }: { children: ReactNode }) {
  const t = useT(sharedMessages, 'SiteShell');
  const pathname = usePathname();
  const { user } = useSession();
  // O ranking pode ser desligado nas configurações do site (flag `ranking`).
  const rankingOn = useFlag('ranking');
  const nav = allNav.filter((n) => n.href !== '/ranking' || rankingOn).map((n) => ({ ...n, label: t(`nav.${n.label}`) }));
  const bottom = [{ href: '/', label: t('nav.inicio'), icon: Home }, ...nav, { href: user ? '/minha-conta' : '/entrar', label: user ? t('nav.conta') : t('nav.entrar'), icon: User }];

  return (
    // Celular: espaço embaixo para a barra inferior fixa (56 px + área segura), para o rodapé não ficar escondido.
    <div className="flex min-h-dvh flex-col px-safe pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:pb-0" data-area="participant">
      <SiteBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 pt-safe backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-2 px-4 md:h-16 md:px-6 lg:gap-4">
          <Logo />
          <nav aria-label={t('principal')} className="hidden items-center gap-1 md:ml-1 md:flex lg:ml-4">
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

      <UnreadAnnouncer />
      {/* No mínimo a altura da tela (#111, CLS): o rodapé sempre começa abaixo da dobra. Sem isso, quando os esqueletos
          dão lugar a uma lista mais curta, o rodapé sobe para dentro da tela e o Lighthouse conta como deslocamento. */}
      <div className="min-h-dvh flex-1">{children}</div>

      <SiteFooter />

      <nav aria-label={t('principal')} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-safe pb-safe md:hidden">
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
