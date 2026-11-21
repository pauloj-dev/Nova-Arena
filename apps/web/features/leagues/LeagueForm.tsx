'use client';

/** Formulário da liga (criar e editar) — issue #120. A regra de pontos é configurável por colocação. */
import { DEFAULT_LEAGUE_RULE, LeagueInput, type League } from '@nova/schemas';
import { Button, Input, Select, Skeleton, Textarea } from '@nova/ui';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { isoToLocalInput, localInputToIso } from '@/shared/lib/datetime';
import { parsePoints, pointsText, ruleSummary } from './leagueText';

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
  const errors: Partial<Record<Field, string>> = {};
  const points = parsePoints(values.placementPoints);
  if (!points) errors.placementPoints = 'Use números inteiros separados por vírgula (ex.: 25, 18, 15)';
  const participation = /^\d+$/.test(values.participationPoints.trim()) ? Number.parseInt(values.participationPoints, 10) : Number.NaN;
  if (Number.isNaN(participation)) errors.participationPoints = 'Use um número inteiro a partir de 0';
  if (!values.startsAt) errors.startsAt = 'Informe o início';
  if (!values.endsAt) errors.endsAt = 'Informe o fim';
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

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Input label="Nome da liga" required maxLength={80} {...register('name', { required: 'Dê um nome para a liga' })} error={formState.errors.name?.message} />
      <Textarea label="Descrição" hint="Dia e horário dos campeonatos, premiação da temporada… (opcional)" maxLength={1000} {...register('description')} error={formState.errors.description?.message} />
      {games.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <Select
          label="Jogo"
          required
          disabled={Boolean(league)}
          hint={league ? 'O jogo não muda depois que a liga é criada.' : 'Só campeonatos deste jogo entram na liga.'}
          placeholder="Escolha o jogo"
          options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          {...register('gameId', { required: 'Escolha o jogo' })}
          error={formState.errors.gameId?.message}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Input label="Início da temporada da liga" type="datetime-local" required {...register('startsAt')} error={formState.errors.startsAt?.message} />
        <Input label="Fim da temporada da liga" type="datetime-local" required {...register('endsAt')} error={formState.errors.endsAt?.message} />
      </div>
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">Pontos por colocação</legend>
        <Input
          label="Pontos do 1º, 2º, 3º lugar…"
          hint="Separe por vírgula. Colocações além da lista ganham só os pontos de participação."
          inputMode="numeric"
          {...register('placementPoints')}
          error={formState.errors.placementPoints?.message}
        />
        <Input label="Pontos por participar" type="number" min={0} max={100} inputMode="numeric" {...register('participationPoints')} error={formState.errors.participationPoints?.message} />
        {preview && (
          <p className="text-sm text-muted" aria-live="polite">
            Prévia: {preview}
          </p>
        )}
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={loading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
