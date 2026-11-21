'use client';

import type { TournamentTemplate } from '@nova/schemas';
import { Button, EmptyState, ErrorState, Modal, Skeleton, useToast } from '@nova/ui';
import { FileStack, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useDeleteTemplate, useTournamentTemplates } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { messages } from '../messages';
import { TemplateCard } from './TemplateCard';

/** `/organizador/modelos` — modelos da plataforma e os meus: usar e excluir os meus (issue #24). */
export function TemplatesPage() {
  const t = useT(messages, 'TemplatesPage');
  const templates = useTournamentTemplates();
  const games = useGames();
  const remove = useDeleteTemplate();
  const { success, error } = useToast();
  const [removing, setRemoving] = useState<TournamentTemplate | null>(null);

  const failure = (!templates.data && templates.error) || (!games.data && games.error);
  const list = templates.data ?? [];
  const mine = list.filter((t) => t.ownerId !== null);
  const platform = list.filter((t) => t.ownerId === null);

  const grid = (items: TournamentTemplate[]) => (
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((template) => (
        <li key={template.id}>
          <TemplateCard
            template={template}
            games={games.data ?? []}
            actions={
              <>
                <Button asChild>
                  <Link href={`/organizador/novo?modelo=${template.id}`} aria-label={t('usarModeloDe', { nome: template.name })}>
                    {t('usarModelo')}
                  </Link>
                </Button>
                {template.ownerId !== null && (
                  <Button variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={t('excluirModeloDe', { nome: template.name })} onClick={() => setRemoving(template)}>
                    {t('excluir')}
                  </Button>
                )}
              </>
            }
          />
        </li>
      ))}
    </ul>
  );

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      {failure ? (
        <ErrorState
          description={errorMessage(failure)}
          onRetry={() => {
            void templates.refetch();
            void games.refetch();
          }}
        />
      ) : !templates.data || !games.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label={t('carregando')}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="meus-modelos">
            <h2 id="meus-modelos" className="text-lg">
              {t('meusModelos')}
            </h2>
            {mine.length === 0 ? (
              <EmptyState
                icon={<FileStack className="size-7" />}
                title={t('nenhumMeuTitulo')}
                description={t('nenhumMeuDescricao')}
                action={
                  <Button asChild variant="secondary">
                    <Link href="/organizador/campeonatos">{t('irParaMeusCampeonatos')}</Link>
                  </Button>
                }
              />
            ) : (
              grid(mine)
            )}
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="modelos-plataforma">
            <h2 id="modelos-plataforma" className="text-lg">
              {t('modelosDaPlataforma')}
            </h2>
            {platform.length === 0 ? <p className="text-sm text-muted">{t('nenhumDaPlataforma')}</p> : grid(platform)}
          </section>
        </>
      )}

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title={t('excluirTitulo')}
        description={removing ? t('excluirDescricao', { nome: removing.name }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('voltar')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    success(t('excluido'));
                    setRemoving(null);
                  },
                  onError: (e) => error(t('erroExcluir'), errorMessage(e)),
                });
              }}
            >
              {t('excluirModelo')}
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
