'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { GlobalAnnouncementInput, type GlobalAnnouncement } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, Skeleton, Switch, Textarea, useToast } from '@nova/ui';
import { BellRing, Megaphone, Send, Wrench } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useCreateGlobalAnnouncement, useGlobalAnnouncements, useToggleGlobalAnnouncement } from '@/shared/api/hooks/admin-tournaments';
import { useGames } from '@/shared/api/hooks/games';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative, localInputToIso } from '@/shared/lib/datetime';

type Kind = GlobalAnnouncement['kind'];
type Audience = GlobalAnnouncement['audience'];

/** Campos do formulário: as datas ficam no formato do `<input type="datetime-local">` e viram ISO ao enviar. */
interface FormValues {
  kind: Kind;
  audience: Audience;
  gameId: string;
  title: string;
  body: string;
  startsAt: string;
  endsAt: string;
}

const KIND: Record<Kind, { label: string; hint: string; icon: typeof Megaphone; submit: string }> = {
  BANNER: { label: 'Banner no topo do site', hint: 'Fica no topo até você desativar (ou até a data final). Quem vê pode dispensar.', icon: Megaphone, submit: 'Publicar banner' },
  NOTIFICATION: { label: 'Notificação', hint: 'Vai uma vez para o sino de cada pessoa do público escolhido.', icon: BellRing, submit: 'Enviar notificação' },
  MAINTENANCE: { label: 'Aviso de manutenção', hint: 'Aparece no topo 48 horas antes do início. Durante a manutenção, não pode ser dispensado.', icon: Wrench, submit: 'Agendar aviso' },
};
const AUDIENCE: Record<Audience, string> = { ALL: 'Todos', ORGANIZERS: 'Organizadores', GAME: 'Inscritos de um jogo' };

function toInput(values: FormValues): unknown {
  const iso = (value: string) => {
    if (!value) return null;
    try {
      return localInputToIso(value);
    } catch {
      return null;
    }
  };
  return {
    kind: values.kind,
    audience: values.audience,
    gameId: values.audience === 'GAME' ? values.gameId || null : null,
    title: values.title.trim(),
    body: values.body.trim(),
    startsAt: values.kind === 'NOTIFICATION' ? null : iso(values.startsAt),
    endsAt: values.kind === 'NOTIFICATION' ? null : iso(values.endsAt),
  };
}

const baseResolver = zodResolver(GlobalAnnouncementInput);

function AnnouncementForm() {
  const toast = useToast();
  const games = useGames();
  const create = useCreateGlobalAnnouncement();
  const { register, handleSubmit, control, reset, setError, formState } = useForm<FormValues>({
    defaultValues: { kind: 'BANNER', audience: 'ALL', gameId: '', title: '', body: '', startsAt: '', endsAt: '' },
    // Valida com o contrato da API, depois de converter as datas locais para ISO.
    resolver: async (values, context, options) => {
      const result = await baseResolver(toInput(values) as never, context, options as never);
      const errors: Record<string, { type: string; message: string }> = { ...(result.errors as Record<string, { type: string; message: string }>) };
      if (values.audience === 'GAME' && !values.gameId) errors.gameId = { type: 'required', message: 'Escolha o jogo' };
      if (values.kind === 'MAINTENANCE') {
        if (!values.startsAt) errors.startsAt = { type: 'required', message: 'Informe quando a manutenção começa' };
        if (!values.endsAt) errors.endsAt = { type: 'required', message: 'Informe quando a manutenção termina' };
      }
      if (values.kind !== 'NOTIFICATION' && values.startsAt && values.endsAt && values.endsAt <= values.startsAt) errors.endsAt = { type: 'validate', message: 'O fim precisa ser depois do início' };
      return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
    },
  });
  const kind = useWatch({ control, name: 'kind' });
  const audience = useWatch({ control, name: 'audience' });
  const body = useWatch({ control, name: 'body' });
  const errors = formState.errors;

  function submit(values: FormValues) {
    create.mutate(GlobalAnnouncementInput.parse(toInput(values)), {
      onSuccess: (created) => {
        toast.success(created.kind === 'NOTIFICATION' ? 'Notificação enviada' : created.kind === 'MAINTENANCE' ? 'Aviso de manutenção agendado' : 'Banner publicado', created.title);
        reset();
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof FormValues, { message });
        }
        toast.error('Não foi possível criar o comunicado', errorMessage(error));
      },
    });
  }

  return (
    <Card>
      <form onSubmit={(event) => void handleSubmit(submit)(event)} className="flex flex-col gap-4" noValidate aria-label="Novo comunicado">
        <h2 className="text-lg">Novo comunicado</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select label="Tipo" options={(Object.keys(KIND) as Kind[]).map((k) => ({ value: k, label: KIND[k].label }))} hint={KIND[kind].hint} {...register('kind')} />
          <Select label="Público" options={(Object.keys(AUDIENCE) as Audience[]).map((a) => ({ value: a, label: AUDIENCE[a] }))} {...register('audience')} />
        </div>
        {audience === 'GAME' && (
          <Select
            label="Jogo"
            required
            placeholder={games.isPending ? 'Carregando jogos…' : 'Escolha o jogo'}
            options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
            hint="Recebe quem tem inscrição ativa em campeonato do jogo ou segue o jogo."
            error={errors.gameId?.message}
            {...register('gameId')}
          />
        )}
        <Input label="Título" required maxLength={80} error={errors.title?.message} {...register('title')} />
        <Textarea label="Mensagem" required rows={3} maxLength={500} hint={`${body.length}/500 caracteres. Texto simples, sem formatação.`} error={errors.body?.message} {...register('body')} />
        {kind !== 'NOTIFICATION' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={kind === 'MAINTENANCE' ? 'Início da manutenção' : 'Começa a aparecer em (opcional)'}
              type="datetime-local"
              required={kind === 'MAINTENANCE'}
              hint="No seu fuso horário."
              error={errors.startsAt?.message}
              {...register('startsAt')}
            />
            <Input
              label={kind === 'MAINTENANCE' ? 'Fim da manutenção' : 'Some em (opcional)'}
              type="datetime-local"
              required={kind === 'MAINTENANCE'}
              hint="No seu fuso horário."
              error={errors.endsAt?.message}
              {...register('endsAt')}
            />
          </div>
        )}
        <Button type="submit" loading={create.isPending} className="self-start" iconLeft={<Send className="size-4" aria-hidden />}>
          {KIND[kind].submit}
        </Button>
      </form>
    </Card>
  );
}

function situation(a: GlobalAnnouncement, now: number): { text: string; tone: 'primary' | 'neutral' | 'warning' | 'info' } {
  if (a.kind === 'NOTIFICATION') return { text: 'Enviada', tone: 'neutral' };
  if (!a.active) return { text: 'Desativado', tone: 'neutral' };
  const start = a.startsAt ? new Date(a.startsAt).getTime() : null;
  const end = a.endsAt ? new Date(a.endsAt).getTime() : null;
  if (end !== null && now >= end) return { text: 'Encerrado', tone: 'neutral' };
  if (a.kind === 'MAINTENANCE' && start !== null) {
    if (now >= start) return { text: 'Manutenção em curso', tone: 'warning' };
    return now >= start - 48 * 3600_000 ? { text: 'No ar (aviso prévio)', tone: 'primary' } : { text: 'Agendado', tone: 'info' };
  }
  if (start !== null && now < start) return { text: 'Agendado', tone: 'info' };
  return { text: 'No ar', tone: 'primary' };
}

/** Comunicados globais (ADM-11): banner no topo, notificação para um segmento e aviso de manutenção. */
export function AnnouncementsPage() {
  const toast = useToast();
  const announcements = useGlobalAnnouncements();
  const games = useGames({ includeInactive: true });
  const toggle = useToggleGlobalAnnouncement();
  // A situação ("no ar", "agendado") depende da hora; ela é lida uma vez, quando a tela abre.
  const [now] = useState(() => Date.now());

  return (
    <PageContainer>
      <PageHeader title="Comunicados" description="Fale com a plataforma inteira ou com um grupo: banner no topo do site, notificação no sino ou aviso de manutenção." />
      <AnnouncementForm />

      <section aria-labelledby="comunicados-lista" className="flex flex-col gap-3">
        <h2 id="comunicados-lista" className="text-lg">
          Comunicados criados
        </h2>
        {announcements.isPending ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Carregando comunicados">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : announcements.isError ? (
          <ErrorState description={errorMessage(announcements.error)} onRetry={() => void announcements.refetch()} />
        ) : announcements.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-7" />} title="Nenhum comunicado ainda" description="Crie o primeiro no formulário acima. Banners e avisos de manutenção aparecem no topo do site." />
        ) : (
          <ul className="flex flex-col gap-3">
            {announcements.data.map((a) => {
              const Icon = KIND[a.kind].icon;
              const state = situation(a, now);
              const gameName = a.gameId ? games.data?.find((g) => g.id === a.gameId)?.name : undefined;
              return (
                <li key={a.id}>
                  <Card padding="sm" className="flex flex-col gap-2" data-testid="announcement">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-2 font-semibold [overflow-wrap:anywhere]">
                        <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                        {a.title}
                      </p>
                      <Badge tone={state.tone}>{state.text}</Badge>
                    </div>
                    <p className="text-sm [overflow-wrap:anywhere]">{a.body}</p>
                    <p className="text-xs text-muted">
                      {KIND[a.kind].label} · Público: {AUDIENCE[a.audience]}
                      {gameName ? ` (${gameName})` : ''} · por {a.authorNickname}, {formatRelative(a.createdAt)}
                    </p>
                    {(a.startsAt || a.endsAt) && (
                      <p className="text-xs text-muted">
                        {a.startsAt && `De ${formatDateTime(a.startsAt, { withZone: false })}`}
                        {a.endsAt && ` até ${formatDateTime(a.endsAt)}`}
                      </p>
                    )}
                    {a.kind !== 'NOTIFICATION' && (
                      <Switch
                        className="self-start gap-3"
                        label={
                          <>
                            Ativo<span className="sr-only">: {a.title}</span>
                          </>
                        }
                        checked={a.active}
                        disabled={toggle.isPending}
                        onCheckedChange={(active) =>
                          toggle.mutate(
                            { id: a.id, active },
                            {
                              onSuccess: () => toast.success(active ? 'Comunicado ativado' : 'Comunicado desativado', a.title),
                              onError: (error) => toast.error('Não foi possível alterar o comunicado', errorMessage(error)),
                            },
                          )
                        }
                      />
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
