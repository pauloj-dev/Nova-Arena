'use client';

import { FileStack, Home, LayoutDashboard, ListOrdered, PlusCircle, Trophy } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { appMessages } from '@/app/messages';
import { useT } from '@/shared/i18n/react';
import { AreaShell, type AreaNavItem } from '@/shared/layout/AreaShell';
import { RequireRole } from '@/shared/layout/RequireRole';
import { isOrganizerUser, useSession } from '@/shared/session/useSession';

/** `/organizador/campeonatos/[id]`: a gestão de um campeonato, que a equipe do evento também usa. */
const MANAGE_PAGE = /^\/organizador\/campeonatos\/[^/]+\/?$/;

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const t = useT(appMessages, 'Organizador');
  const nav = useMemo<AreaNavItem[]>(
    () => [
      { href: '/organizador', label: t('nav.painel'), icon: LayoutDashboard, exact: true },
      { href: '/organizador/campeonatos', label: t('nav.campeonatos'), icon: Trophy },
      { href: '/organizador/novo', label: t('nav.criar'), icon: PlusCircle },
      { href: '/organizador/modelos', label: t('nav.modelos'), icon: FileStack },
      { href: '/organizador/ligas', label: t('nav.ligas'), icon: ListOrdered },
    ],
    [t],
  );
  // Quem é só da equipe de um evento (co-organizador ou moderador sem o papel de organizador) não tem painel próprio.
  const staffNav = useMemo<AreaNavItem[]>(() => [{ href: '/', label: t('nav.voltarAoSite'), icon: Home, exact: true }], [t]);
  // A equipe do evento (PRD §6) entra na gestão do campeonato mesmo sem o papel de organizador:
  // basta estar logado, e a API decide se a pessoa é mesmo daquele campeonato (403 vira "sem acesso").
  const staffEntry = MANAGE_PAGE.test(pathname);
  return (
    <RequireRole roles={staffEntry ? [] : ['ORGANIZER', 'ADMIN', 'SUPER_ADMIN']} areaName={t('area')}>
      <AreaShell area="organizer" title={t('titulo')} nav={isOrganizerUser(user) ? nav : staffNav}>
        {children}
      </AreaShell>
    </RequireRole>
  );
}
