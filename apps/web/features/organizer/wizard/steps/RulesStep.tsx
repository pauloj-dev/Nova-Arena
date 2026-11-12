'use client';

import { Controller, useFormContext } from 'react-hook-form';
import { RichTextEditor } from '../../components/RichTextEditor';
import type { WizardValues } from '../../lib/draft';
import { useWizard } from '../context';

/** Passo 6 — Regras: o regulamento que todo inscrito precisa aceitar. */
export function RulesStep() {
  const { control } = useFormContext<WizardValues>();
  const { fieldError } = useWizard();
  return (
    <div className="flex flex-col gap-4">
      <Controller
        control={control}
        name="rules"
        render={({ field }) => (
          <RichTextEditor
            label="Regulamento"
            size="lg"
            value={field.value}
            onChange={field.onChange}
            error={fieldError('rules')}
            hint="Já deixamos um ponto de partida. Quem se inscreve precisa aceitar este texto."
          />
        )}
      />
      <ul className="list-disc pl-5 text-sm text-muted">
        <li>Diga como o resultado é comprovado (print da tela final, por exemplo).</li>
        <li>Explique o que acontece com atraso, W.O. e desconexão.</li>
        <li>Deixe claro o que desclassifica: hack, emulador, conta de terceiros.</li>
      </ul>
    </div>
  );
}
