'use client';

import { Input, Textarea } from '@nova/ui';
import { Controller, useFormContext } from 'react-hook-form';
import { BannerUpload } from '../../components/BannerUpload';
import { RichTextEditor } from '../../components/RichTextEditor';
import { StreamLinksField } from '../../components/StreamLinksField';
import type { WizardValues } from '../../lib/draft';
import { useWizard } from '../context';

/** Passo 1 — Informações: nome, descrição, banner, premiação e transmissão. */
export function InfoStep() {
  const { register, control } = useFormContext<WizardValues>();
  const { fieldError, values } = useWizard();
  return (
    <div className="flex flex-col gap-5">
      <Input
        label="Nome do campeonato"
        required
        maxLength={80}
        autoComplete="off"
        placeholder="Ex.: Copa da Comunidade — Squad"
        hint="É o que aparece na vitrine e no link da página."
        error={fieldError('name')}
        {...register('name')}
      />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <RichTextEditor label="Descrição" value={field.value} onChange={field.onChange} hint="Conte como vai ser: formato, dias de jogo, quem pode participar." error={fieldError('description')} />
        )}
      />
      <Controller control={control} name="bannerUrl" render={({ field }) => <BannerUpload value={field.value} onChange={field.onChange} />} />
      <Textarea
        label="Premiação"
        rows={3}
        maxLength={2000}
        placeholder="Ex.: 1º lugar: troféu digital e destaque na home. 2º e 3º: medalhas no perfil."
        hint="Texto livre. A Nova Arena não processa pagamentos nesta versão."
        error={fieldError('prize')}
        {...register('prize')}
      />
      <Controller
        control={control}
        name="streamUrls"
        render={({ field }) => <StreamLinksField value={field.value} onChange={field.onChange} errors={values.streamUrls.map((_, i) => fieldError(`streamUrls.${i}`))} />}
      />
    </div>
  );
}
