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
import { BannerUpload } from '../components/BannerUpload';
import { RichTextView } from '../components/RichText';
import { RichTextEditor } from '../components/RichTextEditor';
import { StreamLinksField } from '../components/StreamLinksField';
import { isReadOnly } from '../lib/status';

const PublicPageInput = TournamentDraftInput.pick({ description: true, rules: true, prize: true, bannerUrl: true, streamUrls: true }).required();
type PublicPageForm = z.infer<typeof PublicPageInput>;

/** Aba Página pública (ORG-13): banner, descrição, regulamento, premiação e transmissão — também depois de publicado. */
export function PublicPageTab({ tournament: t }: { tournament: OrganizerTournamentDetail }) {
  const save = useSaveTournament();
  const { success, error } = useToast();
  const form = useForm<PublicPageForm>({
    resolver: zodResolver(PublicPageInput),
    defaultValues: { description: t.description, rules: t.rules, prize: t.prize, bannerUrl: t.bannerUrl, streamUrls: t.streamUrls },
  });
  const { errors, isDirty } = form.formState;
  const readOnly = isReadOnly(t.status);

  if (readOnly) {
    return (
      <div className="flex flex-col gap-6">
        <p className="rounded-md bg-neutral-soft px-3 py-2 text-sm text-neutral-soft-text">Este campeonato foi encerrado: a página fica só para consulta.</p>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Descrição</h2>
          <RichTextView html={t.description} empty="Sem descrição." />
        </Card>
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg">Regulamento</h2>
          <RichTextView html={t.rules} empty="Sem regulamento." />
        </Card>
      </div>
    );
  }

  const streamErrors = Array.isArray(errors.streamUrls) ? errors.streamUrls.map((e) => e?.message) : [];

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) =>
        void form.handleSubmit((input) =>
          save.mutate(
            { id: t.id, input },
            {
              onSuccess: (saved) => {
                success('Página atualizada', saved.status === 'DRAFT' ? undefined : 'As mudanças já aparecem na página pública.');
                form.reset({ description: saved.description, rules: saved.rules, prize: saved.prize, bannerUrl: saved.bannerUrl, streamUrls: saved.streamUrls });
              },
              onError: (e) => {
                if (e instanceof ApiError) {
                  for (const [field, message] of Object.entries(e.fieldErrors)) {
                    if (field === 'rules' || field === 'description' || field === 'prize') form.setError(field, { message });
                  }
                }
                error('Não foi possível salvar a página', errorMessage(e));
              },
            },
          ),
        )(event)
      }
    >
      <Card className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">Apresentação</h2>
            <p className="text-sm text-muted">É o que o participante vê antes de se inscrever.</p>
          </div>
          {t.status !== 'DRAFT' && (
            <Button asChild variant="ghost" size="sm">
              <Link href={`/c/${t.slug}`}>
                <ExternalLink className="size-4" aria-hidden />
                Abrir a página
              </Link>
            </Button>
          )}
        </div>
        <Controller control={form.control} name="bannerUrl" render={({ field }) => <BannerUpload value={field.value} onChange={field.onChange} />} />
        <Controller control={form.control} name="description" render={({ field }) => <RichTextEditor label="Descrição" value={field.value} onChange={field.onChange} error={errors.description?.message} />} />
        <Textarea label="Premiação" rows={3} maxLength={2000} hint="Texto livre." error={errors.prize?.message} {...form.register('prize')} />
        <Controller control={form.control} name="streamUrls" render={({ field }) => <StreamLinksField value={field.value} onChange={field.onChange} errors={streamErrors} />} />
      </Card>

      <Card className="flex flex-col gap-5">
        <div>
          <h2 className="text-lg">Regulamento</h2>
          <p className="text-sm text-muted">Quem já se inscreveu aceitou a versão anterior: avise nos comunicados quando mudar algo importante.</p>
        </div>
        <Controller control={form.control} name="rules" render={({ field }) => <RichTextEditor label="Regulamento" size="lg" value={field.value} onChange={field.onChange} error={errors.rules?.message} />} />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={save.isPending} disabled={!isDirty} iconLeft={<Save className="size-4" aria-hidden />}>
          Salvar página
        </Button>
        {isDirty && (
          <Button variant="ghost" onClick={() => form.reset()}>
            Descartar alterações
          </Button>
        )}
        <p className="text-sm text-muted" role="status">
          {isDirty ? 'Há alterações não salvas.' : 'Tudo salvo.'}
        </p>
      </div>
    </form>
  );
}
