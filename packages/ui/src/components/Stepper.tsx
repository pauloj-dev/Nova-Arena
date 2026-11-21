import { Check } from 'lucide-react';
import { cn } from '../lib/cn';

export interface Step {
  id: string;
  label: string;
  description?: string;
}
export interface StepperProps {
  steps: Step[];
  /** Índice do passo atual (base 0). */
  current: number;
  /** Maior passo já alcançado: até ele dá para voltar clicando. */
  reached?: number;
  onStepClick?: (index: number) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/**
 * Celular: só "Passo 3 de 7 · Fases" + barra (um passo por tela).
 * Tablet: horizontal. Desktop com `orientation="vertical"`: lateral.
 */
export function Stepper({ steps, current, reached = current, onStepClick, orientation = 'horizontal', className }: StepperProps) {
  const active = steps[current];
  return (
    <nav aria-label="Etapas" className={className}>
      <div className="md:hidden">
        <p className="text-sm font-semibold text-text">
          Passo {current + 1} de {steps.length} · {active?.label}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-soft" aria-hidden>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      {/* Horizontal (tablet): cada passo divide a largura, com o nome embaixo do número — nunca passa da tela. */}
      <ol className={cn('hidden md:flex', orientation === 'vertical' ? 'flex-col gap-1' : 'items-start gap-1')}>
        {steps.map((s, i) => {
          const done = i < current;
          const isCurrent = i === current;
          const clickable = Boolean(onStepClick) && i <= reached && !isCurrent;
          const marker = (
            <span
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                done && 'border-accent bg-accent text-on-accent',
                isCurrent && 'border-accent bg-accent-soft text-accent-soft-text',
                !done && !isCurrent && 'border-border-strong bg-surface text-muted',
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
          );
          const horizontal = orientation === 'horizontal';
          const text = (
            <span className={cn('flex min-w-0 flex-col', horizontal ? 'text-center' : 'text-left')}>
              <span className={cn('font-semibold [overflow-wrap:anywhere]', horizontal ? 'text-xs leading-tight' : 'text-sm', isCurrent ? 'text-text' : 'text-muted')}>{s.label}</span>
              {orientation === 'vertical' && s.description && <span className="text-xs text-muted">{s.description}</span>}
            </span>
          );
          return (
            <li key={s.id} className={cn('flex', horizontal && 'min-w-0 flex-1')} aria-current={isCurrent ? 'step' : undefined}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(i)}
                  className={cn('relative flex min-h-11 items-center gap-2 rounded-md px-1 hover:bg-neutral-soft', horizontal && 'w-full flex-col gap-1 py-1')}
                >
                  {marker}
                  {text}
                  <span className="sr-only">(concluído, voltar a este passo)</span>
                </button>
              ) : (
                <span className={cn('flex min-h-11 items-center gap-2 px-1', horizontal && 'w-full flex-col gap-1 py-1')}>
                  {marker}
                  {text}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
