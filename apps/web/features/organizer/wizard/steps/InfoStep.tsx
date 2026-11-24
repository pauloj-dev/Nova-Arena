'use client';

import { Input, Select, Skeleton, Textarea } from '@nova/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { BannerUpload } from '../../components/BannerUpload';
import { RichTextEditor } from '../../components/LazyRichTextEditor';
import { StreamLinksField } from '../../components/StreamLinksField';
import type { WizardValues } from '../../lib/draft';
import { useMyEvents } from '@/shared/api/hooks/events';
import { useT } from '@/shared/i18n/react';
import { useWizard } from '../context';
import { messages } from '../messages';

/** Evento do campeonato (ADR-0005): avulso ou dentro de um evento meu. Trava quando o campeonato começa. */
function EventField() {
  const { setValue, control } = useFormContext<WizardValues>();
  const { hasStarted } = useWizard();
  const t = useT(messages, 'InfoStep');
  const events = useMyEvents();
  return (
    <Controller
      control={control}
      name="eventId"
      render={({ field }) => {
        const value = field.value ?? '';
        if (events.isPending) return <Skeleton className="h-16 w-full" />;
        const mine = events.data ?? [];
        const current = mine.find((e) => e.id === value);
        // Campeonato num evento de outra pessoa (equipe do evento editando): o evento aparece, mas não é meu.
        const options = [{ value: '', label: t('eventoNenhum') }, ...mine.map((e) => ({ value: e.id, label: e.name })), ...(value && !current ? [{ value, label: t('eventoAtual') }] : [])];
        const hint = hasStarted ? t('eventoTravado') : current ? (current.participationRule === 'SINGLE' ? t('eventoUnico') : t('eventoVarios')) : t('eventoHint');
        return (
          <Select
            label={t('evento')}
            hint={hint}
            options={options}
            value={value}
            disabled={hasStarted}
            name={field.name}
            onBlur={field.onBlur}
            onChange={(e) => setValue('eventId', e.target.value || null, { shouldDirty: true })}
          />
        );
      }}
    />
  );
}

/** Passo 1 — Informações: nome, descrição, banner, premiação, transmissão e evento. */
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
      <EventField />
    </div>
  );
}
