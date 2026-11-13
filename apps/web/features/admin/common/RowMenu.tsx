'use client';

import { cn } from '@nova/ui';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';

export interface RowMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Explica por que a ação está desabilitada. */
  hint?: string;
}

/** Menu "Ações" de uma linha de tabela (teclado e leitor de tela pelo Radix). */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-sm font-semibold text-text hover:bg-surface-2 md:min-h-8"
        >
          <MoreHorizontal className="size-4" aria-hidden />
          Ações
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-56 rounded-lg border border-border bg-surface p-1.5 text-text shadow-lg">
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center rounded-md px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-neutral-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60',
                item.danger && 'text-danger',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <item.icon className="size-4 shrink-0" aria-hidden />
                {item.label}
              </span>
              {item.disabled && item.hint && <span className="pl-6 text-xs text-muted">{item.hint}</span>}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
