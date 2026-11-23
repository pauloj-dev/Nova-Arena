'use client';

/**
 * `/admin/temporadas`: temporadas do ranking por jogo (issue #120). O rating é recalculado dos resultados, então criar,
 * mudar as datas ou apagar uma temporada nunca apaga partida nenhuma. Temporadas do mesmo jogo não se sobrepõem.
 */
import { SEASON_STATUS_LABELS, SeasonInput, type Season } from '@nova/schemas';
import { Badge, Button, ConfirmDestructive, DataTable, EmptyState, ErrorState, Input, Modal, Select, useToast, type Column } from '@nova/ui';
import { CalendarRange, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useGames } from '@/shared/api/hooks/games';
import { useCreateSeason, useDeleteSeason, useSeasons, useUpdateSeason } from '@/shared/api/hooks/seasons';
import { sharedMessages } from '@/shared/i18n/messages';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { isoToLocalInput, localInputToIso } from '@/shared/lib/datetime';
import { periodText } from '@/features/leagues/leagueText';
import { messages } from './messages';

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
  const t = useT(messages, 'SeasonFormModal');
  const common = useT(sharedMessages, 'comum');
  const year = new Date().getUTCFullYear() + 1;
  const form = useForm<Values>({
    defaultValues: season
      ? { gameId: season.gameId, name: season.name, startsAt: isoToLocalInput(season.startsAt), endsAt: isoToLocalInput(season.endsAt) }
      : { gameId: '', name: t('nomePadrao', { ano: String(year) }), startsAt: isoToLocalInput(`${year}-01-01T00:00:00.000Z`), endsAt: isoToLocalInput(`${year + 1}-01-01T00:00:00.000Z`) },
  });
  const { register, formState, setError, handleSubmit } = form;

  const submit = handleSubmit(async (values) => {
    const input = { gameId: season?.gameId ?? values.gameId, name: values.name, startsAt: values.startsAt ? localInputToIso(values.startsAt) : '', endsAt: values.endsAt ? localInputToIso(values.endsAt) : '' };
    const parsed = SeasonInput.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) setError((issue.path[0] as keyof Values) ?? 'name', { message: issue.path[0] === 'gameId' ? t('escolhaJogo') : issue.message });
      return;
    }
    try {
      if (season) await update.mutateAsync({ id: season.id, name: input.name, startsAt: input.startsAt, endsAt: input.endsAt });
      else await create.mutateAsync(parsed.data);
      toast.success(season ? t('atualizada') : t('criada'), t('salvaDescricao'));
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SEASON_OVERLAP') setError('startsAt', { message: error.message });
      else if (error instanceof ApiError) for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof Values, { message });
      toast.error(t('erroSalvar'), errorMessage(error));
    }
  });

  const fields = { gameId: register('gameId'), name: register('name'), startsAt: register('startsAt'), endsAt: register('endsAt') };
  const cancelLabel = common('cancelar');
  const saveLabel = common('salvar');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={season ? t('tituloEditar') : t('tituloNova')}
      description={t('descricao')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="submit" form="season-form" loading={create.isPending || update.isPending}>
            {season ? saveLabel : t('criar')}
          </Button>
        </>
      }
    >
      <form id="season-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Select
          label={t('jogo')}
          required
          disabled={Boolean(season)}
          placeholder={t('escolhaJogo')}
          options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
          {...fields.gameId}
          error={formState.errors.gameId?.message}
        />
        <Input label={t('nome')} required maxLength={60} {...fields.name} error={formState.errors.name?.message} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input label={t('inicio')} type="datetime-local" required {...fields.startsAt} error={formState.errors.startsAt?.message} />
          <Input label={t('fim')} type="datetime-local" required {...fields.endsAt} error={formState.errors.endsAt?.message} />
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
  const t = useT(messages, 'AdminSeasonsPage');
  const sr = (chunks: ReactNode) => <span className="sr-only">{chunks}</span>;
  const editLabel = (s: Season) => t.rich('editar', { nome: s.name, jogo: s.gameName, sr });
  const deleteLabel = (s: Season) => t.rich('apagar', { nome: s.name, jogo: s.gameName, sr });

  const columns: Column<Season>[] = [
    { id: 'game', header: t('colunas.jogo'), cell: (s) => s.gameName },
    { id: 'name', header: t('colunas.temporada'), primary: true, cell: (s) => <span className="font-semibold">{s.name}</span> },
    { id: 'period', header: t('colunas.periodo'), cell: (s) => periodText(s.startsAt, s.endsAt) },
    { id: 'status', header: t('colunas.situacao'), cell: (s) => <Badge tone={STATUS_TONE[s.status]} icon={<CalendarRange className="size-3.5" aria-hidden />}>{SEASON_STATUS_LABELS[s.status]}</Badge> },
    {
      id: 'actions',
      header: t('colunas.acoes'),
      align: 'right',
      cell: (s) => (
        <span className="inline-flex gap-1">
          <Button size="sm" variant="ghost" iconLeft={<Pencil className="size-4" aria-hidden />} onClick={() => setEditing(s)}>
            {editLabel(s)}
          </Button>
          <Button size="sm" variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setDeleting(s)}>
            {deleteLabel(s)}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao')}
        actions={
          <Button iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setEditing(null)}>
            {t('novaTemporada')}
          </Button>
        }
      />
      {seasons.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(seasons.error)} onRetry={() => void seasons.refetch()} />
      ) : (
        <DataTable
          caption={t('legenda')}
          columns={columns}
          rows={seasons.data ?? []}
          getRowId={(s) => s.id}
          loading={seasons.isPending}
          empty={<EmptyState icon={<CalendarRange className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />}
        />
      )}
      {editing !== undefined && <SeasonFormModal key={editing?.id ?? 'nova'} season={editing} open onOpenChange={(open) => !open && setEditing(undefined)} />}
      <ConfirmDestructive
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('confirmarTitulo')}
        description={t('confirmarDescricao')}
        confirmText={deleting?.name ?? ''}
        confirmLabel={t('apagarTemporada')}
        loading={del.isPending}
        onConfirm={() => {
          if (!deleting) return;
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(t('apagada'));
              setDeleting(null);
            },
            onError: (error) => toast.error(t('erroApagar'), errorMessage(error)),
          });
        }}
      />
    </PageContainer>
  );
}
