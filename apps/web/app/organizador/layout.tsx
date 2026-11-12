'use client';

import { FileStack, Home, LayoutDashboard, PlusCircle, Trophy } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { AreaShell, type AreaNavItem } from '@/shared/layout/AreaShell';
import { RequireRole } from '@/shared/layout/RequireRole';
import { isOrganizerUser, useSession } from '@/shared/session/useSession';

const nav: AreaNavItem[] = [
  { href: '/organizador', label: 'Meu painel', icon: LayoutDashboard, exact: true },
  { href: '/organizador/campeonatos', label: 'Meus campeonatos', icon: Trophy },
  { href: '/organizador/novo', label: 'Criar campeonato', icon: PlusCircle },
  { href: '/organizador/modelos', label: 'Modelos', icon: FileStack },
];
/** Quem é só da equipe de um evento (co-organizador ou moderador sem o papel de organizador) não tem painel próprio. */
const staffNav: AreaNavItem[] = [{ href: '/', label: 'Voltar ao site', icon: Home, exact: true }];

/** `/organizador/campeonatos/[id]`: a gestão de um campeonato, que a equipe do evento também usa. */
const MANAGE_PAGE = /^\/organizador\/campeonatos\/[^/]+\/?$/;

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  // A equipe do evento (PRD §6) entra na gestão do campeonato mesmo sem o papel de organizador:
  // basta estar logado, e a API decide se a pessoa é mesmo daquele campeonato (403 vira "sem acesso").
  const staffEntry = MANAGE_PAGE.test(pathname);
  return (
    <RequireRole roles={staffEntry ? [] : ['ORGANIZER', 'ADMIN', 'SUPER_ADMIN']} areaName="de organização">
      <AreaShell area="organizer" title="Organização" nav={isOrganizerUser(user) ? nav : staffNav}>
        {children}
      </AreaShell>
    </RequireRole>
  );
}
