'use client';

/** Formulário do evento (criar e editar) — ADR-0005. A regra de participação é um grupo de opções com explicação. */
import type { Event, EventParticipationRule } from '@nova/schemas';
import { Button, Input, Textarea } from '@nova/ui';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError } from '@/shared/api/client';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { messages } from './messages';

export interface EventFormValues {
  name: string;
  description: string;
  participationRule: EventParticipationRule;
}

const RULES: EventParticipationRule[] = ['SINGLE', 'MULTIPLE'];

export function EventForm({
  event,
  submitLabel,
  loading,
  onSubmit,
  onCancel,
}: {
  event?: Event;
  submitLabel: string;
  loading?: boolean;
  onSubmit: (input: EventFormValues) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const t = useT(messages, 'EventForm');
  const common = useT(sharedMessages, 'comum');
  const id = useId();
  const form = useForm<EventFormValues>({
    defaultValues: { name: event?.name ?? '', description: event?.description ?? '', participationRule: event?.participationRule ?? 'MULTIPLE' },
  });
  const { register, formState, setError } = form;
  const nameRule = t('erros.nome');
  const cancelLabel = common('cancelar');

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit({ name: values.name.trim(), description: values.description.trim(), participationRule: values.participationRule });
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [key, message] of Object.entries(error.fieldErrors)) {
          if (key === 'name' || key === 'description' || key === 'participationRule') setError(key, { message });
        }
      }
    }
  });

  const label = (rule: EventParticipationRule) => (rule === 'SINGLE' ? t('unicaTitulo') : t('variasTitulo'));
  const description = (rule: EventParticipationRule) => (rule === 'SINGLE' ? t('unicaDescricao') : t('variasDescricao'));

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input
        label={t('nome')}
        required
        maxLength={80}
        autoComplete="off"
        placeholder={t('nomePlaceholder')}
        {...register('name', { validate: (v) => (v.trim().length >= 3 && v.trim().length <= 80) || nameRule })}
        error={formState.errors.name?.message}
      />
      <Textarea label={t('descricao')} hint={t('descricaoDica')} maxLength={2000} {...register('description')} error={formState.errors.description?.message} />
      <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-regra-dica`}>
        <legend className="mb-1 text-sm font-medium text-text">{t('regra')}</legend>
        {RULES.map((rule) => (
          <label
            key={rule}
            htmlFor={`${id}-${rule}`}
            className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
          >
            {/* O nome da opção é o título; a explicação vem como descrição (o leitor de tela lê os dois, separados). */}
            <input
              id={`${id}-${rule}`}
              type="radio"
              value={rule}
              {...register('participationRule')}
              aria-labelledby={`${id}-${rule}-titulo`}
              aria-describedby={`${id}-${rule}-desc`}
              className="mt-1 size-4 shrink-0 accent-(--accent)"
            />
            <span className="flex min-w-0 flex-col">
              <span id={`${id}-${rule}-titulo`} className="text-sm font-semibold text-text">
                {label(rule)}
              </span>
              <span id={`${id}-${rule}-desc`} className="text-xs text-muted">
                {description(rule)}
              </span>
            </span>
          </label>
        ))}
        <p id={`${id}-regra-dica`} className="text-xs text-muted">
          {t('regraDica')}
        </p>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
