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
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { LeagueForm } from './LeagueForm';
import { LeagueCard } from './LeaguesPage';
import { messages } from './messages';

export function OrganizerLeaguesPage() {
  const q = useMyLeagues();
  const t = useT(messages, 'OrganizerLeaguesPage');
  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao')}
        actions={
          <Button asChild iconLeft={<Plus className="size-4" aria-hidden />}>
            <Link href="/organizador/ligas/nova">{t('criarLiga')}</Link>
          </Button>
        }
      />
      {q.isPending ? (
        <div role="status" aria-label={t('carregando')} className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-36 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={<Trophy className="size-7" />}
          title={t('vazioTitulo')}
          description={t('vazioDescricao')}
          action={
            <Button asChild>
              <Link href="/organizador/ligas/nova">{t('criarPrimeira')}</Link>
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
  const t = useT(messages, 'NewLeaguePage');
  return (
    <PageContainer narrow>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <Card>
        <LeagueForm
          submitLabel={t('enviar')}
          loading={create.isPending}
          onCancel={() => router.push('/organizador/ligas')}
          onSubmit={async (input) => {
            try {
              const league = await create.mutateAsync(input);
              toast.success(t('criada'), t('criadaDescricao'));
              router.push(`/organizador/ligas/${league.id}`);
            } catch (error) {
              toast.error(t('erroCriar'), errorMessage(error));
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
  const t = useT(messages, 'TournamentsManager');
  const [selected, setSelected] = useState('');
  const inLeague = new Set(league.tournaments.map((item) => item.id));
  const candidates = (mine.data ?? []).filter((item) => item.gameId === league.game.id && item.status !== 'CANCELLED' && !inLeague.has(item.id));
  const removeLabel = (name: string) => t.rich('retirar', { nome: name, sr: (chunks) => <span className="sr-only">{chunks}</span> });

  return (
    <section aria-labelledby="liga-campeonatos" className="flex flex-col gap-3">
      <h2 id="liga-campeonatos" className="text-lg">
        {t('titulo')}
      </h2>
      <form
        className="flex flex-col gap-2 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected) return;
          add.mutate(selected, {
            onSuccess: () => {
              toast.success(t('incluido'));
              setSelected('');
            },
            onError: (error) => toast.error(t('erroIncluir'), errorMessage(error)),
          });
        }}
      >
        {mine.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <Select
            label={t('incluirCampeonato')}
            className="min-w-0 flex-1"
            hint={candidates.length === 0 ? t('semCandidatos', { jogo: league.game.name }) : t('candidatos', { jogo: league.game.name })}
            placeholder={t('escolhaCampeonato')}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            options={candidates.map((item) => ({ value: item.id, label: item.startsAt ? `${item.name} · ${formatDate(item.startsAt)}` : item.name }))}
            disabled={candidates.length === 0}
          />
        )}
        <Button type="submit" variant="secondary" className="md:mt-7" loading={add.isPending} disabled={!selected} iconLeft={<Plus className="size-4" aria-hidden />}>
          {t('incluir')}
        </Button>
      </form>
      {league.tournaments.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {league.tournaments.map((tournament) => (
            <li key={tournament.id}>
              <Card padding="sm" className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/organizador/campeonatos/${tournament.id}`} className="font-semibold text-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {tournament.name}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <StatusPill status={tournament.status as Status} />
                    {tournament.startsAt && <span>{formatDate(tournament.startsAt)}</span>}
                    <span>{tournament.counted ? t('jaContaPontos') : t('contaQuandoTerminar')}</span>
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  iconLeft={<Trash2 className="size-4" aria-hidden />}
                  loading={remove.isPending && remove.variables === tournament.id}
                  onClick={() =>
                    remove.mutate(tournament.id, {
                      onSuccess: () => toast.success(t('retirado')),
                      onError: (error) => toast.error(t('erroRetirar'), errorMessage(error)),
                    })
                  }
                >
                  {removeLabel(tournament.name)}
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
  const t = useT(messages, 'ManageLeaguePage');
  const [confirming, setConfirming] = useState(false);

  if (q.isPending) {
    return (
      <PageContainer>
        <div role="status" aria-label={t('carregando')} className="flex flex-col gap-4">
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
          <EmptyState icon={<Trophy className="size-7" />} title={t('naoEncontradaTitulo')} description={t('naoEncontradaDescricao')} action={<Button asChild><Link href="/organizador/ligas">{t('voltar')}</Link></Button>} />
        ) : (
          <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const { league } = q.data;

  return (
    <PageContainer>
      <PageHeader
        title={league.name}
        description={t('ligaDe', { jogo: league.game.name })}
        actions={
          <>
            <Button asChild variant="secondary" iconLeft={<ExternalLink className="size-4" aria-hidden />}>
              <Link href={`/ligas/${league.slug}`}>{t('verPaginaPublica')}</Link>
            </Button>
            <Button variant="danger" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
              {t('apagarLiga')}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="liga-dados" className="flex flex-col gap-3">
          <h2 id="liga-dados" className="text-lg">
            {t('dadosEPontuacao')}
          </h2>
          <Card>
            <LeagueForm
              key={league.id}
              league={league}
              submitLabel={t('salvarAlteracoes')}
              loading={update.isPending}
              onSubmit={async (input) => {
                try {
                  await update.mutateAsync({ name: input.name, description: input.description, startsAt: input.startsAt, endsAt: input.endsAt, rule: input.rule });
                  toast.success(t('atualizada'), t('atualizadaDescricao'));
                } catch (error) {
                  toast.error(t('erroSalvar'), errorMessage(error));
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
        title={t('confirmarTitulo')}
        description={t('confirmarDescricao')}
        confirmText={league.name}
        confirmLabel={t('apagarLiga')}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(league.id, {
            onSuccess: () => {
              toast.success(t('apagada'));
              router.push('/organizador/ligas');
            },
            onError: (error) => toast.error(t('erroApagar'), errorMessage(error)),
          })
        }
      />
    </PageContainer>
  );
}
