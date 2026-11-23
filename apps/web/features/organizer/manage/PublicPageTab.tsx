'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { TournamentDraftInput, type OrganizerTournamentDetail } from '@nova/schemas';
import { Button, Card, Textarea, useToast } from '@nova/ui';
import { ExternalLink, Save } from 'lucide-react';
import Link from 'next/link';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useSaveTournament } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { BannerUpload } from '../components/BannerUpload';
import { RichTextView } from '../components/RichText';
import { RichTextEditor } from '../components/LazyRichTextEditor';
import { StreamLinksField } from '../components/StreamLinksField';
import { isReadOnly } from '../lib/status';
import { messages } from './messages';

const PublicPageInput = TournamentDraftInput.pick({ description: true, rules: true, prize: true, bannerUrl: true, streamUrls: true }).required();
type PublicPageForm = z.infer<typeof PublicPageInput>;

/** Aba Página pública (ORG-13): banner, descrição, regulamento, premiação e transmissão — também depois de publicado. */
export function PublicPageTab({ tournament }: { tournament: OrganizerTournamentDetail }) {
  const t = useT(messages, 'PublicPageTab');
  const save = useSaveTournament();
  const { success, error } = useToast();
  const form = useForm<PublicPageForm>({
    resolver: zodResolver(PublicPageInput),
    defaultValues: { description: tournament.description, rules: tournament.rules, prize: tournament.prize, bannerUrl: tournament.bannerUrl, streamUrls: tournament.streamUrls },
  });
  const { errors, isDirty } = form.formState;
  const readOnly = isReadOnly(tournament.status);

  if (readOnly) {
    return (
      <div className="flex flex-col gap-6">
        <p className="rounded-md bg-neutral-soft px-3 py-2 text-sm text-neutral-soft-text">{t('encerrado')}</p>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('descricao')}</h2>
          <RichTextView html={tournament.description} empty={t('semDescricao')} />
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">{t('regulamento')}</h2>
          <RichTextView html={tournament.rules} empty={t('semRegulamento')} />
        </Card>
      </div>
    );
  }

  const streamErrors = Array.isArray(errors.streamUrls) ? errors.streamUrls.map((e) => e?.message) : [];

  const prizeField = form.register('prize');

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) =>
        void form.handleSubmit((input) =>
          save.mutate(
            { id: tournament.id, input },
            {
              onSuccess: (saved) => {
                success(t('atualizada'), saved.status === 'DRAFT' ? undefined : t('atualizadaDescricao'));
                form.reset({ description: saved.description, rules: saved.rules, prize: saved.prize, bannerUrl: saved.bannerUrl, streamUrls: saved.streamUrls });
              },
              onError: (e) => {
                if (e instanceof ApiError) {
                  for (const [field, message] of Object.entries(e.fieldErrors)) {
                    if (field === 'rules' || field === 'description' || field === 'prize') form.setError(field, { message });
                  }
                }
                error(t('erroSalvar'), errorMessage(e));
              },
            },
          ),
        )(event)
      }
    >
      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">{t('apresentacao')}</h2>
            <p className="text-sm text-muted">{t('apresentacaoDescricao')}</p>
          </div>
          {tournament.status !== 'DRAFT' && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/c/${tournament.slug}`}>
                <ExternalLink className="size-4" aria-hidden />
                {t('abrirPagina')}
              </Link>
            </Button>
          )}
        </div>
        <Controller control={form.control} name="bannerUrl" render={({ field }) => <BannerUpload value={field.value} onChange={field.onChange} />} />
        <Controller control={form.control} name="description" render={({ field }) => <RichTextEditor label={t('descricao')} value={field.value} onChange={field.onChange} error={errors.description?.message} />} />
        <Textarea label={t('premiacao')} rows={3} maxLength={2000} hint={t('textoLivre')} error={errors.prize?.message} {...prizeField} />
        <Controller control={form.control} name="streamUrls" render={({ field }) => <StreamLinksField value={field.value} onChange={field.onChange} errors={streamErrors} />} />
      </Card>

      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg">{t('regulamento')}</h2>
          <p className="text-sm text-muted">{t('regulamentoDescricao')}</p>
        </div>
        <Controller control={form.control} name="rules" render={({ field }) => <RichTextEditor label={t('regulamento')} size="lg" value={field.value} onChange={field.onChange} error={errors.rules?.message} />} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={save.isPending} disabled={!isDirty} iconLeft={<Save className="size-4" aria-hidden />}>
          {t('salvarPagina')}
        </Button>
        {isDirty && (
          <Button variant="ghost" onClick={() => form.reset()}>
            {t('descartar')}
          </Button>
        )}
        <p className="text-sm text-muted" role="status">
          {isDirty ? t('naoSalvas') : t('tudoSalvo')}
        </p>
      </div>
    </form>
  );
}
