import { Checkbox as RCheckbox, Switch as RSwitch } from 'radix-ui';
import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface ToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Checkbox({ label, hint, checked, onCheckedChange, disabled, className, id }: ToggleProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cn('flex min-h-11 items-start gap-3 py-2', className)}>
      <RCheckbox.Root
        id={fieldId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-60"
      >
        <RCheckbox.Indicator>
          <Check className="size-4 text-on-accent" aria-hidden />
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <div className="flex flex-col">
        <label htmlFor={fieldId} className="text-sm text-text">
          {label}
        </label>
        {hint && (
          <span id={`${fieldId}-hint`} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

export function Switch({ label, hint, checked, onCheckedChange, disabled, className, id }: ToggleProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <div className={cn('flex min-h-11 items-center justify-between gap-4 py-2', className)}>
      <div className="flex flex-col">
        <label htmlFor={fieldId} className="text-sm font-medium text-text">
          {label}
        </label>
        {hint && (
          <span id={`${fieldId}-hint`} className="text-xs text-muted">
            {hint}
          </span>
        )}
      </div>
      <RSwitch.Root
        id={fieldId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className="relative h-6 w-11 shrink-0 rounded-full border border-border-strong bg-neutral-soft transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-60"
      >
        <RSwitch.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-border-strong shadow-sm data-[state=checked]:bg-surface transition-transform data-[state=checked]:translate-x-5.5" />
      </RSwitch.Root>
    </div>
  );
}
