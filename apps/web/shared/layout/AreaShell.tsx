'use client';

import { cn, Drawer } from '@nova/ui';
import { Menu, PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ThemeToggle } from '../theme/ThemeToggle';
import { Logo } from './Logo';
import { SiteBanner } from './SiteBanner';
import { UserMenu } from './UserMenu';

export interface AreaNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Marca como ativo só no caminho exato (para a raiz da área). */
  exact?: boolean;
}

interface AreaShellProps {
  area: 'organizer' | 'admin';
  title: string;
  nav: AreaNavItem[];
  children: ReactNode;
}

function NavList({ nav, pathname, onNavigate, rail = false }: { nav: AreaNavItem[]; pathname: string; onNavigate?: () => void; rail?: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {nav.map((n) => {
        const active = n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              title={rail ? n.label : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-muted hover:bg-neutral-soft hover:text-text',
                rail && 'md:max-lg:justify-center md:max-lg:px-0',
                active && 'bg-accent-soft text-accent-soft-text hover:bg-accent-soft hover:text-accent-soft-text',
              )}
            >
              <n.icon className="size-4.5 shrink-0" aria-hidden />
              {/* No trilho recolhido (tablet) o nome continua para o leitor de tela. */}
              <span className={cn(rail && 'md:max-lg:sr-only')}>{n.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Casca das áreas de trabalho (Organizador em teal, Admin em verde-escuro com detalhe dourado).
 * Celular: drawer (☰). Tablet: menu lateral recolhível (trilho só com ícones, expande no botão).
 * Desktop: menu lateral fixo.
 */
export function AreaShell({ area, title, nav, children }: AreaShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Tablet: o menu lateral começa recolhido para sobrar espaço às tabelas; no desktop ele fica sempre aberto.
  const [expanded, setExpanded] = useState(false);
  const rail = !expanded;

  return (
    <div className="flex min-h-dvh flex-col px-safe" data-area={area}>
      {/* Avisos globais (manutenção programada 48 h antes, comunicados): também para organização e administração. */}
      <SiteBanner />
      <header className="sticky top-0 z-40 border-b border-border bg-chrome pt-safe text-chrome-text">
        <div className="flex h-14 min-w-0 items-center gap-1 px-2 xs:gap-3 xs:px-3 md:px-6">
          <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" className="flex size-11 items-center justify-center rounded-md hover:bg-neutral-soft/30 md:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <Logo href={area === 'admin' ? '/admin' : '/organizador'} onColor compact />
          <span className="hidden rounded-full border border-accent-detail px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide md:inline">{title}</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 overflow-y-auto border-r border-border bg-surface p-3 md:block lg:w-60',
            rail ? 'md:w-16 md:px-2' : 'md:w-60',
            'lg:px-3',
          )}
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="menu-da-area"
            aria-label={expanded ? 'Recolher o menu' : 'Expandir o menu'}
            title={expanded ? 'Recolher o menu' : 'Expandir o menu'}
            className="mb-2 flex min-h-11 w-full items-center justify-center rounded-md text-muted hover:bg-neutral-soft hover:text-text lg:hidden"
          >
            {expanded ? <PanelLeftClose className="size-5" aria-hidden /> : <PanelLeftOpen className="size-5" aria-hidden />}
          </button>
          <nav aria-label={title} id="menu-da-area">
            <NavList nav={nav} pathname={pathname} rail={rail} />
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <Drawer open={open} onOpenChange={setOpen} title={title} side="left">
        <nav aria-label={title} data-area={area}>
          <NavList nav={nav} pathname={pathname} onNavigate={() => setOpen(false)} />
        </nav>
      </Drawer>
    </div>
  );
}

/** Cabeçalho padrão de página dentro das áreas. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl md:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Contêiner de conteúdo: largura máxima e espaçamentos consistentes. */
export function PageContainer({ children, className, narrow }: { children: ReactNode; className?: string; narrow?: boolean }) {
  return (
    <main id="conteudo" className={cn('mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-6 md:py-8', narrow ? 'max-w-3xl' : 'max-w-[1280px]', className)}>
      {children}
    </main>
  );
}
