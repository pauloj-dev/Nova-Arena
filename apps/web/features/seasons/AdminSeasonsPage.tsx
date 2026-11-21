'use client';

/**
 * `/admin/temporadas`: temporadas do ranking por jogo (issue #120). O rating é recalculado dos resultados, então criar,
 * mudar as datas ou apagar uma temporada nunca apaga partida nenhuma. Temporadas do mesmo jogo não se sobrepõem.
 */
import { SEASON_STATUS_LABELS, SeasonInput, type Season } from '@nova/schemas';
import { Badge, Button, ConfirmDestructive, DataTable, EmptyState, ErrorState, Input, Modal, Select, useToast, type Column } from '@nova/ui';
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useCreateSeason, useDeleteSeason, useSeasons, useUpdateSeason } from '@/shared/api/hooks/seasons';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isoToLocalInput, localInputToIso } from '@/shared/lib/datetime';
import { periodText } from '@/features/leagues/leagueText';

interface Values {
  gameId: string;
  name: string;
  startsAt: string;
  endsAt: string;
}

const STATUS_TONE = { UPCOMING: 'info', ACTIVE: 'primary', ENDED: 'neutral' } as const;

function SeasonFormModal({ season, open, onOpenChange }: { season: Season | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const games = useGames({ includeInactive: true });
  const create = useCreateSeason();
  const update = useUpdateSeason();
  const toast = useToast();
  const year = new Date().getUTCFullYear() + 1;
  const form = useForm<Values>({
    defaultValues: season
      ? { gameId: season.gameId, name: season.name, startsAt: isoToLocalInput(season.startsAt), endsAt: isoToLocalInput(season.endsAt) }
      : { gameId: '', name: `Temporada ${year}`, startsAt: isoToLocalInput(`${year}-01-01T00:00:00.000Z`), endsAt: isoToLocalInput(`${year + 1}-01-01T00:00:00.000Z`) },
  });
  const { register, formState, setError, handleSubmit } = form;

  const submit = handleSubmit(async (values) => {
    const input = { gameId: season?.gameId ?? values.gameId, name: values.name, startsAt: values.startsAt ? localInputToIso(values.startsAt) : '', endsAt: values.endsAt ? localInputToIso(values.endsAt) : '' };
    const parsed = SeasonInput.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) setError((issue.path[0] as keyof Values) ?? 'name', { message: issue.path[0] === 'gameId' ? 'Escolha o jogo' : issue.message });
      return;
    }
    try {
      if (season) await update.mutateAsync({ id: season.id, name: input.name, startsAt: input.startsAt, endsAt: input.endsAt });
      else await create.mutateAsync(parsed.data);
      toast.success(season ? 'Temporada atualizada' : 'Temporada criada', 'O ranking do jogo já usa as datas novas.');
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SEASON_OVERLAP') setError('startsAt', { message: error.message });
      else if (error instanceof ApiError) for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof Values, { message });
      toast.error('Não foi possível salvar a temporada', errorMessage(error));
    }
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={season ? 'Editar temporada' : 'Nova temporada'}
      description="Partidas validadas entre o início e o fim contam no rating desta temporada. Cada temporada começa com todo mundo no rating inicial."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="season-form" loading={create.isPending || update.isPending}>
            {season ? 'Salvar' : 'Criar temporada'}
          </Button>
        </>
      }
    >
      <form id="season-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label="Jogo"
          required
          disabled={Boolean(season)}
          placeholder="Escolha o jogo"
          options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          {...register('gameId')}
          error={formState.errors.gameId?.message}
        />
        <Input label="Nome" required maxLength={60} {...register('name')} error={formState.errors.name?.message} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Início" type="datetime-local" required {...register('startsAt')} error={formState.errors.startsAt?.message} />
          <Input label="Fim" type="datetime-local" required {...register('endsAt')} error={formState.errors.endsAt?.message} />
        </div>
      </form>
    </Modal>
  );
}

export function AdminSeasonsPage() {
  const seasons = useSeasons();
  const del = useDeleteSeason();
  const toast = useToast();
  const [editing, setEditing] = useState<Season | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Season | null>(null);

  const columns: Column<Season>[] = [
    { id: 'game', header: 'Jogo', cell: (s) => s.gameName },
    { id: 'name', header: 'Temporada', primary: true, cell: (s) => <span className="font-semibold">{s.name}</span> },
    { id: 'period', header: 'Período', cell: (s) => periodText(s.startsAt, s.endsAt) },
    { id: 'status', header: 'Situação', cell: (s) => <Badge tone={STATUS_TONE[s.status]} icon={<CalendarRange className="size-3.5" aria-hidden />}>{SEASON_STATUS_LABELS[s.status]}</Badge> },
    {
      id: 'actions',
      header: 'Ações',
      align: 'right',
      cell: (s) => (
        <span className="inline-flex gap-1">
          <Button size="sm" variant="ghost" iconLeft={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(s)}>
            Editar<span className="sr-only"> {s.name} de {s.gameName}</span>
          </Button>
          <Button size="sm" variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(s)}>
            Apagar<span className="sr-only"> {s.name} de {s.gameName}</span>
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Temporadas do ranking"
        description="O rating ELO de cada jogo recomeça a cada temporada. Sem temporada em andamento, a tabela do jogo fica vazia."
        actions={
          <Button iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setEditing(null)}>
            Nova temporada
          </Button>
        }
      />
      {seasons.isError ? (
        <ErrorState title="Não foi possível carregar as temporadas" description={errorMessage(seasons.error)} onRetry={() => void seasons.refetch()} />
      ) : (
        <DataTable
          caption="Temporadas do ranking"
          columns={columns}
          rows={seasons.data ?? []}
          getRowId={(s) => s.id}
          loading={seasons.isPending}
          empty={<EmptyState icon={<CalendarRange className="size-7" />} title="Nenhuma temporada cadastrada" description="Crie a temporada de cada jogo para o ranking começar a contar." />}
        />
      )}
      {editing !== undefined && <SeasonFormModal key={editing?.id ?? 'nova'} season={editing} open onOpenChange={(open) => !open && setEditing(undefined)} />}
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Apagar a temporada?"
        description="Nenhuma partida é apagada: só a tabela desta temporada deixa de existir."
        confirmText={deleting?.name ?? ''}
        confirmLabel="Apagar temporada"
        loading={del.isPending}
        onConfirm={() => {
          if (!deleting) return;
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Temporada apagada');
              setDeleting(null);
            },
            onError: (error) => toast.error('Não foi possível apagar a temporada', errorMessage(error)),
          });
        }}
      />
    </PageContainer>
  );
}
