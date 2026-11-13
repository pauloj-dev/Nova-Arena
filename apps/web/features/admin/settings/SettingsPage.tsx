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
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { FlagsSection } from './FlagsSection';

function SettingsForm({ settings, canEdit }: { settings: SiteSettings; canEdit: boolean }) {
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

  function submit(values: SiteSettings) {
    update.mutate(values, {
      onSuccess: (saved) => {
        reset(saved);
        toast.success('Configurações salvas', 'O site já está usando os novos dados.');
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof SiteSettings, { message });
        }
        toast.error('Não foi possível salvar', errorMessage(error));
      },
    });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      setValue('logoUrl', await uploadImage(file, 'banner', { maxSide: 512 }), { shouldDirty: true });
    } catch (error) {
      toast.error('Não foi possível enviar o logo', uploadErrorMessage(error));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(submit)(event)} noValidate aria-label="Configurações do site">
      {/* `disabled` no fieldset trava todos os campos de uma vez para quem só pode ler. */}
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4">
        <Card>
          <section aria-labelledby="identidade" className="flex flex-col gap-4">
            <h2 id="identidade" className="text-lg">
              Identidade
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="Nome do site" required maxLength={40} error={errors.siteName?.message} {...register('siteName')} />
              <Input label="E-mail de suporte" type="email" required error={errors.supportEmail?.message} {...register('supportEmail')} />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-text">Logo</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 text-xs text-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imagem enviada pelo Admin, de origem variável */}
                  {logoUrl ? <img src={logoUrl} alt="Logo atual" className="size-full object-contain" /> : 'Padrão'}
                </span>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Arquivo do logo" tabIndex={-1} onChange={(event) => void pickLogo(event.target.files?.[0])} />
                <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} iconLeft={<ImagePlus className="size-4" aria-hidden />}>
                  Enviar imagem
                </Button>
                {logoUrl && (
                  <Button variant="ghost" size="sm" onClick={() => setValue('logoUrl', null, { shouldDirty: true })}>
                    Voltar ao logo padrão
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">PNG, JPG ou WebP, até 5 MB.</p>
            </div>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="home-banners" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="home-banners" className="text-lg">
                  Banners da home
                </h2>
                <p className="text-sm text-muted">Chamadas que aparecem na página inicial, na ordem abaixo.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => banners.append({ id: `hb_${Date.now().toString(36)}`, title: '', link: '/', imageUrl: null })} iconLeft={<Plus className="size-4" aria-hidden />}>
                Adicionar banner
              </Button>
            </div>
            {banners.fields.length === 0 && <p className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-sm text-muted">Nenhum banner. A home mostra só os campeonatos em destaque.</p>}
            <ul className="flex flex-col gap-3">
              {banners.fields.map((field, index) => (
                <li key={field.fieldKey} className="grid grid-cols-1 items-end gap-3 rounded-md border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input label={`Título do banner ${index + 1}`} error={errors.homeBanners?.[index]?.title?.message} {...register(`homeBanners.${index}.title`)} />
                  <Input label="Link" placeholder="/c/copa-nova-ff-squad" error={errors.homeBanners?.[index]?.link?.message} {...register(`homeBanners.${index}.link`)} />
                  <Button variant="ghost" size="sm" onClick={() => banners.remove(index)} iconLeft={<Trash2 className="size-4" aria-hidden />}>
                    Remover<span className="sr-only"> banner {index + 1}</span>
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
                Termos e privacidade
              </h2>
              <p className="text-sm text-muted">
                Aceitam HTML simples: títulos (h2, h3), parágrafos, listas, negrito, itálico e links. Qualquer outra coisa é removida na exibição.
              </p>
            </div>
            <Textarea label="Termos de uso" rows={8} error={errors.termsHtml?.message} {...register('termsHtml')} />
            <Textarea label="Política de privacidade" rows={8} error={errors.privacyHtml?.message} {...register('privacyHtml')} />
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <Link href="/termos" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
                Ver a página de Termos <ExternalLink className="size-3.5" aria-hidden />
              </Link>
              <Link href="/privacidade" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary-text hover:underline">
                Ver a página de Privacidade <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </p>
          </section>
        </Card>

        <Card>
          <section aria-labelledby="regras" className="flex flex-col gap-4">
            <h2 id="regras" className="text-lg">
              Regras da plataforma
            </h2>
            <Input
              label="Idade mínima para cadastro"
              type="number"
              inputMode="numeric"
              min={13}
              max={21}
              className="max-w-xs"
              hint="De 13 a 21 anos. O cadastro pede a data de nascimento."
              error={errors.minAge?.message}
              {...register('minAge', { valueAsNumber: true })}
            />
            <Controller
              control={control}
              name="requireApprovalForSeniorAdminRemoval"
              render={({ field }) => (
                <Switch
                  label="Remover administrador mais antigo exige aprovação do Super Admin"
                  hint="Ligada: o pedido fica pendente até você aprovar. Desligada: qualquer administrador remove outro na hora. O Super Admin nunca pode ser removido."
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
              {formState.isDirty ? 'Há mudanças não salvas.' : 'Tudo salvo.'}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!formState.isDirty || update.isPending} onClick={() => reset()}>
                Descartar
              </Button>
              <Button type="submit" loading={update.isPending} disabled={!formState.isDirty} iconLeft={<Save className="size-4" aria-hidden />}>
                Salvar configurações
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
  const { user } = useSession();
  const settings = useSiteSettingsAdmin();
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN'));

  return (
    <PageContainer>
      <PageHeader title="Configurações" description="Nome, logo, banners da home, textos legais, regras da plataforma e recursos liga/desliga." />
      {!canEdit && (
        <p role="note" className="flex items-start gap-2 rounded-lg border border-border-strong bg-info-soft px-4 py-3 text-sm text-info-soft-text" data-testid="settings-readonly">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Somente leitura.</strong> As configurações globais e os recursos são alterados apenas pelo Super Admin. Você pode consultar tudo aqui.
          </span>
        </p>
      )}
      {settings.isPending ? (
        <div className="flex flex-col gap-4" role="status" aria-label="Carregando configurações">
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
