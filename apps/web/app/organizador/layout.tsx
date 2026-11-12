'use client';

import { FileStack, LayoutDashboard, PlusCircle, Trophy } from 'lucide-react';
import { AreaShell, type AreaNavItem } from '@/shared/layout/AreaShell';
import { RequireRole } from '@/shared/layout/RequireRole';

const nav: AreaNavItem[] = [
  { href: '/organizador', label: 'Meu painel', icon: LayoutDashboard, exact: true },
  { href: '/organizador/campeonatos', label: 'Meus campeonatos', icon: Trophy },
  { href: '/organizador/novo', label: 'Criar campeonato', icon: PlusCircle },
  { href: '/organizador/modelos', label: 'Modelos', icon: FileStack },
];

export default function OrganizerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={['ORGANIZER', 'ADMIN', 'SUPER_ADMIN']} areaName="de organização">
      <AreaShell area="organizer" title="Organização" nav={nav}>
        {children}
      </AreaShell>
    </RequireRole>
  );
}
