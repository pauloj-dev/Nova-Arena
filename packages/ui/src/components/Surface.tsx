import { Avatar as RAvatar, Tabs as RTabs } from 'radix-ui';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md';
  interactive?: boolean;
}

export function Card({ padding = 'md', interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface shadow-sm',
        padding === 'sm' && 'p-3',
        padding === 'md' && 'p-4 md:p-6',
        interactive && 'transition-shadow hover:shadow-md focus-within:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const avatarSizes = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base', xl: 'size-20 text-xl' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  return (
    <RAvatar.Root
      className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-accent-soft font-semibold text-accent-soft-text', avatarSizes[size], className)}
    >
      {src && <RAvatar.Image src={src} alt="" className="size-full object-cover" />}
      <RAvatar.Fallback delayMs={src ? 300 : undefined} aria-hidden>
        {initials(name)}
      </RAvatar.Fallback>
    </RAvatar.Root>
  );
}

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  label: string;
  className?: string;
}

export function Tabs({ items, value, defaultValue, onValueChange, label, className }: TabsProps) {
  return (
    <RTabs.Root value={value} defaultValue={defaultValue ?? items[0]?.value} onValueChange={onValueChange} className={className}>
      <RTabs.List aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {items.map((t) => (
          <RTabs.Trigger
            key={t.value}
            value={t.value}
            disabled={t.disabled}
            className="min-h-11 shrink-0 border-b-2 border-transparent px-3 text-sm font-semibold text-muted transition-colors hover:text-text data-[state=active]:border-accent data-[state=active]:text-text disabled:opacity-50"
          >
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {items.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="mt-4 rounded-sm">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('animate-skeleton rounded-md bg-neutral-soft', className)} {...props} />;
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center', className)}>
      {icon && (
        <div className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="text-lg text-text">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export interface ProgressProps {
  value: number;
  max: number;
  label: string;
  className?: string;
}

/** Barra de vagas: mostra valor e total em texto, além da barra. */
export function Progress({ value, max, label, className }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-soft"
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular text-xs text-muted">
        {value}/{max}
      </span>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
}

export function ErrorState({ title = 'Não foi possível carregar', description, onRetry, className, children }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-lg border border-danger-soft bg-danger-soft px-6 py-8 text-center text-danger-soft-text', className)}>
      <h3 className="text-lg">{title}</h3>
      {description && <p className="max-w-md text-sm">{description}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-md border border-danger px-4 text-sm font-semibold text-danger-soft-text hover:bg-surface"
        >
          Tentar novamente
        </button>
      )}
      {children}
    </div>
  );
}
