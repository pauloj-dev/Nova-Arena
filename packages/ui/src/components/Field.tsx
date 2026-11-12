import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Esconde o rótulo visualmente, mas mantém para leitores de tela. */
  hideLabel?: boolean;
  className?: string;
}

const control =
  'w-full rounded-md border border-border-strong bg-surface text-text placeholder:text-muted px-3 min-h-11 text-base md:text-sm ' +
  'transition-shadow focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ' +
  'disabled:opacity-60 disabled:cursor-not-allowed aria-invalid:border-danger';

function Shell({
  id,
  label,
  hint,
  error,
  required,
  hideLabel,
  className,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-medium text-text', hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export type InputProps = FieldShellProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { inputClassName?: string };

export function Input({ label, hint, error, hideLabel, className, inputClassName, id, required, ...props }: InputProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} className={className}>
      <input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(control, inputClassName)}
        {...props}
      />
    </Shell>
  );
}

export type TextareaProps = FieldShellProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>;

export function Textarea({ label, hint, error, hideLabel, className, id, required, rows = 4, ...props }: TextareaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} className={className}>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(control, 'py-2 leading-normal')}
        {...props}
      />
    </Shell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
export type SelectProps = FieldShellProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { options: SelectOption[]; placeholder?: string };

/** Select nativo: melhor no celular (usa o seletor do sistema) e acessível por padrão. */
export function Select({ label, hint, error, hideLabel, className, id, required, options, placeholder, ...props }: SelectProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <Shell id={fieldId} label={label} hint={hint} error={error} required={required} hideLabel={hideLabel} className={className}>
      <div className="relative">
        <select
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(control, 'appearance-none pr-9')}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      </div>
    </Shell>
  );
}
