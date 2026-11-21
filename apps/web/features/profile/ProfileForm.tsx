'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { UpdateMeInput, type Me } from '@nova/schemas';
import { Avatar, Button, Input, Select, Textarea, useToast } from '@nova/ui';
import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useUpdateMe } from '@/shared/api/hooks/users';
import { useT } from '@/shared/i18n/react';
import { browserTimeZone } from '@/shared/lib/datetime';
import { AvatarCropper } from './AvatarCropper';
import { validateAvatarFile } from './avatarImage';
import { EmailStatus } from './EmailStatus';
import { messages } from './messages';
import { SOCIAL_NETWORKS, socialPlaceholder, timeZoneOptions } from './profileLib';

type ProfileValues = z.input<typeof UpdateMeInput>;
const BIO_MAX = 280;

function valuesFrom(me: Me): ProfileValues {
  return {
    nickname: me.nickname,
    avatarUrl: me.avatarUrl,
    country: me.country ?? '',
    state: me.state ?? '',
    bio: me.bio ?? '',
    socials: { discord: me.socials.discord ?? '', instagram: me.socials.instagram ?? '', youtube: me.socials.youtube ?? '', twitch: me.socials.twitch ?? '' },
    timezone: me.timezone ?? browserTimeZone(),
  };
}

/** Campos do formulário que podem receber erro vindo da API (`ApiError.fieldErrors`). */
const API_FIELDS = ['nickname', 'avatarUrl', 'country', 'state', 'bio', 'timezone', 'socials.discord', 'socials.instagram', 'socials.youtube', 'socials.twitch'] as const;
type ApiField = (typeof API_FIELDS)[number];
const isApiField = (key: string): key is ApiField => (API_FIELDS as readonly string[]).includes(key);

/** Dados do perfil: apelido, avatar com recorte, local, bio, redes e fuso horário. */
export function ProfileForm({ user }: { user: Me }) {
  const t = useT(messages, 'ProfileForm');
  const { success, error } = useToast();
  const updateMe = useUpdateMe();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [cropImage, setCropImage] = useState<HTMLImageElement | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    setError,
    reset,
    formState: { errors },
  } = useForm<ProfileValues>({ resolver: zodResolver(UpdateMeInput), defaultValues: valuesFrom(user) });

  const avatarUrl = useWatch({ control, name: 'avatarUrl' }) ?? null;
  const nickname = useWatch({ control, name: 'nickname' }) ?? user.nickname;
  const bio = useWatch({ control, name: 'bio' }) ?? '';
  const avatarChanged = avatarUrl !== user.avatarUrl;
  const zones = timeZoneOptions([browserTimeZone(), user.timezone]);
  const nicknameField = register('nickname');
  const countryField = register('country');
  const stateField = register('state');
  const bioField = register('bio');
  const timezoneField = register('timezone');
  const removePhoto = () => setValue('avatarUrl', null, { shouldDirty: true });

  function closeCropper() {
    if (cropImage) URL.revokeObjectURL(cropImage.src);
    setCropImage(null);
  }

  function onFileChosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Limpa o campo para a mesma foto poder ser escolhida de novo depois de cancelar.
    e.target.value = '';
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setFileError(null);
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setCropImage(image);
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setFileError(t('erroAbrirImagem'));
    };
    image.src = objectUrl;
  }

  const onSubmit = handleSubmit((values) => {
    // A foto só vai na requisição quando mudou: evita reenviar a imagem inteira a cada edição.
    const { avatarUrl: avatar, ...rest } = values;
    updateMe.mutate(avatar !== user.avatarUrl ? { ...rest, avatarUrl: avatar ?? null } : rest, {
      onSuccess: (me) => {
        reset(valuesFrom(me));
        success(t('perfilAtualizado'));
      },
      onError: (e) => {
        let onField = false;
        if (e instanceof ApiError) {
          for (const [key, message] of Object.entries(e.fieldErrors)) {
            if (!isApiField(key)) continue;
            setError(key, { type: 'server', message }, { shouldFocus: !onField });
            onField = true;
          }
        }
        error(t('erroSalvar'), onField ? t('confiraCampos') : errorMessage(e));
      },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <EmailStatus email={user.email} verified={user.emailVerified} />

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-text">{t('foto')}</span>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={nickname || user.nickname} src={avatarUrl} size="xl" />
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" accept="image/*" aria-label={t('fotoDoPerfil')} tabIndex={-1} className="sr-only" onChange={onFileChosen} />
            <Button variant="secondary" size="sm" iconLeft={<ImageUp className="size-4" aria-hidden />} onClick={() => fileInput.current?.click()}>
              {t('trocarFoto')}
            </Button>
            {avatarUrl && (
              <Button variant="ghost" size="sm" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={removePhoto}>
                {t('removerFoto')}
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted">{t('fotoDica')}</p>
        {avatarChanged && (
          <p role="status" className="text-xs font-medium text-warning-soft-text">
            {t('fotoPendente', { estado: avatarUrl ? 'nova' : 'removida' })}
          </p>
        )}
        {(fileError ?? errors.avatarUrl?.message) && (
          <p role="alert" className="text-xs font-medium text-danger">
            {fileError ?? errors.avatarUrl?.message}
          </p>
        )}
      </div>

      <Input label={t('apelido')} autoComplete="nickname" required hint={t('apelidoDica')} error={errors.nickname?.message} {...nicknameField} />

      <div className="grid gap-4 xs:grid-cols-2">
        <Input label={t('pais')} autoComplete="country-name" maxLength={60} error={errors.country?.message} {...countryField} />
        <Input label={t('estado')} placeholder={t('estadoPlaceholder')} autoComplete="address-level1" maxLength={60} error={errors.state?.message} {...stateField} />
      </div>

      <Textarea
        label={t('bio')}
        rows={3}
        maxLength={BIO_MAX}
        hint={
          <>
            {t('bioDica')} <span className="tabular">{bio.length}/{BIO_MAX}</span>
          </>
        }
        error={errors.bio?.message}
        {...bioField}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-semibold text-text">{t('redesSociais')}</legend>
        <div className="grid gap-4 xs:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <Input key={network.key} label={network.label} placeholder={socialPlaceholder(network.key)} autoComplete="off" error={errors.socials?.[network.key]?.message} {...register(`socials.${network.key}`)} />
          ))}
        </div>
        <p className="text-xs text-muted">{t('redesDica')}</p>
      </fieldset>

      <Select label={t('fuso')} options={zones} hint={t('fusoDica')} error={errors.timezone?.message} {...timezoneField} />

      <div>
        <Button type="submit" loading={updateMe.isPending}>
          {t('salvar')}
        </Button>
      </div>

      <AvatarCropper
        image={cropImage}
        onCancel={closeCropper}
        onConfirm={(dataUrl) => {
          setValue('avatarUrl', dataUrl, { shouldDirty: true });
          closeCropper();
        }}
      />
    </form>
  );
}
