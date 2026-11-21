'use client';

import { Controller, useFormContext } from 'react-hook-form';
import { RichTextEditor } from '../../components/LazyRichTextEditor';
import type { WizardValues } from '../../lib/draft';
import { useT } from '@/shared/i18n/react';
import { useWizard } from '../context';
import { messages } from '../messages';

/** Passo 6 — Regras: o regulamento que todo inscrito precisa aceitar. */
export function RulesStep() {
  const { control } = useFormContext<WizardValues>();
  const { fieldError } = useWizard();
  const t = useT(messages, 'RulesStep');
  return (
    <div className="flex flex-col gap-4">
      <Controller
        control={control}
        name="rules"
        render={({ field }) => (
          <RichTextEditor
            label={t('regulamento')}
            size="lg"
            value={field.value}
            onChange={field.onChange}
            error={fieldError('rules')}
            hint={t('regulamentoHint')}
          />
        )}
      />
      <ul className="list-disc pl-5 text-sm text-muted">
        <li>{t('dicaComprovacao')}</li>
        <li>{t('dicaAtraso')}</li>
        <li>{t('dicaDesclassificacao')}</li>
      </ul>
    </div>
  );
}
