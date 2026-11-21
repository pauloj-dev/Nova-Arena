'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { SiteSettings } from '@nova/schemas';
import { Button, Card, ErrorState, Input, Skeleton, Switch, Textarea, useToast } from '@nova/ui';
import { ExternalLink, ImagePlus, Lock, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useSiteSettingsAdmin, useUpdateSiteSettings } from '@/shared/api/hooks/admin-settings';
import { uploadErrorMessage, uploadImage } from '@/shared/api/upload';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { BlobImage } from '@/shared/lib/blob-image';
import { useSession } from '@/shared/session/useSession';
import { FlagsSection } from './FlagsSection';
import { adminSettingsMessages } from './messages';

function SettingsForm({ settings, canEdit }: { settings: SiteSettings; canEdit: boolean }) {
  const t = useT(adminSettingsMessages, 'SettingsForm');
  const toast = useToast();
  const update = useUpdateSiteSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { register, handleSubmit, control, setValue, setError, reset, formState } = useForm<SiteSettings>({
    resolver: zodResolver(SiteSettings),
    defaultValues: settings,
  });
  const banners = useFieldArray({ control, name: 'homeBanners', keyName: 'fieldKey' });
  const logoUrl = useWatch({ control, name: 'logoUrl' });
  const errors = formState.errors;
  // Registro dos campos fixos fora do JSX (o nome do campo não é texto de interface).
  const fields = {
    siteName: register('siteName'),
    supportEmail: register('supportEmail'),
    termsHtml: register('termsHtml'),
    privacyHtml: register('privacyHtml'),
    minAge: register('minAge', { valueAsNumber: true }),
  };
  const resetLogo = () => setValue('logoUrl', null, { shouldDirty: true });
  const addBanner = () => banners.append({ id: `hb_${Date.now().toString(36)}`, title: '', link: '/', imageUrl: null });

  function submit(values: SiteSettings) {
    update.mutate(values, {
      onSuccess: (saved) => {
        reset(saved);
        toast.success(t('toastSalvas'), t('toastSalvasDetalhe'));
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof SiteSettings, { message });
        }
        toast.error(t('toastErroSalvar'), errorMessage(error));
      },
    });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setValue('logoUrl', await uploadImage(file, 'banner', { maxSide: 512 }), { shouldDirty: true });
    } catch (error) {
      toast.error(t('toastErroLogo'), uploadErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(submit)(event)} noValidate aria-label={t('rotulo')}>
      {/* `disabled` no fieldset trava todos os campos de uma vez para quem só pode ler. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4">
        <Card>
          <section aria-labelledby="identidade" className="flex flex-col gap-4">
            <h2 id="identidade" className="text-lg">
              {t('identidade')}
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label={t('nomeSite')} required maxLength={40} error={errors.siteName?.message} {...fields.siteName} />
              <Input label={t('emailSuporte')} type="email" required error={errors.supportEmail?.message} {...fields.supportEmail} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">{t('logo')}</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="relative flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 text-xs text-muted">
                  {logoUrl ? <BlobImage src={logoUrl} alt={t('logoAtual')} sizes="64px" className="object-contain" /> : t('logoPadrao')}
                </span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t('arquivoLogo')} tabIndex={-1} onChange={(event) => void pickLogo(event.target.files?.[0])} />
                <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} iconLeft={<ImagePlus className="size-4" aria-hidden />}>
                  {t('enviarImagem')}
                </Button>
                {logoUrl && (
                  <Button variant="ghost" size="sm" onClick={resetLogo}>
                    {t('voltarLogoPadrao')}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">{t('formatosLogo')}</p>
            </div>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="home-banners" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="home-banners" className="text-lg">
                  {t('banners')}
                </h2>
                <p className="text-sm text-muted">{t('bannersDescricao')}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={addBanner} iconLeft={<Plus className="size-4" aria-hidden />}>
                {t('adicionarBanner')}
              </Button>
            </div>
            {banners.fields.length === 0 && <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">{t('nenhumBanner')}</p>}
            <ul className="flex flex-col gap-3">
              {banners.fields.map((field, index) => (
                <li key={field.fieldKey} className="grid grid-cols-1 items-end gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input label={t('tituloBanner', { n: String(index + 1) })} error={errors.homeBanners?.[index]?.title?.message} {...register(`homeBanners.${index}.title`)} />
                  <Input label={t('link')} placeholder={t('linkExemplo')} error={errors.homeBanners?.[index]?.link?.message} {...register(`homeBanners.${index}.link`)} />
                  <Button variant="ghost" size="sm" onClick={() => banners.remove(index)} iconLeft={<Trash2 className="size-4" aria-hidden />}>
                    {t('remover')}
                    <span className="sr-only">{t('removerSr', { n: String(index + 1) })}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="textos-legais" className="flex flex-col gap-4">
            <div>
              <h2 id="textos-legais" className="text-lg">
                {t('legais')}
              </h2>
              <p className="text-sm text-muted">
                {t('legaisDescricao')}
              </p>
            </div>
            <Textarea label={t('termos')} rows={8} error={errors.termsHtml?.message} {...fields.termsHtml} />
            <Textarea label={t('privacidade')} rows={8} error={errors.privacyHtml?.message} {...fields.privacyHtml} />
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/termos" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
                {t('verTermos')} <ExternalLink className="size-3.5" aria-hidden />
              </Link>
              <Link href="/privacidade" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
                {t('verPrivacidade')} <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </p>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="regras" className="flex flex-col gap-4">
            <h2 id="regras" className="text-lg">
              {t('regras')}
            </h2>
            <Input
              label={t('idadeMinima')}
              type="number"
              inputMode="numeric"
              min={13}
              max={21}
              className="max-w-xs"
              hint={t('idadeMinimaDica')}
              error={errors.minAge?.message}
              {...fields.minAge}
            />
            <Controller
              control={control}
              name="requireApprovalForSeniorAdminRemoval"
              render={({ field }) => (
                <Switch
                  label={t('aprovacao')}
                  hint={t('aprovacaoDica')}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={!canEdit}
                />
              )}
            />
          </section>
        </Card>

        {canEdit && (
          <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 md:mx-0 md:rounded-lg md:border">
            <p className="text-sm text-muted" role="status">
              {formState.isDirty ? t('mudancas') : t('tudoSalvo')}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!formState.isDirty || update.isPending} onClick={() => reset()}>
                {t('descartar')}
              </Button>
              <Button type="submit" loading={update.isPending} disabled={!formState.isDirty} iconLeft={<Save className="size-4" aria-hidden />}>
                {t('salvar')}
              </Button>
            </div>
          </div>
        )}
      </fieldset>
    </form>
  );
}

/** Configurações do site (ADM-09). Matriz do PRD §6: o Super Admin edita; o Admin só lê. */
export function SettingsPage() {
  const t = useT(adminSettingsMessages, 'SettingsPage');
  const { user } = useSession();
  const settings = useSiteSettingsAdmin();
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN'));
  const readOnlyNote = t.rich('somenteLeitura', { strong: (chunks) => <strong>{chunks}</strong> });

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      {!canEdit && (
        <p role="note" className="flex items-start gap-2 rounded-lg border border-border-strong bg-info-soft px-4 py-3 text-sm text-info-soft-text" data-testid="settings-readonly">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{readOnlyNote}</span>
        </p>
      )}
      {settings.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : settings.isError ? (
        <ErrorState description={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
      ) : (
        <SettingsForm settings={settings.data} canEdit={canEdit} />
      )}
      <FlagsSection canEdit={canEdit} />
    </PageContainer>
  );
}
