'use client';

import type { ExtraStatField, Match } from '@nova/schemas';
import { Input, Select } from '@nova/ui';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';
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
  const t = useT(messages, 'ScoreFields');
  const label = (side: Side) => (side.registrationId === mineRegistrationId ? t('placarDeVoce', { nome: side.name }) : t('placarDe', { nome: side.name }));
  const tied = needsTiebreak(match, a, b);
  // Funções, e não o resultado do `register`: os campos do desempate só são registrados quando aparecem na tela.
  const fields = {
    a: () => register('a', { valueAsNumber: true }),
    b: () => register('b', { valueAsNumber: true }),
    tiebreakA: () => register('tiebreakA', { setValueAs: toCount }),
    tiebreakB: () => register('tiebreakB', { setValueAs: toCount }),
    winner: () => register('winner'),
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Input label={label(sides[0])} required {...numeric} error={errors.a?.message} inputClassName="tabular text-center text-lg font-bold" {...fields.a()} />
        <Input label={label(sides[1])} required {...numeric} error={errors.b?.message} inputClassName="tabular text-center text-lg font-bold" {...fields.b()} />
      </div>
      {match.bestOf > 1 && <p className="text-xs text-muted">{t('serie', { bestOf: match.bestOf })}</p>}

      {tied &&
        (tiebreak ? (
          <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-semibold text-text">{t('desempate', { campo: tiebreak.label })}</legend>
            <p className="text-xs text-muted">{t('eliminatoriaInforme')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('campoDe', { campo: tiebreak.label, nome: sides[0].name })} {...numeric} error={errors.tiebreakA?.message} inputClassName="tabular text-center" {...fields.tiebreakA()} />
              <Input label={t('campoDe', { campo: tiebreak.label, nome: sides[1].name })} {...numeric} error={errors.tiebreakB?.message} inputClassName="tabular text-center" {...fields.tiebreakB()} />
            </div>
          </fieldset>
        ) : (
          <Select
            label={t('quemVenceu')}
            required
            hint={t('eliminatoria')}
            placeholder={t('escolhaVencedor')}
            options={sides.map((s) => ({ value: s.registrationId, label: s.name }))}
            error={errors.winner?.message}
            {...fields.winner()}
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
