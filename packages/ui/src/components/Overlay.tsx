'use client';

import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { Input } from './Field';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const modalSizes = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-3xl' };

/** Tela cheia no celular, centralizado a partir de 768 px. Foco preso e devolvido ao fechar (Radix). */
export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface text-text shadow-lg animate-slide-up',
            'inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-full md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border',
            modalSizes[size],
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 md:px-6">
            <div>
              <Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Fechar" className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-neutral-soft md:size-9">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
          {footer && <footer className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 pb-safe md:flex-row md:justify-end md:px-6">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmDestructiveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Texto que a pessoa precisa digitar para confirmar (ex.: o nome do campeonato). */
  confirmText: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  children?: ReactNode;
}

/** Ação destrutiva: só libera o botão depois que o nome do recurso é digitado (PRD §15.8). */
export function ConfirmDestructive({ open, onOpenChange, title, description, confirmText, confirmLabel = 'Confirmar', onConfirm, loading, children }: ConfirmDestructiveProps) {
  const [typed, setTyped] = useState('');
  // Fechou por qualquer caminho (Esc, "Voltar", depois de confirmar): o nome digitado não pode sobrar para a próxima abertura.
  if (!open && typed !== '') setTyped('');
  const matches = typed.trim().toLowerCase() === confirmText.trim().toLowerCase();
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button variant="danger" disabled={!matches} loading={loading} onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        <Input
          label={
            <>
              Para confirmar, digite <strong>{confirmText}</strong>
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      </div>
    </Modal>
  );
}

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  /** `bottom` sobe de baixo (filtros no celular); `left`/`right` são menus laterais. */
  side?: 'left' | 'right' | 'bottom';
  footer?: ReactNode;
}

const drawerSides = {
  left: 'inset-y-0 left-0 w-[86vw] max-w-xs border-r',
  right: 'inset-y-0 right-0 w-[86vw] max-w-sm border-l',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg border-t',
};

export function Drawer({ open, onOpenChange, title, children, side = 'right', footer }: DrawerProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <Dialog.Content className={cn('fixed z-50 flex flex-col border-border bg-surface text-text shadow-lg animate-fade-in', drawerSides[side])}>
          <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
            <Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title>
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
            <Dialog.Close asChild>
              <button type="button" aria-label="Fechar" className="flex size-11 items-center justify-center rounded-md text-muted hover:bg-neutral-soft">
                <X className="size-5" aria-hidden />
              </button>
            </Dialog.Close>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <footer className="flex gap-2 border-t border-border px-4 py-3 pb-safe">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
