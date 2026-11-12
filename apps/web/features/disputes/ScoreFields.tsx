'use client';

import type { ExtraStatField, Match } from '@nova/schemas';
import { Input, Select } from '@nova/ui';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { needsTiebreak, type ScoreFormValues, type Side } from './scoreForm';

export interface ScoreFieldsProps {
  match: Pick<Match, 'bracket' | 'bestOf'>;
  sides: [Side, Side];
  /** Inscrição de quem está preenchendo, para marcar "(você)". */
  mineRegistrationId?: string;
  register: UseFormRegister<ScoreFormValues>;
  errors: FieldErrors<ScoreFormValues>;
  /** Valores atuais do placar (via `watch`), para saber se empatou. */
  a: number | undefined;
  b: number | undefined;
  /** Campo de desempate do jogo (ex.: pênaltis), se houver. */
  tiebreak: ExtraStatField | undefined;
}

const numeric = { type: 'number', inputMode: 'numeric', min: 0, max: 999, step: 1 } as const;

/** Placar dos dois lados e, quando empata em mata-mata de jogo único, o desempate. */
export function ScoreFields({ match, sides, mineRegistrationId, register, errors, a, b, tiebreak }: ScoreFieldsProps) {
  const label = (side: Side) => `Placar de ${side.name}${side.registrationId === mineRegistrationId ? ' (você)' : ''}`;
  const tied = needsTiebreak(match, a, b);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label={label(sides[0])} required {...numeric} error={errors.a?.message} inputClassName="tabular text-center text-lg font-bold" {...register('a', { valueAsNumber: true })} />
        <Input label={label(sides[1])} required {...numeric} error={errors.b?.message} inputClassName="tabular text-center text-lg font-bold" {...register('b', { valueAsNumber: true })} />
      </div>
      {match.bestOf > 1 && <p className="text-xs text-muted">Série melhor de {match.bestOf}: informe quantos jogos cada lado venceu.</p>}

      {tied &&
        (tiebreak ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-text">Desempate: {tiebreak.label}</legend>
            <p className="text-xs text-muted">Partida eliminatória não termina empatada. Informe o desempate dos dois lados.</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={`${tiebreak.label} de ${sides[0].name}`} {...numeric} error={errors.tiebreakA?.message} inputClassName="tabular text-center" {...register('tiebreakA', { setValueAs: toCount })} />
              <Input label={`${tiebreak.label} de ${sides[1].name}`} {...numeric} error={errors.tiebreakB?.message} inputClassName="tabular text-center" {...register('tiebreakB', { setValueAs: toCount })} />
            </div>
          </fieldset>
        ) : (
          <Select
            label="Quem venceu o desempate?"
            required
            hint="Partida eliminatória não termina empatada."
            placeholder="Escolha o vencedor"
            options={sides.map((s) => ({ value: s.registrationId, label: s.name }))}
            error={errors.winner?.message}
            {...register('winner')}
          />
        ))}
    </div>
  );
}

/** Campo numérico opcional: vazio vira `undefined` (e não `NaN`). */
function toCount(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}
