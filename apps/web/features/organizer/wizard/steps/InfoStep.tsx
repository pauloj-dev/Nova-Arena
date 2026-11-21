'use client';

import { Input, Textarea } from '@nova/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { BannerUpload } from '../../components/BannerUpload';
import { RichTextEditor } from '../../components/LazyRichTextEditor';
import { StreamLinksField } from '../../components/StreamLinksField';
import type { WizardValues } from '../../lib/draft';
import { useT } from '@/shared/i18n/react';
import { useWizard } from '../context';
import { messages } from '../messages';

/** Passo 1 — Informações: nome, descrição, banner, premiação e transmissão. */
export function InfoStep() {
  const { register, control } = useFormContext<WizardValues>();
  const { fieldError, values } = useWizard();
  const t = useT(messages, 'InfoStep');
  const nameField = register('name');
  const prizeField = register('prize');
  return (
    <div className="flex flex-col gap-5">
      <Input
        label={t('nome')}
        required
        maxLength={80}
        autoComplete="off"
        placeholder={t('nomePlaceholder')}
        hint={t('nomeHint')}
        error={fieldError('name')}
        {...nameField}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <RichTextEditor label={t('descricao')} value={field.value} onChange={field.onChange} hint={t('descricaoHint')} error={fieldError('description')} />
        )}
      />
      <Controller control={control} name="bannerUrl" render={({ field }) => <BannerUpload value={field.value} onChange={field.onChange} />} />
      <Textarea
        label={t('premiacao')}
        rows={3}
        maxLength={2000}
        placeholder={t('premiacaoPlaceholder')}
        hint={t('premiacaoHint')}
        error={fieldError('prize')}
        {...prizeField}
      />
      <Controller
        control={control}
        name="streamUrls"
        render={({ field }) => <StreamLinksField value={field.value} onChange={field.onChange} errors={values.streamUrls.map((_, i) => fieldError(`streamUrls.${i}`))} />}
      />
    </div>
  );
}
