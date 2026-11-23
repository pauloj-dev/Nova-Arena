'use client';

/** Formulário da liga (criar e editar) — issue #120. A regra de pontos é configurável por colocação. */
import { DEFAULT_LEAGUE_RULE, LeagueInput, type League } from '@nova/schemas';
import { Button, Input, Select, Skeleton, Textarea } from '@nova/ui';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { getT } from '@/shared/i18n/core';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { isoToLocalInput, localInputToIso } from '@/shared/lib/datetime';
import { parsePoints, pointsText, ruleSummary } from './leagueText';
import { messages } from './messages';

export interface LeagueFormValues {
  name: string;
  description: string;
  gameId: string;
  startsAt: string;
  endsAt: string;
  placementPoints: string;
  participationPoints: string;
}

type Field = keyof LeagueFormValues;

/** Valores do formulário para a API. Devolve os erros por campo quando algo não passa no contrato. */
export function toLeagueInput(values: LeagueFormValues): { input: LeagueInput } | { errors: Partial<Record<Field, string>> } {
  const t = getT(messages, 'LeagueForm.erros');
  const errors: Partial<Record<Field, string>> = {};
  const points = parsePoints(values.placementPoints);
  if (!points) errors.placementPoints = t('pontosColocacao');
  const participation = /^\d+$/.test(values.participationPoints.trim()) ? Number.parseInt(values.participationPoints, 10) : Number.NaN;
  if (Number.isNaN(participation)) errors.participationPoints = t('pontosParticipacao');
  if (!values.startsAt) errors.startsAt = t('inicio');
  if (!values.endsAt) errors.endsAt = t('fim');
  if (Object.keys(errors).length) return { errors };

  const input = {
    name: values.name,
    description: values.description,
    gameId: values.gameId,
    startsAt: localInputToIso(values.startsAt),
    endsAt: localInputToIso(values.endsAt),
    rule: { placementPoints: points as number[], participationPoints: participation },
  };
  const parsed = LeagueInput.safeParse(input);
  if (parsed.success) return { input };
  for (const issue of parsed.error.issues) {
    const [first, second] = issue.path;
    const field: Field | undefined = first === 'rule' ? (second === 'participationPoints' ? 'participationPoints' : 'placementPoints') : (first as Field | undefined);
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { errors };
}

export function defaultLeagueValues(league?: League): LeagueFormValues {
  // Hoje, 0h no fuso de quem está criando.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = league?.startsAt ?? today.toISOString();
  const end = league?.endsAt ?? new Date(new Date(start).getTime() + 90 * 24 * 3600_000).toISOString();
  const rule = league?.rule ?? DEFAULT_LEAGUE_RULE;
  return {
    name: league?.name ?? '',
    description: league?.description ?? '',
    gameId: league?.game.id ?? '',
    startsAt: isoToLocalInput(start),
    endsAt: isoToLocalInput(end),
    placementPoints: pointsText(rule.placementPoints),
    participationPoints: String(rule.participationPoints),
  };
}

export function LeagueForm({ league, submitLabel, loading, onSubmit, onCancel }: { league?: League; submitLabel: string; loading?: boolean; onSubmit: (input: LeagueInput) => Promise<unknown>; onCancel?: () => void }) {
  const games = useGames();
  const t = useT(messages, 'LeagueForm');
  const common = useT(sharedMessages, 'comum');
  const form = useForm<LeagueFormValues>({ defaultValues: defaultLeagueValues(league) });
  const { register, formState, setError, control } = form;
  const [placementText, participationText] = useWatch({ control, name: ['placementPoints', 'participationPoints'] });
  const preview = (() => {
    const points = parsePoints(placementText ?? '');
    const participation = Number.parseInt(participationText ?? '0', 10);
    return points ? ruleSummary({ placementPoints: points, participationPoints: Number.isNaN(participation) ? 0 : participation }, 6) : null;
  })();

  const submit = form.handleSubmit(async (values) => {
    // O jogo fica travado na edição (campo desabilitado não entra nos valores).
    const result = toLeagueInput({ ...values, gameId: values.gameId || league?.game.id || '' });
    if ('errors' in result) {
      for (const [field, message] of Object.entries(result.errors)) setError(field as Field, { message });
      return;
    }
    try {
      await onSubmit(result.input);
    } catch (error) {
      if (error instanceof ApiError) {
        for (const [key, message] of Object.entries(error.fieldErrors)) {
          const field: Field | undefined = key.startsWith('rule.participation') ? 'participationPoints' : key.startsWith('rule') ? 'placementPoints' : (key as Field);
          if (field in values) setError(field, { message });
        }
      }
    }
  });

  const fields = {
    name: register('name', { required: t('erros.nome') }),
    description: register('description'),
    // Só registra quando o seletor aparece (com os jogos carregados), como antes.
    gameId: () => register('gameId', { required: t('erros.jogo') }),
    startsAt: register('startsAt'),
    endsAt: register('endsAt'),
    placementPoints: register('placementPoints'),
    participationPoints: register('participationPoints'),
  };
  const cancelLabel = common('cancelar');

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input label={t('nome')} required maxLength={80} {...fields.name} error={formState.errors.name?.message} />
      <Textarea label={t('descricao')} hint={t('descricaoDica')} maxLength={1000} {...fields.description} error={formState.errors.description?.message} />
      {games.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <Select
          label={t('jogo')}
          required
          disabled={Boolean(league)}
          hint={league ? t('jogoDicaEdicao') : t('jogoDica')}
          placeholder={t('jogoPlaceholder')}
          options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          {...fields.gameId()}
          error={formState.errors.gameId?.message}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Input label={t('inicio')} type="datetime-local" required {...fields.startsAt} error={formState.errors.startsAt?.message} />
        <Input label={t('fim')} type="datetime-local" required {...fields.endsAt} error={formState.errors.endsAt?.message} />
      </div>
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">{t('pontosPorColocacao')}</legend>
        <Input
          label={t('pontosColocacao')}
          hint={t('pontosColocacaoDica')}
          inputMode="numeric"
          {...fields.placementPoints}
          error={formState.errors.placementPoints?.message}
        />
        <Input label={t('pontosParticipacao')} type="number" min={0} max={100} inputMode="numeric" {...fields.participationPoints} error={formState.errors.participationPoints?.message} />
        {preview && (
          <p className="text-sm text-muted" aria-live="polite">
            {t('previa', { previa: preview })}
          </p>
        )}
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
