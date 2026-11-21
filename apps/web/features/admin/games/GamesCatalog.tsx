'use client';

import type { Game } from '@nova/schemas';
import { Button, DataTable, EmptyState, ErrorState, Input, Modal, StatusPill, Switch, useToast, type Column } from '@nova/ui';
import { Gamepad2, Pencil, Plus, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useUpdateGame } from '@/shared/api/hooks/games-admin';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { adminGamesMessages } from './messages';

type CatalogT = ReturnType<typeof useT<(typeof adminGamesMessages)['pt-BR'], 'GamesCatalog'>>;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function buildColumns(t: CatalogT): Column<Game>[] {
  return [
  {
    id: 'name',
    header: t('colunaJogo'),
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
  { id: 'platform', header: t('colunaPlataforma'), cell: (game) => game.platform },
  { id: 'modes', header: t('colunaModos'), cell: (game) => <span title={game.modes.map((m) => m.name).join(', ')}>{game.modes.map((m) => m.name).join(', ')}</span> },
  { id: 'models', header: t('colunaModelos'), align: 'right', cell: (game) => <span className="tabular">{game.scoringModels.filter((m) => m.ownerId === null).length}</span> },
  { id: 'status', header: t('colunaSituacao'), cell: (game) => (game.active ? <StatusPill status="ACTIVE" /> : <StatusPill status="PAUSED" label={t('inativo')} />) },
  ];
}

/** Catálogo de jogos do Admin (ADM-06): lista com busca e liga/desliga de cada jogo. */
export function GamesCatalog() {
  const t = useT(adminGamesMessages, 'GamesCatalog');
  const columns = useMemo(() => buildColumns(t), [t]);
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
          toast.success(active ? t('toastAtivado') : t('toastDesativado'), active ? t('toastAtivadoDetalhe', { nome: game.name }) : t('toastDesativadoDetalhe', { nome: game.name }));
        },
        onError: (error) => toast.error(active ? t('erroAtivar') : t('erroDesativar'), errorMessage(error)),
      },
    );
  }

  const newGame = (
    <Button asChild>
      <Link href="/admin/jogos/novo">
        <Plus className="size-4" aria-hidden />
        {t('novoJogo')}
      </Link>
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} actions={newGame} />

      {games.isError ? (
        <ErrorState description={errorMessage(games.error)} onRetry={() => void games.refetch()} />
      ) : (
        <>
          <Input
            label={t('buscar')}
            type="search"
            placeholder={t('buscarExemplo')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-md"
            autoComplete="off"
          />
          <DataTable
            caption={t('legenda')}
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
                      <span className="sr-only">{t('ativoSr', { nome: game.name })}</span>
                      {t('ativo')}
                    </>
                  }
                  checked={game.active}
                  disabled={update.isPending}
                  onCheckedChange={(active) => (active ? setActive(game, true) : setDeactivating(game))}
                />
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/admin/jogos/${game.id}`} aria-label={t('editarRotulo', { nome: game.name })}>
                    <Pencil className="size-4" aria-hidden />
                    {t('editar')}
                  </Link>
                </Button>
              </div>
            )}
            empty={
              search.trim() ? (
                <EmptyState
                  icon={<SearchX className="size-7" />}
                  title={t('nenhumEncontrado')}
                  description={t('nadaCombina', { busca: search.trim() })}
                  action={
                    <Button variant="secondary" onClick={() => setSearch('')}>
                      {t('limparBusca')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<Gamepad2 className="size-7" />} title={t('catalogoVazio')} description={t('catalogoVazioDescricao')} action={newGame} />
              )
            }
          />
          <p className="sr-only" role="status" aria-live="polite">
            {games.isPending ? '' : t('naLista', { count: rows.length, n: String(rows.length) })}
          </p>
        </>
      )}

      <Modal
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open && !update.isPending) setDeactivating(null);
        }}
        title={deactivating ? t('desativarTitulo', { nome: deactivating.name }) : t('desativarTituloGenerico')}
        description={t('desativarDescricao')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeactivating(null)} disabled={update.isPending}>
              {t('voltar')}
            </Button>
            <Button variant="danger" loading={update.isPending} onClick={() => deactivating && setActive(deactivating, false)}>
              {t('desativar')}
            </Button>
          </>
        }
      />
    </PageContainer>
  );
}
