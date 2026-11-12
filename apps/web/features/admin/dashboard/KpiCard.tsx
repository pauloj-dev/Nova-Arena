import { cn, Skeleton } from '@nova/ui';
import { AlertTriangle, ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

export interface KpiCardProps {
  label: string;
  /** Número já formatado (ex.: "12.480"). Indefinido enquanto carrega. */
  value: string | undefined;
  /** Linha de apoio abaixo do número (ex.: "de 66 contas"). */
  hint?: string;
  icon: LucideIcon;
  /** Tela para onde o cartão leva. */
  href: string;
  /** Texto do atalho, para leitor de tela (ex.: "Ver usuários"). */
  linkLabel: string;
  /** Pede atenção (fila com itens em aberto): mostra o ícone de alerta e o texto "Pede atenção". */
  attention?: boolean;
  /** Destaca o indicador principal do produto (North Star). */
  highlight?: boolean;
}

/**
 * Indicador do dashboard: rótulo, número em fonte tabular e atalho para a tela correspondente.
 * O cartão inteiro é um link (um alvo de toque só), com nome acessível completo.
 */
export function KpiCard({ label, value, hint, icon: Icon, href, linkLabel, attention = false, highlight = false }: KpiCardProps) {
  return (
    <Link
      href={href}
      aria-label={value === undefined ? `${label}: carregando. ${linkLabel}` : `${label}: ${value}${hint ? `, ${hint}` : ''}${attention ? '. Pede atenção' : ''}. ${linkLabel}`}
      className={cn(
        'group flex min-h-28 flex-col justify-between gap-2 rounded-lg border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        highlight ? 'border-accent' : 'border-border',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md', highlight ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent-soft-text')} aria-hidden>
          <Icon className="size-4.5" />
        </span>
      </span>
      {value === undefined ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <span className="flex items-center gap-2">
          <span className="tabular font-display text-2xl font-bold leading-none text-text" data-testid="kpi-value">
            {value}
          </span>
          {attention && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-soft-text">
              <AlertTriangle className="size-3.5" aria-hidden />
              Pede atenção
            </span>
          )}
        </span>
      )}
      <span className="flex items-center justify-between gap-2 text-xs text-muted">
        <span className="min-w-0 truncate">{hint ?? ' '}</span>
        <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
