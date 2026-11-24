'use client';

/**
 * Eventos na área do organizador (ADR-0005): `/organizador/eventos` (meus eventos), `/organizador/eventos/novo` e
 * `/organizador/eventos/[id]` (editar, regra, campeonatos do evento, excluir).
 */
import type { EventDetail } from '@nova/schemas';
import { Button, Card, ConfirmDestructive, EmptyState, ErrorState, Select, Skeleton, StatusPill, useToast, type Status } from '@nova/ui';
import { CalendarHeart, ExternalLink, Plus, PlusCircle, Trash2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useAddEventTournament, useCreateEvent, useDeleteEvent, useManagedEvent, useMyEvents, useRemoveEventTournament, useUpdateEvent } from '@/shared/api/hooks/events';
import { useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDate } from '@/shared/lib/datetime';
import { EventForm } from './EventForm';
import { EventCard, EventRuleNote } from './EventRule';
import { messages } from './messages';

/** O campeonato entra ou sai de um evento até começar (mesma regra da API). */
const EDITABLE = new Set(['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN']);

export function OrganizerEventsPage() {
  const q = useMyEvents();
  const t = useT(messages, 'OrganizerEventsPage');
  return (
    <PageContainer>
      <PageHeader
        title={t('titulo')}
        description={t('descricao')}
        actions={
          <Button asChild iconLeft={<Plus className="size-4" aria-hidden />}>
            <Link href="/organizador/eventos/novo">{t('criarEvento')}</Link>
          </Button>
        }
      />
      {q.isPending ? (
        <div role="status" aria-label={t('carregando')} className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={<CalendarHeart className="size-7" />}
          title={t('vazioTitulo')}
          description={t('vazioDescricao')}
          action={
            <Button asChild>
              <Link href="/organizador/eventos/novo">{t('criarPrimeiro')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {q.data.map((event) => (
            <li key={event.id}>
              <EventCard event={event} href={`/organizador/eventos/${event.id}`} />
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

export function NewEventPage() {
  const create = useCreateEvent();
  const router = useRouter();
  const toast = useToast();
  const t = useT(messages, 'NewEventPage');
  return (
    <PageContainer narrow>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <Card>
        <EventForm
          submitLabel={t('enviar')}
          loading={create.isPending}
          onCancel={() => router.push('/organizador/eventos')}
          onSubmit={async (input) => {
            try {
              const event = await create.mutateAsync(input);
              toast.success(t('criado'), t('criadoDescricao'));
              router.push(`/organizador/eventos/${event.id}`);
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

function EventTournaments({ event }: { event: EventDetail }) {
  const mine = useOrganizerTournaments();
  const add = useAddEventTournament(event.id);
  const remove = useRemoveEventTournament(event.id);
  const toast = useToast();
  const t = useT(messages, 'EventTournaments');
  const [selected, setSelected] = useState('');
  const candidates = (mine.data ?? []).filter((item) => !item.eventId && EDITABLE.has(item.status));
  const removeLabel = (name: string) => t.rich('retirar', { nome: name, sr: (chunks) => <span className="sr-only">{chunks}</span> });

  return (
    <section aria-labelledby="evento-campeonatos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="evento-campeonatos" className="text-lg">
          {t('titulo')}
        </h2>
        <Button asChild size="sm" iconLeft={<PlusCircle className="size-4" aria-hidden />}>
          <Link href={`/organizador/novo?evento=${event.id}`}>{t('criarNoEvento')}</Link>
        </Button>
      </div>
      <form
        className="flex flex-col gap-2 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected) return;
          add.mutate(selected, {
            onSuccess: () => {
              toast.success(t('adicionado'));
              setSelected('');
            },
            onError: (error) => toast.error(t('erroAdicionar'), errorMessage(error)),
          });
        }}
      >
        {mine.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <Select
            label={t('adicionarExistente')}
            className="min-w-0 flex-1"
            hint={candidates.length === 0 ? t('semCandidatos') : t('candidatos')}
            placeholder={t('escolha')}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            options={candidates.map((item) => ({ value: item.id, label: item.startsAt ? `${item.name} · ${formatDate(item.startsAt)}` : item.name }))}
            disabled={candidates.length === 0}
          />
        )}
        <Button type="submit" variant="secondary" className="md:mt-7" loading={add.isPending} disabled={!selected} iconLeft={<Plus className="size-4" aria-hidden />}>
          {t('adicionar')}
        </Button>
      </form>
      {event.tournaments.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {event.tournaments.map((tournament) => (
            <li key={tournament.id}>
              <Card padding="sm" className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <Link href={`/organizador/campeonatos/${tournament.id}`} className="font-semibold text-text underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {tournament.name}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <StatusPill status={tournament.status as Status} />
                    <span>{tournament.startsAt ? formatDate(tournament.startsAt) : t('semData')}</span>
                  </p>
                </div>
                {(EDITABLE.has(tournament.status) || tournament.status === 'CANCELLED') && (
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
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ManageEventPage({ id }: { id: string }) {
  const q = useManagedEvent(id);
  const update = useUpdateEvent(id);
  const del = useDeleteEvent();
  const router = useRouter();
  const toast = useToast();
  const t = useT(messages, 'ManageEventPage');
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
        {q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403) ? (
          <EmptyState
            icon={<CalendarHeart className="size-7" />}
            title={t('naoEncontradoTitulo')}
            description={t('naoEncontradoDescricao')}
            action={
              <Button asChild>
                <Link href="/organizador/eventos">{t('voltar')}</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title={t('erro')} description={errorMessage(q.error)} onRetry={() => void q.refetch()} />
        )}
      </PageContainer>
    );
  }
  const event = q.data;
  const isPublic = event.tournaments.some((item) => item.status !== 'DRAFT' && item.status !== 'CANCELLED');

  return (
    <PageContainer>
      <PageHeader
        title={event.name}
        description={<EventRuleNote rule={event.participationRule} />}
        actions={
          <>
            {isPublic && (
              <Button asChild variant="secondary" iconLeft={<ExternalLink className="size-4" aria-hidden />}>
                <Link href={`/e/${event.slug}`}>{t('verPaginaPublica')}</Link>
              </Button>
            )}
            <Button variant="danger" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setConfirming(true)}>
              {t('excluirEvento')}
            </Button>
          </>
        }
      />
      {!isPublic && <p className="text-sm text-muted">{t('paginaPublicaDica')}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="evento-dados" className="flex flex-col gap-3">
          <h2 id="evento-dados" className="text-lg">
            {t('dados')}
          </h2>
          <Card>
            <EventForm
              key={`${event.id}-${event.updatedAt}`}
              event={event}
              submitLabel={t('salvar')}
              loading={update.isPending}
              onSubmit={async (input) => {
                try {
                  await update.mutateAsync(input);
                  toast.success(t('atualizado'));
                } catch (error) {
                  toast.error(t('erroSalvar'), errorMessage(error));
                  throw error;
                }
              }}
            />
          </Card>
        </section>
        <EventTournaments event={event} />
      </div>
      <ConfirmDestructive
        open={confirming}
        onOpenChange={setConfirming}
        title={t('confirmarTitulo')}
        description={t('confirmarDescricao')}
        confirmText={event.name}
        confirmLabel={t('excluirEvento')}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(event.id, {
            onSuccess: () => {
              toast.success(t('excluido'));
              router.push('/organizador/eventos');
            },
            onError: (error) => toast.error(t('erroExcluir'), errorMessage(error)),
          })
        }
      />
    </PageContainer>
  );
}
