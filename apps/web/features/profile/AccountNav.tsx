'use client';

import { cn } from '@nova/ui';
import { Bell, Flag, ShieldCheck, Trophy, User, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const items = [
  { href: '/minha-conta', label: 'Conta', icon: User, exact: true },
  { href: '/minha-conta/squads', label: 'Squads', icon: Users, exact: false },
  { href: '/minha-conta/campeonatos', label: 'Campeonatos', icon: Trophy, exact: false },
  { href: '/minha-conta/notificacoes', label: 'Notificações', icon: Bell, exact: false },
  { href: '/minha-conta/denuncias', label: 'Denúncias', icon: Flag, exact: false },
  { href: '/minha-conta/seguranca', label: 'Segurança', icon: ShieldCheck, exact: false },
];

/** Navegação secundária da conta. No celular rola na horizontal dentro de si mesma, sem empurrar a página. */
export function AccountNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);

  // Em telas estreitas a aba ativa pode ficar fora da área visível da própria barra: traz para a vista.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const left = active.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = Math.max(0, left - 16);
  }, [pathname]);

  return (
    <div className="mx-auto w-full max-w-[1280px] px-4 pt-4 md:px-6 md:pt-6">
      <nav ref={navRef} aria-label="Minha conta" className="min-w-0 overflow-x-auto border-b border-border [scrollbar-width:none]">
        <ul className="flex xs:gap-1">
          {items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-2 border-b-2 border-transparent px-2.5 text-sm font-semibold text-muted transition-colors hover:text-text xs:px-3',
                    active && 'border-accent text-text',
                  )}
                >
                  <item.icon className="hidden size-4 shrink-0 xs:block" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
