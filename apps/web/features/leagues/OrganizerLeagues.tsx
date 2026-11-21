'use client';

/**
 * Ligas na área do organizador (issue #120): `/organizador/ligas` (minhas ligas), `/organizador/ligas/nova` e
 * `/organizador/ligas/[id]` (editar, incluir e retirar campeonatos, apagar).
 */
import type { League } from '@nova/schemas';
import { Button, Card, ConfirmDestructive, EmptyState, ErrorState, Select, Skeleton, StatusPill, useToast, type Status } from '@nova/ui';
import { ExternalLink, Plus, Trash2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { useAddLeagueTournament, useCreateLeague, useDeleteLeague, useLeague, useMyLeagues, useRemoveLeagueTournament, useUpdateLeague } from '@/shared/api/hooks/seasons';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { LeagueForm } from './LeagueForm';
import { LeagueCard } from './LeaguesPage';

export function OrganizerLeaguesPage() {
  const q = useMyLeagues();
  return (
    <PageContainer>
      <PageHeader
        title="Minhas ligas"
        description="Agrupe seus campeonatos semanais numa liga: cada campeonato encerrado soma pontos na tabela da temporada."
        actions={
          <Button asChild iconLeft={<Plus className="size-4" aria-hidden />}>
            <Link href="/organizador/ligas/nova">Criar liga</Link>
          </Button>
        }
      />
      {q.isPending ? (
        <div role="status" aria-label="Carregando suas ligas" className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState title="Não foi possível carregar suas ligas" description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-7" />}
          title="Você ainda não tem ligas"
          description="Crie uma liga, defina os pontos por colocação e inclua os campeonatos de cada semana."
          action={
            <Button asChild>
              <Link href="/organizador/ligas/nova">Criar a primeira liga</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {q.data.map((league) => (
            <li key={league.id} className="relative">
              <LeagueCard league={league} href={`/organizador/ligas/${league.id}`} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

export function NewLeaguePage() {
  const create = useCreateLeague();
  const router = useRouter();
  const toast = useToast();
  return (
    <PageContainer narrow>
      <PageHeader title="Criar liga" description="Os pontos de cada colocação somam na tabela da liga quando um campeonato dela termina." />
      <Card>
        <LeagueForm
          submitLabel="Criar liga"
          loading={create.isPending}
          onCancel={() => router.push('/organizador/ligas')}
          onSubmit={async (input) => {
            try {
              const league = await create.mutateAsync(input);
              toast.success('Liga criada', 'Agora inclua os campeonatos da liga.');
              router.push(`/organizador/ligas/${league.id}`);
            } catch (error) {
              toast.error('Não foi possível criar a liga', errorMessage(error));
              throw error;
            }
          }}
        />
      </Card>
    </PageContainer>
  );
}

function TournamentsManager({ league }: { league: League }) {
  const mine = useOrganizerTournaments();
  const add = useAddLeagueTournament(league.id);
  const remove = useRemoveLeagueTournament(league.id);
  const toast = useToast();
  const [selected, setSelected] = useState('');
  const inLeague = new Set(league.tournaments.map((t) => t.id));
  const candidates = (mine.data ?? []).filter((t) => t.gameId === league.game.id && t.status !== 'CANCELLED' && !inLeague.has(t.id));

  return (
    <section aria-labelledby="liga-campeonatos" className="flex flex-col gap-3">
      <h2 id="liga-campeonatos" className="text-lg">
        Campeonatos da liga
      </h2>
      <form
        className="flex flex-col gap-2 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected) return;
          add.mutate(selected, {
            onSuccess: () => {
              toast.success('Campeonato incluído na liga');
              setSelected('');
            },
            onError: (error) => toast.error('Não foi possível incluir o campeonato', errorMessage(error)),
          });
        }}
      >
        {mine.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <Select
            label="Incluir campeonato"
            className="min-w-0 flex-1"
            hint={candidates.length === 0 ? `Nenhum campeonato seu de ${league.game.name} disponível. Crie o campeonato da semana e volte aqui.` : `Seus campeonatos de ${league.game.name} que ainda não estão numa liga.`}
            placeholder="Escolha um campeonato"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            options={candidates.map((t) => ({ value: t.id, label: t.startsAt ? `${t.name} · ${formatDate(t.startsAt)}` : t.name }))}
            disabled={candidates.length === 0}
          />
        )}
        <Button type="submit" variant="secondary" className="md:mt-7" loading={add.isPending} disabled={!selected} iconLeft={<Plus className="size-4" aria-hidden />}>
          Incluir
        </Button>
      </form>
      {league.tournaments.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title="A liga ainda não tem campeonatos" description="Inclua o campeonato de cada semana. Os pontos entram quando ele for encerrado." />
      ) : (
        <ul className="flex flex-col gap-2">
          {league.tournaments.map((t) => (
            <li key={t.id}>
              <Card padding="sm" className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/organizador/campeonatos/${t.id}`} className="font-semibold text-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {t.name}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <StatusPill status={t.status as Status} />
                    {t.startsAt && <span>{formatDate(t.startsAt)}</span>}
                    <span>{t.counted ? 'Já conta pontos' : 'Conta pontos quando terminar'}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Trash2 className="size-4" aria-hidden />}
                  loading={remove.isPending && remove.variables === t.id}
                  onClick={() =>
                    remove.mutate(t.id, {
                      onSuccess: () => toast.success('Campeonato retirado da liga'),
                      onError: (error) => toast.error('Não foi possível retirar o campeonato', errorMessage(error)),
                    })
                  }
                >
                  Retirar<span className="sr-only"> {t.name} da liga</span>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManageLeaguePage({ id }: { id: string }) {
  const q = useLeague(id);
  const update = useUpdateLeague(id);
  const del = useDeleteLeague();
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  if (q.isPending) {
    return (
      <PageContainer>
        <div role="status" aria-label="Carregando a liga" className="flex flex-col gap-4">
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-96 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (q.isError) {
    return (
      <PageContainer>
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={<Trophy className="size-7" />} title="Liga não encontrada" description="Ela pode ter sido apagada." action={<Button asChild><Link href="/organizador/ligas">Voltar para minhas ligas</Link></Button>} />
        ) : (
          <ErrorState title="Não foi possível carregar a liga" description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const { league } = q.data;

  return (
    <PageContainer>
      <PageHeader
        title={league.name}
        description={`Liga de ${league.game.name}`}
        actions={
          <>
            <Button asChild variant="secondary" iconLeft={<ExternalLink className="size-4" aria-hidden />}>
              <Link href={`/ligas/${league.slug}`}>Ver página pública</Link>
            </Button>
            <Button variant="danger" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
              Apagar liga
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="liga-dados" className="flex flex-col gap-3">
          <h2 id="liga-dados" className="text-lg">
            Dados e pontuação
          </h2>
          <Card>
            <LeagueForm
              key={league.id}
              league={league}
              submitLabel="Salvar alterações"
              loading={update.isPending}
              onSubmit={async (input) => {
                try {
                  await update.mutateAsync({ name: input.name, description: input.description, startsAt: input.startsAt, endsAt: input.endsAt, rule: input.rule });
                  toast.success('Liga atualizada', 'A tabela já usa a regra nova.');
                } catch (error) {
                  toast.error('Não foi possível salvar a liga', errorMessage(error));
                  throw error;
                }
              }}
            />
          </Card>
        </section>
        <TournamentsManager league={league} />
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title="Apagar a liga?"
        description="A tabela da liga deixa de existir. Os campeonatos continuam publicados, só saem da liga."
        confirmText={league.name}
        confirmLabel="Apagar liga"
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(league.id, {
            onSuccess: () => {
              toast.success('Liga apagada');
              router.push('/organizador/ligas');
            },
            onError: (error) => toast.error('Não foi possível apagar a liga', errorMessage(error)),
          })
        }
      />
    </PageContainer>
  );
}
