'use client';

import { Activity, CalendarRange, Flag, Gamepad2, LayoutDashboard, Megaphone, ScrollText, Settings, Shield, Target, Trophy, Users } from 'lucide-react';
import { useMemo } from 'react';
import { appMessages } from '@/app/messages';
import { useT } from '@/shared/i18n/react';
import { AreaShell, type AreaNavItem } from '@/shared/layout/AreaShell';
import { RequireRole } from '@/shared/layout/RequireRole';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useT(appMessages, 'Admin');
  const nav = useMemo<AreaNavItem[]>(
    () => [
      { href: '/admin', label: t('nav.dashboard'), icon: LayoutDashboard, exact: true },
      { href: '/admin/usuarios', label: t('nav.usuarios'), icon: Users },
      { href: '/admin/administradores', label: t('nav.administradores'), icon: Shield },
      { href: '/admin/organizadores', label: t('nav.organizadores'), icon: Target },
      { href: '/admin/campeonatos', label: t('nav.campeonatos'), icon: Trophy },
      { href: '/admin/jogos', label: t('nav.jogos'), icon: Gamepad2 },
      { href: '/admin/temporadas', label: t('nav.temporadas'), icon: CalendarRange },
      { href: '/admin/moderacao', label: t('nav.moderacao'), icon: Flag },
      { href: '/admin/auditoria', label: t('nav.auditoria'), icon: ScrollText },
      { href: '/admin/comunicados', label: t('nav.comunicados'), icon: Megaphone },
      { href: '/admin/configuracoes', label: t('nav.configuracoes'), icon: Settings },
      { href: '/admin/saude', label: t('nav.saude'), icon: Activity },
    ],
    [t],
  );
  return (
    <RequireRole roles={['ADMIN', 'SUPER_ADMIN']} require2FA areaName={t('area')}>
      <AreaShell area="admin" title={t('titulo')} nav={nav}>
        {children}
      </AreaShell>
    </RequireRole>
  );
}
