import { cn } from '@nova/ui';
import { passwordStrength } from './passwordStrength';

const SEGMENT_TONE: Record<1 | 2 | 3 | 4, string> = { 1: 'bg-danger', 2: 'bg-warning', 3: 'bg-info', 4: 'bg-accent' };

/** Indicador de força: barra de 4 passos + texto ("Força da senha: boa"), nunca só cor. */
export function PasswordStrengthMeter({ password, id }: { password: string; id?: string }) {
  const { score, label, tip } = passwordStrength(password);
  return (
    <div id={id} className="flex flex-col gap-1.5">
      <div
        role="meter"
        aria-label="Força da senha"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={score}
        aria-valuetext={label ?? 'ainda não digitada'}
        className="grid grid-cols-4 gap-1"
      >
        {([1, 2, 3, 4] as const).map((step) => (
          <span key={step} className={cn('h-1.5 rounded-full bg-neutral-soft', score !== 0 && step <= score && SEGMENT_TONE[score])} />
        ))}
      </div>
      <p className="min-h-4 text-xs text-muted" aria-live="polite">
        {label ? (
          <>
            Força da senha: <strong className="text-text">{label}</strong>
            {tip && <span> · {tip}</span>}
          </>
        ) : (
          'Pelo menos 8 caracteres, com letra e número.'
        )}
      </p>
    </div>
  );
}
