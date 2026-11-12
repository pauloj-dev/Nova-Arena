import { Badge, cn, Skeleton } from '@nova/ui';
import { AlertCircle, FlaskConical } from 'lucide-react';
import type { ReactNode } from 'react';

/** Título e subtítulo das telas de autenticação. O cartão e o `<main>` vêm do layout `(auth)`. */
export function AuthHeader({ title, description, icon }: { title: string; description?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex flex-col gap-2">
      {icon && (
        <div className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-soft-text" aria-hidden>
          {icon}
        </div>
      )}
      <h1 className="text-xl">{title}</h1>
      {description && <p className="text-sm text-muted">{description}</p>}
    </header>
  );
}

/**
 * Aviso de comportamento que só existe no protótipo (API simulada): o link de e-mail na tela,
 * o login social de mentira. Sempre com o selo "Protótipo" visível, para ninguém confundir com o produto real.
 */
export function PrototypeNotice({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <div id={id} role="note" className={cn('flex flex-col items-start gap-2 rounded-md border border-dashed border-border-strong bg-warning-soft p-3 text-sm text-warning-soft-text', className)}>
      <Badge tone="warning" className="border border-current" icon={<FlaskConical className="size-3.5" aria-hidden />}>
        Protótipo
      </Badge>
      <div className="flex min-w-0 flex-col gap-2 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Erro geral do formulário (o que não pertence a um campo). */
export function FormAlert({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn('flex items-start gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text', className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

/** Carregando no formato de um formulário curto. */
export function AuthSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Carregando">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-11 w-full" />
    </div>
  );
}

/** Classe dos links de texto das telas de autenticação (área de toque de 44 px no celular fica por conta do espaçamento). */
export const textLink = 'font-semibold text-primary-text underline underline-offset-2 hover:no-underline';
