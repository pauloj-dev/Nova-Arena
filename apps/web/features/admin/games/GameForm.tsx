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
import { cleanGameInput, coverFileError, coverToDataUrl, DEFAULT_LOBBY_SIZE, emptyMode, gameToForm, slugify, type GameFormValues } from './game-values';

interface GameFormProps {
  mode: 'create' | 'edit';
  defaultValues: GameFormValues;
  /** Salva e devolve o jogo como ficou no servidor (os modos novos voltam com `id`). */
  onSubmit: (input: GameAdminInput) => Promise<Game>;
  cancelHref: string;
}

const WHEN_OPTIONS = [
  { value: 'always', label: 'Sempre' },
  { value: 'tiebreak', label: 'Só no desempate' },
];

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
      setCoverError(error instanceof Error ? error.message : 'Não foi possível ler esta imagem.');
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
        toast.error('Não foi possível salvar o jogo', errorMessage(error));
      }
    },
    () => setFormError('Confira os campos destacados.'),
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-6" aria-label={mode === 'create' ? 'Cadastro de jogo' : 'Dados do jogo'}>
      <Section title="Dados do jogo">
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Nome"
            required
            autoComplete="off"
            error={message(errors.name, 'Dê um nome ao jogo')}
            {...register('name', {
              onChange: (event: { target: { value: string } }) => {
                if (!slugEdited) setValue('slug', slugify(event.target.value), { shouldValidate: formState.isSubmitted });
              },
            })}
          />
          <Input
            label="Endereço (slug)"
            required
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            hint="Aparece no link da página do jogo. Só letras minúsculas, números e hífens."
            error={message(errors.slug, 'Use só letras minúsculas, números e hífens')}
            {...register('slug', { onChange: () => setSlugEdited(true) })}
          />
          <div className="flex items-start gap-3">
            <span className="mt-6 flex size-11 shrink-0 items-center justify-center rounded-md bg-accent-soft text-lg font-bold text-accent-soft-text" aria-hidden>
              {icon?.trim() || '?'}
            </span>
            <Input
              className="min-w-0 flex-1"
              label="Ícone"
              required
              autoComplete="off"
              hint="Um emoji ou uma sigla de até 4 letras. Não usamos logos oficiais dos jogos."
              error={message(errors.icon, 'Use um emoji ou uma sigla de até 4 letras')}
              {...register('icon')}
            />
          </div>
          <Input label="Plataforma" required autoComplete="off" placeholder="Ex.: Mobile" error={message(errors.platform, 'Informe a plataforma')} {...register('platform')} />

          <div className="flex flex-col gap-2 md:col-span-2">
            <Input
              label="Capa (opcional)"
              type="file"
              accept="image/*"
              inputClassName="py-2"
              hint="PNG, JPG ou WebP, até 5 MB. No protótipo a imagem fica guardada só neste navegador."
              error={coverError ?? undefined}
              onChange={(event) => {
                void chooseCover(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {coverUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL do upload simulado: não passa pelo otimizador de imagens */}
                <img src={coverUrl} alt="Capa escolhida para o jogo" className="h-24 w-44 rounded-md border border-border object-cover" />
                <Button variant="secondary" size="sm" onClick={() => setValue('coverUrl', null, { shouldDirty: true })} iconLeft={<ImageOff className="size-4" aria-hidden />}>
                  Remover capa
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted">Sem capa: a página do jogo usa o ícone no lugar.</p>
            )}
          </div>

          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <Switch
                className="md:col-span-2"
                label="Jogo ativo"
                hint="Desativado, o jogo some da criação de campeonatos e da lista pública. Os campeonatos que já existem continuam no ar."
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </div>
      </Section>

      <Section
        title="Modos"
        description="Cada modo define quantos jogadores formam uma equipe e como a partida é disputada."
        action={
          <Button variant="secondary" size="sm" onClick={() => modes.append(emptyMode(watchedModes?.[0]?.matchType))} iconLeft={<Plus className="size-4" aria-hidden />}>
            Adicionar modo
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          {modes.fields.map((field, i) => {
            const modeErrors = errors.modes?.[i];
            const battleRoyale = watchedModes?.[i]?.matchType === 'BATTLE_ROYALE';
            return (
              <Row key={field.rowKey} legend={`Modo ${i + 1}`} removeLabel={`Remover modo ${i + 1}`} removeDisabled={modes.fields.length === 1} onRemove={() => modes.remove(i)}>
                <Input label="Nome do modo" required autoComplete="off" placeholder="Ex.: Squad" error={message(modeErrors?.name, 'Dê um nome ao modo')} {...register(`modes.${i}.name`)} />
                <Select
                  label="Tipo de partida"
                  options={MATCH_TYPE_OPTIONS}
                  error={message(modeErrors?.matchType, 'Escolha o tipo de partida')}
                  {...register(`modes.${i}.matchType`, {
                    onChange: (event: { target: { value: string } }) => {
                      if (event.target.value === 'BATTLE_ROYALE' && !form.getValues(`modes.${i}.maxLobbySize`)) setValue(`modes.${i}.maxLobbySize`, DEFAULT_LOBBY_SIZE);
                    },
                  })}
                />
                <Input
                  label="Tamanho da equipe"
                  type="number"
                  min={1}
                  max={10}
                  required
                  hint="Jogadores titulares (1 a 10)."
                  error={message(modeErrors?.teamSize, 'Informe de 1 a 10 jogadores')}
                  {...register(`modes.${i}.teamSize`, { valueAsNumber: true })}
                />
                <Input
                  label="Reservas"
                  type="number"
                  min={0}
                  max={5}
                  required
                  hint="Quantos reservas a equipe pode levar (0 a 5)."
                  error={message(modeErrors?.maxSubs, 'Informe de 0 a 5 reservas')}
                  {...register(`modes.${i}.maxSubs`, { valueAsNumber: true })}
                />
                {battleRoyale && (
                  <Input
                    label="Tamanho máximo da sala"
                    type="number"
                    min={2}
                    max={100}
                    required
                    hint="Quantas equipes cabem na mesma sala (2 a 100)."
                    error={message(modeErrors?.maxLobbySize, 'Informe de 2 a 100 equipes')}
                    {...register(`modes.${i}.maxLobbySize`, { setValueAs: (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v)) })}
                  />
                )}
              </Row>
            );
          })}
        </div>
      </Section>

      <Section
        title="Campos de ID exigidos"
        description="O que o jogador precisa informar no perfil para se inscrever em campeonatos deste jogo (ex.: ID Free Fire)."
        action={
          <Button variant="secondary" size="sm" onClick={() => accountFields.append({ key: '', label: '', placeholder: '', pattern: '' })} iconLeft={<Plus className="size-4" aria-hidden />}>
            Adicionar campo
          </Button>
        }
      >
        {accountFields.fields.length === 0 && <p className="text-sm text-muted">Nenhum campo exigido. O jogador se inscreve sem informar ID do jogo.</p>}
        <div className="flex flex-col gap-3">
          {accountFields.fields.map((field, i) => {
            const fieldErrors = errors.requiredAccountFields?.[i];
            return (
              <Row key={field.rowKey} legend={`Campo de ID ${i + 1}`} removeLabel={`Remover campo de ID ${i + 1}`} onRemove={() => accountFields.remove(i)}>
                <Input
                  label="Chave"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Ex.: playerId"
                  hint="Nome interno, sem espaços nem acentos."
                  error={message(fieldErrors?.key, 'Use só letras e números, começando por uma letra')}
                  {...register(`requiredAccountFields.${i}.key`)}
                />
                <Input label="Rótulo" required autoComplete="off" placeholder="Ex.: ID Free Fire" error={message(fieldErrors?.label, 'Informe o rótulo que o jogador vai ver')} {...register(`requiredAccountFields.${i}.label`)} />
                <Input label="Exemplo" autoComplete="off" placeholder="Ex.: 1234567890" hint="Aparece dentro do campo, como dica." {...register(`requiredAccountFields.${i}.placeholder`)} />
                <Input
                  label="Padrão de validação"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Ex.: ^[0-9]{6,12}$"
                  hint="Expressão regular, opcional."
                  error={message(fieldErrors?.pattern, 'Esta expressão regular não é válida')}
                  {...register(`requiredAccountFields.${i}.pattern`)}
                />
              </Row>
            );
          })}
        </div>
      </Section>

      <Section
        title="Estatísticas extras"
        description="Números lançados no resultado além do placar (ex.: pênaltis no eFootball). Podem entrar nas regras de pontuação."
        action={
          <Button variant="secondary" size="sm" onClick={() => statFields.append({ key: '', label: '', when: 'always' })} iconLeft={<Plus className="size-4" aria-hidden />}>
            Adicionar estatística
          </Button>
        }
      >
        {statFields.fields.length === 0 && <p className="text-sm text-muted">Nenhuma estatística extra. O resultado usa só o placar padrão do tipo de partida.</p>}
        <div className="flex flex-col gap-3">
          {statFields.fields.map((field, i) => {
            const fieldErrors = errors.extraStatFields?.[i];
            return (
              <Row key={field.rowKey} legend={`Estatística extra ${i + 1}`} removeLabel={`Remover estatística extra ${i + 1}`} onRemove={() => statFields.remove(i)}>
                <Input
                  label="Chave"
                  required
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="Ex.: penalties"
                  hint="Nome interno, sem espaços nem acentos."
                  error={message(fieldErrors?.key, 'Use só letras e números, começando por uma letra')}
                  {...register(`extraStatFields.${i}.key`)}
                />
                <Input label="Rótulo" required autoComplete="off" placeholder="Ex.: Pênaltis" error={message(fieldErrors?.label, 'Informe o rótulo que aparece no resultado')} {...register(`extraStatFields.${i}.label`)} />
                <Select label="Quando aparece" options={WHEN_OPTIONS} hint="No desempate: só quando o placar empata em partida eliminatória." {...register(`extraStatFields.${i}.when`)} />
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
          <Link href={cancelHref}>{mode === 'create' ? 'Cancelar' : 'Voltar ao catálogo'}</Link>
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {mode === 'create' ? 'Cadastrar jogo' : 'Salvar jogo'}
        </Button>
      </div>
    </form>
  );
}
