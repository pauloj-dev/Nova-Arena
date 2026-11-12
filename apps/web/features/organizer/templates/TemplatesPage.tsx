'use client';

import type { TournamentTemplate } from '@nova/schemas';
import { Button, EmptyState, ErrorState, Modal, Skeleton, useToast } from '@nova/ui';
import { FileStack, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useDeleteTemplate, useTournamentTemplates } from '@/shared/api/hooks/organizer';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { TemplateCard } from './TemplateCard';

/** `/organizador/modelos` — modelos da plataforma e os meus: usar e excluir os meus (issue #24). */
export function TemplatesPage() {
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
                  <Link href={`/organizador/novo?modelo=${template.id}`} aria-label={`Usar o modelo ${template.name}`}>
                    Usar modelo
                  </Link>
                </Button>
                {template.ownerId !== null && (
                  <Button variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={`Excluir o modelo ${template.name}`} onClick={() => setRemoving(template)}>
                    Excluir
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
      <PageHeader title="Modelos" description="Um modelo guarda jogo, vagas, fases, pontuação e regulamento. Use um pronto ou salve os seus a partir de um campeonato." />
      {failure ? (
        <ErrorState
          description={errorMessage(failure)}
          onRetry={() => {
            void templates.refetch();
            void games.refetch();
          }}
        />
      ) : !templates.data || !games.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Carregando modelos">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="meus-modelos">
            <h2 id="meus-modelos" className="text-lg">
              Meus modelos
            </h2>
            {mine.length === 0 ? (
              <EmptyState
                icon={<FileStack className="size-7" />}
                title="Você ainda não salvou nenhum modelo"
                description='Em "Meus campeonatos", use "Salvar como modelo" para guardar a estrutura de um campeonato e repetir depois.'
                action={
                  <Button asChild variant="secondary">
                    <Link href="/organizador/campeonatos">Ir para Meus campeonatos</Link>
                  </Button>
                }
              />
            ) : (
              grid(mine)
            )}
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="modelos-plataforma">
            <h2 id="modelos-plataforma" className="text-lg">
              Modelos da Nova Arena
            </h2>
            {platform.length === 0 ? <p className="text-sm text-muted">Nenhum modelo da plataforma no momento.</p> : grid(platform)}
          </section>
        </>
      )}

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title="Excluir este modelo?"
        description={removing ? `"${removing.name}" some da sua lista. Os campeonatos criados a partir dele não mudam.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    success('Modelo excluído');
                    setRemoving(null);
                  },
                  onError: (e) => error('Não foi possível excluir', errorMessage(e)),
                });
              }}
            >
              Excluir modelo
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
