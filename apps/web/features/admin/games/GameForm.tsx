'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GameAdminInput, type Game } from '@nova/schemas';
import { Button, Card, Input, Select, Switch, useToast } from '@nova/ui';
import { AlertCircle, ImageOff, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Controller, useFieldArray, useForm, useWatch, type FieldError, type FieldPath } from 'react-hook-form';
import { MATCH_TYPE_OPTIONS } from '@/features/scoring/describe';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useT } from '@/shared/i18n/react';
import { cleanGameInput, coverFileError, coverToDataUrl, DEFAULT_LOBBY_SIZE, emptyMode, gameToForm, slugify, type GameFormValues } from './game-values';
import { adminGamesMessages } from './messages';

interface GameFormProps {
  mode: 'create' | 'edit';
  defaultValues: GameFormValues;
  /** Salva e devolve o jogo como ficou no servidor (os modos novos voltam com `id`). */
  onSubmit: (input: GameAdminInput) => Promise<Game>;
  cancelHref: string;
}

/** As mensagens escritas no schema estão em português; as automáticas do Zod vêm em inglês e são trocadas pela `fallback`. */
function message(error: FieldError | undefined, fallback: string): string | undefined {
  if (!error) return undefined;
  const text = error.message ?? '';
  return text === '' || /^(Invalid|Too |Expected|Required)/.test(text) ? fallback : text;
}

const iconButton =
  'flex size-11 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-40 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

function Section({ title, description, children, action }: { title: string; description?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Row({ legend, onRemove, removeLabel, removeDisabled, children }: { legend: string; onRemove: () => void; removeLabel: string; removeDisabled?: boolean; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-text">{legend}</legend>
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2 lg:grid-cols-4">{children}</div>
        <button type="button" aria-label={removeLabel} onClick={onRemove} disabled={removeDisabled} className={iconButton}>
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </fieldset>
  );
}

/** Formulário de jogo do catálogo (ADM-06): dados, modos, campos de ID exigidos e estatísticas extras. */
export function GameForm({ mode, defaultValues, onSubmit, cancelHref }: GameFormProps) {
  const t = useT(adminGamesMessages, 'GameForm');
  const toast = useToast();
  const form = useForm<GameFormValues, unknown, GameAdminInput>({ resolver: zodResolver(GameAdminInput), defaultValues, mode: 'onBlur' });
  const { register, control, handleSubmit, setValue, setError, formState } = form;
  const { errors, isSubmitting } = formState;

  // `keyName` próprio: o `id` dos modos é dado do jogo e precisa voltar para a API como veio.
  const modes = useFieldArray({ control, name: 'modes', keyName: 'rowKey' });
  const accountFields = useFieldArray({ control, name: 'requiredAccountFields', keyName: 'rowKey' });
  const statFields = useFieldArray({ control, name: 'extraStatFields', keyName: 'rowKey' });
  const watchedModes = useWatch({ control, name: 'modes' });
  const coverUrl = useWatch({ control, name: 'coverUrl' });
  const icon = useWatch({ control, name: 'icon' });

  // No cadastro, o endereço acompanha o nome até a pessoa mexer nele.
  const [slugEdited, setSlugEdited] = useState(mode === 'edit');
  const [coverError, setCoverError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function chooseCover(file: File | undefined) {
    if (!file) return;
    const problem = coverFileError(file);
    if (problem) {
      setCoverError(problem);
      return;
    }
    try {
      setValue('coverUrl', await coverToDataUrl(file), { shouldDirty: true });
      setCoverError(null);
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : t('imagemIlegivel'));
    }
  }

  const submit = handleSubmit(
    async (values) => {
      setFormError(null);
      try {
        const saved = await onSubmit(cleanGameInput(values));
        if (mode === 'edit') form.reset(gameToForm(saved));
      } catch (error) {
        if (error instanceof ApiError) {
          for (const [field, text] of Object.entries(error.fieldErrors)) {
            setError(field as FieldPath<GameFormValues>, { type: 'server', message: text }, { shouldFocus: true });
          }
        }
        setFormError(errorMessage(error));
        toast.error(t('toastErroSalvar'), errorMessage(error));
      }
    },
    () => setFormError(t('confiraCampos')),
  );

  const whenOptions = [
    { value: 'always', label: t('quandoSempre') },
    { value: 'tiebreak', label: t('quandoDesempate') },
  ];
  // Registro dos campos fixos fora do JSX (o nome do campo não é texto de interface).
  const nameField = register('name', {
    onChange: (event: { target: { value: string } }) => {
      if (!slugEdited) setValue('slug', slugify(event.target.value), { shouldValidate: formState.isSubmitted });
    },
  });
  const slugField = register('slug', { onChange: () => setSlugEdited(true) });
  const iconField = register('icon');
  const platformField = register('platform');
  const removeCover = () => setValue('coverUrl', null, { shouldDirty: true });

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-6" aria-label={mode === 'create' ? t('rotuloCadastro') : t('rotuloEdicao')}>
      <Section title={t('dados.titulo')}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label={t('dados.nome')}
            required
            autoComplete="off"
            error={message(errors.name, t('dados.nomeErro'))}
            {...nameField}
          />
          <Input
            label={t('dados.slug')}
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            hint={t('dados.slugDica')}
            error={message(errors.slug, t('dados.slugErro'))}
            {...slugField}
          />
          <div className="flex items-start gap-3">
            <span className="mt-6 flex size-11 shrink-0 items-center justify-center rounded-md bg-accent-soft text-lg font-bold text-accent-soft-text" aria-hidden>
              {icon?.trim() || '?'}
            </span>
            <Input
              className="min-w-0 flex-1"
              label={t('dados.icone')}
              required
              autoComplete="off"
              hint={t('dados.iconeDica')}
              error={message(errors.icon, t('dados.iconeErro'))}
              {...iconField}
            />
          </div>
          <Input label={t('dados.plataforma')} required autoComplete="off" placeholder={t('dados.plataformaExemplo')} error={message(errors.platform, t('dados.plataformaErro'))} {...platformField} />

          <div className="flex flex-col gap-2 md:col-span-2">
            <Input
              label={t('dados.capa')}
              type="file"
              accept="image/*"
              inputClassName="py-2"
              hint={t('dados.capaDica')}
              error={coverError ?? undefined}
              onChange={(event) => {
                void chooseCover(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {coverUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL do upload simulado: não passa pelo otimizador de imagens */}
                <img src={coverUrl} alt={t('dados.capaAlt')} className="h-24 w-44 rounded-md border border-border object-cover" />
                <Button variant="secondary" size="sm" onClick={removeCover} iconLeft={<ImageOff className="size-4" aria-hidden />}>
                  {t('dados.removerCapa')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted">{t('dados.semCapa')}</p>
            )}
          </div>

          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <Switch
                className="md:col-span-2"
                label={t('dados.ativo')}
                hint={t('dados.ativoDica')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </Section>

      <Section
        title={t('modos.titulo')}
        description={t('modos.descricao')}
        action={
          <Button variant="secondary" size="sm" onClick={() => modes.append(emptyMode(watchedModes?.[0]?.matchType))} iconLeft={<Plus className="size-4" aria-hidden />}>
            {t('modos.adicionar')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {modes.fields.map((field, i) => {
            const modeErrors = errors.modes?.[i];
            const battleRoyale = watchedModes?.[i]?.matchType === 'BATTLE_ROYALE';
            return (
              <Row key={field.rowKey} legend={t('modos.legenda', { n: String(i + 1) })} removeLabel={t('modos.remover', { n: String(i + 1) })} removeDisabled={modes.fields.length === 1} onRemove={() => modes.remove(i)}>
                <Input label={t('modos.nome')} required autoComplete="off" placeholder={t('modos.nomeExemplo')} error={message(modeErrors?.name, t('modos.nomeErro'))} {...register(`modes.${i}.name`)} />
                <Select
                  label={t('modos.tipo')}
                  options={MATCH_TYPE_OPTIONS}
                  error={message(modeErrors?.matchType, t('modos.tipoErro'))}
                  {...register(`modes.${i}.matchType`, {
                    onChange: (event: { target: { value: string } }) => {
                      if (event.target.value === 'BATTLE_ROYALE' && !form.getValues(`modes.${i}.maxLobbySize`)) setValue(`modes.${i}.maxLobbySize`, DEFAULT_LOBBY_SIZE);
                    },
                  })}
                />
                <Input
                  label={t('modos.equipe')}
                  type="number"
                  min={1}
                  max={10}
                  required
                  hint={t('modos.equipeDica')}
                  error={message(modeErrors?.teamSize, t('modos.equipeErro'))}
                  {...register(`modes.${i}.teamSize`, { valueAsNumber: true })}
                />
                <Input
                  label={t('modos.reservas')}
                  type="number"
                  min={0}
                  max={5}
                  required
                  hint={t('modos.reservasDica')}
                  error={message(modeErrors?.maxSubs, t('modos.reservasErro'))}
                  {...register(`modes.${i}.maxSubs`, { valueAsNumber: true })}
                />
                {battleRoyale && (
                  <Input
                    label={t('modos.sala')}
                    type="number"
                    min={2}
                    max={100}
                    required
                    hint={t('modos.salaDica')}
                    error={message(modeErrors?.maxLobbySize, t('modos.salaErro'))}
                    {...register(`modes.${i}.maxLobbySize`, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) })}
                  />
                )}
              </Row>
            );
          })}
        </div>
      </Section>

      <Section
        title={t('campos.titulo')}
        description={t('campos.descricao')}
        action={
          <Button variant="secondary" size="sm" onClick={() => accountFields.append({ key: '', label: '', placeholder: '', pattern: '' })} iconLeft={<Plus className="size-4" aria-hidden />}>
            {t('campos.adicionar')}
          </Button>
        }
      >
        {accountFields.fields.length === 0 && <p className="text-sm text-muted">{t('campos.vazio')}</p>}
        <div className="flex flex-col gap-3">
          {accountFields.fields.map((field, i) => {
            const fieldErrors = errors.requiredAccountFields?.[i];
            return (
              <Row key={field.rowKey} legend={t('campos.legenda', { n: String(i + 1) })} removeLabel={t('campos.remover', { n: String(i + 1) })} onRemove={() => accountFields.remove(i)}>
                <Input
                  label={t('chave')}
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('campos.chaveExemplo')}
                  hint={t('chaveDica')}
                  error={message(fieldErrors?.key, t('chaveErro'))}
                  {...register(`requiredAccountFields.${i}.key`)}
                />
                <Input label={t('rotulo')} required autoComplete="off" placeholder={t('campos.rotuloExemplo')} error={message(fieldErrors?.label, t('campos.rotuloErro'))} {...register(`requiredAccountFields.${i}.label`)} />
                <Input label={t('campos.exemplo')} autoComplete="off" placeholder={t('campos.exemploExemplo')} hint={t('campos.exemploDica')} {...register(`requiredAccountFields.${i}.placeholder`)} />
                <Input
                  label={t('campos.padrao')}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('campos.padraoExemplo')}
                  hint={t('campos.padraoDica')}
                  error={message(fieldErrors?.pattern, t('campos.padraoErro'))}
                  {...register(`requiredAccountFields.${i}.pattern`)}
                />
              </Row>
            );
          })}
        </div>
      </Section>

      <Section
        title={t('estatisticas.titulo')}
        description={t('estatisticas.descricao')}
        action={
          <Button variant="secondary" size="sm" onClick={() => statFields.append({ key: '', label: '', when: 'always' })} iconLeft={<Plus className="size-4" aria-hidden />}>
            {t('estatisticas.adicionar')}
          </Button>
        }
      >
        {statFields.fields.length === 0 && <p className="text-sm text-muted">{t('estatisticas.vazio')}</p>}
        <div className="flex flex-col gap-3">
          {statFields.fields.map((field, i) => {
            const fieldErrors = errors.extraStatFields?.[i];
            return (
              <Row key={field.rowKey} legend={t('estatisticas.legenda', { n: String(i + 1) })} removeLabel={t('estatisticas.remover', { n: String(i + 1) })} onRemove={() => statFields.remove(i)}>
                <Input
                  label={t('chave')}
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('estatisticas.chaveExemplo')}
                  hint={t('chaveDica')}
                  error={message(fieldErrors?.key, t('chaveErro'))}
                  {...register(`extraStatFields.${i}.key`)}
                />
                <Input label={t('rotulo')} required autoComplete="off" placeholder={t('estatisticas.rotuloExemplo')} error={message(fieldErrors?.label, t('estatisticas.rotuloErro'))} {...register(`extraStatFields.${i}.label`)} />
                <Select label={t('estatisticas.quando')} options={whenOptions} hint={t('estatisticas.quandoDica')} {...register(`extraStatFields.${i}.when`)} />
              </Row>
            );
          })}
        </div>
      </Section>

      {formError && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger-soft-text">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {formError}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button variant="secondary" asChild>
          <Link href={cancelHref}>{mode === 'create' ? t('cancelar') : t('voltarCatalogo')}</Link>
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {mode === 'create' ? t('cadastrar') : t('salvar')}
        </Button>
      </div>
    </form>
  );
}
