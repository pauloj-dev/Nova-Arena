'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TeamInput, type Team } from '@nova/schemas';
import { Button, Input, Modal, useToast } from '@nova/ui';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateTeam, useUpdateTeam } from '@/shared/api/hooks/teams';
import { useT } from '@/shared/i18n/react';
import { fileToLogoDataUrl } from './lib/logoImage';
import { LOGO_ACCEPT } from './lib/rules';
import { messages } from './messages';
import { TeamLogo } from './TeamLogo';

interface TeamFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Com `team`, edita; sem, cria. */
  team?: Team;
  onSaved?: (team: Team) => void;
}

/** Criar ou editar squad: nome, tag e logo opcional. */
export function TeamFormModal({ open, onOpenChange, team, onSaved }: TeamFormModalProps) {
  const t = useT(messages, 'TeamFormModal');
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={team ? t('tituloEditar') : t('tituloCriar')}
      description={team ? t('descricaoEditar') : t('descricaoCriar')}
      size="sm"
    >
      {/* O formulário só existe com o modal aberto: cada abertura começa dos dados atuais. */}
      {open && <TeamForm team={team} onCancel={() => onOpenChange(false)} onSaved={onSaved} />}
    </Modal>
  );
}

function TeamForm({ team, onCancel, onSaved }: { team?: Team; onCancel: () => void; onSaved?: (team: Team) => void }) {
  const { success, error } = useToast();
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const saving = create.isPending || update.isPending;
  const fileRef = useRef<HTMLInputElement>(null);
  const logoErrorId = useId();
  const [logoError, setLogoError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const t = useT(messages, 'TeamForm');

  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<TeamInput>({
    resolver: zodResolver(TeamInput),
    defaultValues: { name: team?.name ?? '', tag: team?.tag ?? '', logoUrl: team?.logoUrl ?? null },
  });
  const tag = useWatch({ control, name: 'tag' });

  async function onPickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Limpa o campo para a mesma imagem poder ser escolhida de novo depois de um erro.
    e.target.value = '';
    if (!file) return;
    setLogoError(null);
    setReading(true);
    try {
      setValue('logoUrl', await fileToLogoDataUrl(file), { shouldDirty: true });
    } catch (problem) {
      setLogoError(problem instanceof Error ? problem.message : t('erroLerImagem'));
    } finally {
      setReading(false);
    }
  }

  const onSubmit = handleSubmit((values) => {
    const input: TeamInput = { name: values.name.trim(), tag: values.tag.trim().toUpperCase(), logoUrl: values.logoUrl ?? null };
    const options = {
      onSuccess: (saved: Team) => {
        success(team ? t('atualizado') : t('criado', { nome: saved.name }), team ? undefined : t('criadoDescricao'));
        onSaved?.(saved);
        onCancel();
      },
      onError: (e: unknown) => {
        let onField = false;
        if (e instanceof ApiError) {
          for (const field of ['name', 'tag'] as const) {
            const message = e.fieldErrors[field];
            if (!message) continue;
            setError(field, { type: 'server', message }, { shouldFocus: !onField });
            onField = true;
          }
          if (e.fieldErrors.logoUrl) {
            setLogoError(e.fieldErrors.logoUrl);
            onField = true;
          }
        }
        error(team ? t('erroSalvar') : t('erroCriar'), onField ? t('confiraCampos') : errorMessage(e));
      },
    };
    if (team) update.mutate(input, options);
    else create.mutate(input, options);
  });

  const nameField = register('name');
  const tagField = register('tag');

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input label={t('nome')} autoComplete="off" maxLength={30} required error={errors.name?.message} {...nameField} />
      <Input
        label={t('tag')}
        hint={t('tagDica')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={5}
        required
        inputClassName="uppercase"
        error={errors.tag?.message}
        {...tagField}
      />

      <Controller
        control={control}
        name="logoUrl"
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text">{t('logo')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <TeamLogo tag={(tag || '?').toUpperCase()} logoUrl={field.value ?? null} size="lg" />
              <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="sr-only" tabIndex={-1} aria-label={t('arquivoLogo')} aria-describedby={logoError ? logoErrorId : undefined} onChange={(e) => void onPickLogo(e)} />
              <Button variant="secondary" size="sm" loading={reading} iconLeft={<ImagePlus className="size-4" aria-hidden />} onClick={() => fileRef.current?.click()}>
                {field.value ? t('trocarImagem') : t('escolherImagem')}
              </Button>
              {field.value && (
                <Button variant="ghost" size="sm" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => field.onChange(null)}>
                  {t('remover')}
                </Button>
              )}
            </div>
            {logoError ? (
              <p id={logoErrorId} role="alert" className="text-xs font-medium text-danger">
                {logoError}
              </p>
            ) : (
              <p className="text-xs text-muted">{t('logoDica')}</p>
            )}
          </div>
        )}
      />

      <div className="flex flex-col-reverse gap-2 pt-2 md:flex-row md:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t('cancelar')}
        </Button>
        <Button type="submit" loading={saving}>
          {team ? t('salvar') : t('criarSquad')}
        </Button>
      </div>
    </form>
  );
}
