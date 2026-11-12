'use client';

import type { Game } from '@nova/schemas';
import { Button, DataTable, EmptyState, ErrorState, Input, Modal, StatusPill, Switch, useToast, type Column } from '@nova/ui';
import { Gamepad2, Pencil, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useUpdateGame } from '@/shared/api/hooks/games-admin';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const columns: Column<Game>[] = [
  {
    id: 'name',
    header: 'Jogo',
    primary: true,
    cell: (game) => (
      <Link href={`/admin/jogos/${game.id}`} className="inline-flex min-h-11 items-center gap-3 rounded-sm font-semibold text-text hover:underline md:min-h-0">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-base text-accent-soft-text" aria-hidden>
          {game.icon}
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{game.name}</span>
      </Link>
    ),
  },
  { id: 'platform', header: 'Plataforma', cell: (game) => game.platform },
  { id: 'modes', header: 'Modos', cell: (game) => <span title={game.modes.map((m) => m.name).join(', ')}>{game.modes.map((m) => m.name).join(', ')}</span> },
  { id: 'models', header: 'Modelos de pontuação', align: 'right', cell: (game) => <span className="tabular">{game.scoringModels.filter((m) => m.ownerId === null).length}</span> },
  { id: 'status', header: 'Situação', cell: (game) => (game.active ? <StatusPill status="ACTIVE" /> : <StatusPill status="PAUSED" label="Inativo" />) },
];

/** Catálogo de jogos do Admin (ADM-06): lista com busca e liga/desliga de cada jogo. */
export function GamesCatalog() {
  const toast = useToast();
  const games = useGames({ includeInactive: true });
  const update = useUpdateGame();
  const [search, setSearch] = useState('');
  const [deactivating, setDeactivating] = useState<Game | null>(null);

  const rows = useMemo(() => {
    const term = normalize(search.trim());
    const all = [...(games.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!term) return all;
    return all.filter((game) => [game.name, game.slug, game.platform, ...game.modes.map((m) => m.name)].some((text) => normalize(text).includes(term)));
  }, [games.data, search]);

  function setActive(game: Game, active: boolean) {
    update.mutate(
      { gameId: game.id, patch: { active } },
      {
        onSuccess: () => {
          setDeactivating(null);
          toast.success(active ? 'Jogo ativado' : 'Jogo desativado', active ? `${game.name} voltou para a criação de campeonatos.` : `${game.name} saiu da criação de campeonatos.`);
        },
        onError: (error) => toast.error(active ? 'Não foi possível ativar o jogo' : 'Não foi possível desativar o jogo', errorMessage(error)),
      },
    );
  }

  const newGame = (
    <Button asChild>
      <Link href="/admin/jogos/novo">
        <Plus className="size-4" aria-hidden />
        Novo jogo
      </Link>
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title="Jogos e regras" description="Jogos do catálogo, seus modos e os modelos de pontuação que os organizadores usam nos campeonatos." actions={newGame} />

      {games.isError ? (
        <ErrorState description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      ) : (
        <>
          <Input
            label="Buscar jogo"
            type="search"
            placeholder="Nome, plataforma ou modo"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
            autoComplete="off"
          />
          <DataTable
            caption="Jogos do catálogo"
            columns={columns}
            rows={rows}
            getRowId={(game) => game.id}
            loading={games.isPending}
            rowActions={(game) => (
              <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <Switch
                  className="gap-2"
                  label={
                    <>
                      <span className="sr-only">{game.name}: </span>Ativo
                    </>
                  }
                  checked={game.active}
                  disabled={update.isPending}
                  onCheckedChange={(active) => (active ? setActive(game, true) : setDeactivating(game))}
                />
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/admin/jogos/${game.id}`} aria-label={`Editar ${game.name}`}>
                    <Pencil className="size-4" aria-hidden />
                    Editar
                  </Link>
                </Button>
              </div>
            )}
            empty={
              search.trim() ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title="Nenhum jogo encontrado"
                  description={`Nada no catálogo combina com "${search.trim()}".`}
                  action={
                    <Button variant="secondary" onClick={() => setSearch('')}>
                      Limpar busca
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<Gamepad2 className="size-7" />} title="Nenhum jogo no catálogo" description="Cadastre o primeiro jogo para os organizadores poderem criar campeonatos." action={newGame} />
              )
            }
          />
          <p className="sr-only" role="status" aria-live="polite">
            {games.isPending ? '' : `${rows.length} ${rows.length === 1 ? 'jogo' : 'jogos'} na lista.`}
          </p>
        </>
      )}

      <Modal
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setDeactivating(null);
        }}
        title={deactivating ? `Desativar ${deactivating.name}?` : 'Desativar jogo?'}
        description="O jogo some da criação de campeonatos e da lista pública de jogos. Os campeonatos que já existem continuam no ar, e você pode reativar quando quiser."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={update.isPending}>
              Voltar
            </Button>
            <Button variant="danger" loading={update.isPending} onClick={() => deactivating && setActive(deactivating, false)}>
              Desativar jogo
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
