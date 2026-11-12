'use client';

import { Activity, Flag, Gamepad2, LayoutDashboard, Megaphone, ScrollText, Settings, Shield, Target, Trophy, Users } from 'lucide-react';
import { AreaShell, type AreaNavItem } from '@/shared/layout/AreaShell';
import { RequireRole } from '@/shared/layout/RequireRole';

const nav: AreaNavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/usuarios', label: 'Usuários', icon: Users },
  { href: '/admin/administradores', label: 'Administradores', icon: Shield },
  { href: '/admin/organizadores', label: 'Organizadores', icon: Target },
  { href: '/admin/campeonatos', label: 'Campeonatos', icon: Trophy },
  { href: '/admin/jogos', label: 'Jogos e regras', icon: Gamepad2 },
  { href: '/admin/moderacao', label: 'Moderação', icon: Flag },
  { href: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
  { href: '/admin/comunicados', label: 'Comunicados', icon: Megaphone },
  { href: '/admin/configuracoes', label: 'Configurações', icon: Settings },
  { href: '/admin/saude', label: 'Saúde do sistema', icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireRole roles={['ADMIN', 'SUPER_ADMIN']} require2FA areaName="de administração">
      <AreaShell area="admin" title="Administração" nav={nav}>
        {children}
      </AreaShell>
    </RequireRole>
  );
}
