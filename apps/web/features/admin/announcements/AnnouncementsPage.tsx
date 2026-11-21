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
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime, formatRelative, localInputToIso } from '@/shared/lib/datetime';
import { adminAnnouncementsMessages } from './messages';

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

const KIND_ICON: Record<Kind, typeof Megaphone> = { BANNER: Megaphone, NOTIFICATION: BellRing, MAINTENANCE: Wrench };
const KINDS = Object.keys(KIND_ICON) as Kind[];
const AUDIENCES: Audience[] = ['ALL', 'ORGANIZERS', 'GAME'];

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
  const t = useT(adminAnnouncementsMessages, 'AnnouncementForm');
  const labels = useT(adminAnnouncementsMessages);
  const toast = useToast();
  const games = useGames();
  const create = useCreateGlobalAnnouncement();
  const { register, handleSubmit, control, reset, setError, formState } = useForm<FormValues>({
    defaultValues: { kind: 'BANNER', audience: 'ALL', gameId: '', title: '', body: '', startsAt: '', endsAt: '' },
    // Valida com o contrato da API, depois de converter as datas locais para ISO.
    resolver: async (values, context, options) => {
      const result = await baseResolver(toInput(values) as never, context, options as never);
      const errors: Record<string, { type: string; message: string }> = { ...(result.errors as Record<string, { type: string; message: string }>) };
      if (values.audience === 'GAME' && !values.gameId) errors.gameId = { type: 'required', message: t('escolhaJogo') };
      if (values.kind === 'MAINTENANCE') {
        if (!values.startsAt) errors.startsAt = { type: 'required', message: t('informeInicio') };
        if (!values.endsAt) errors.endsAt = { type: 'required', message: t('informeFim') };
      }
      if (values.kind !== 'NOTIFICATION' && values.startsAt && values.endsAt && values.endsAt <= values.startsAt) errors.endsAt = { type: 'validate', message: t('fimDepoisInicio') };
      return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
    },
  });
  const kind = useWatch({ control, name: 'kind' });
  const audience = useWatch({ control, name: 'audience' });
  const body = useWatch({ control, name: 'body' });
  const errors = formState.errors;
  const kindOptions = KINDS.map((k) => ({ value: k, label: labels(`tipos.${k}.rotulo`) }));
  const audienceOptions = AUDIENCES.map((a) => ({ value: a, label: labels(`publicos.${a}`) }));
  // Registro dos campos fora do JSX (o nome do campo não é texto de interface).
  const fields = {
    kind: register('kind'),
    audience: register('audience'),
    gameId: register('gameId'),
    title: register('title'),
    body: register('body'),
    startsAt: register('startsAt'),
    endsAt: register('endsAt'),
  };

  function submit(values: FormValues) {
    create.mutate(GlobalAnnouncementInput.parse(toInput(values)), {
      onSuccess: (created) => {
        toast.success(created.kind === 'NOTIFICATION' ? t('toastNotificacao') : created.kind === 'MAINTENANCE' ? t('toastManutencao') : t('toastBanner'), created.title);
        reset();
      },
      onError: (error) => {
        if (error instanceof ApiError) {
          for (const [field, message] of Object.entries(error.fieldErrors)) setError(field as keyof FormValues, { message });
        }
        toast.error(t('toastErro'), errorMessage(error));
      },
    });
  }

  return (
    <Card>
      <form onSubmit={(event) => void handleSubmit(submit)(event)} className="flex flex-col gap-4" noValidate aria-label={t('titulo')}>
        <h2 className="text-lg">{t('titulo')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Select label={t('tipo')} options={kindOptions} hint={labels(`tipos.${kind}.dica`)} {...fields.kind} />
          <Select label={t('publico')} options={audienceOptions} {...fields.audience} />
        </div>
        {audience === 'GAME' && (
          <Select
            label={t('jogo')}
            required
            placeholder={games.isPending ? t('carregandoJogos') : t('escolhaJogo')}
            options={(games.data ?? []).map((g) => ({ value: g.id, label: g.name }))}
            hint={t('jogoDica')}
            error={errors.gameId?.message}
            {...fields.gameId}
          />
        )}
        <Input label={t('tituloCampo')} required maxLength={80} error={errors.title?.message} {...fields.title} />
        <Textarea label={t('mensagem')} required rows={3} maxLength={500} hint={t('mensagemDica', { n: String(body.length) })} error={errors.body?.message} {...fields.body} />
        {kind !== 'NOTIFICATION' && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label={kind === 'MAINTENANCE' ? t('inicioManutencao') : t('comecaEm')}
              type="datetime-local"
              required={kind === 'MAINTENANCE'}
              hint={t('fuso')}
              error={errors.startsAt?.message}
              {...fields.startsAt}
            />
            <Input
              label={kind === 'MAINTENANCE' ? t('fimManutencao') : t('someEm')}
              type="datetime-local"
              required={kind === 'MAINTENANCE'}
              hint={t('fuso')}
              error={errors.endsAt?.message}
              {...fields.endsAt}
            />
          </div>
        )}
        <Button type="submit" loading={create.isPending} className="self-start" iconLeft={<Send className="size-4" aria-hidden />}>
          {labels(`tipos.${kind}.enviar`)}
        </Button>
      </form>
    </Card>
  );
}

function situation(a: GlobalAnnouncement, now: number): { text: string; tone: 'primary' | 'neutral' | 'warning' | 'info' } {
  const t = getT(adminAnnouncementsMessages, 'situacao');
  if (a.kind === 'NOTIFICATION') return { text: t('enviada'), tone: 'neutral' };
  if (!a.active) return { text: t('desativado'), tone: 'neutral' };
  const start = a.startsAt ? new Date(a.startsAt).getTime() : null;
  const end = a.endsAt ? new Date(a.endsAt).getTime() : null;
  if (end !== null && now >= end) return { text: t('encerrado'), tone: 'neutral' };
  if (a.kind === 'MAINTENANCE' && start !== null) {
    if (now >= start) return { text: t('emCurso'), tone: 'warning' };
    return now >= start - 48 * 3600_000 ? { text: t('avisoPrevio'), tone: 'primary' } : { text: t('agendado'), tone: 'info' };
  }
  if (start !== null && now < start) return { text: t('agendado'), tone: 'info' };
  return { text: t('noAr'), tone: 'primary' };
}

/** Comunicados globais (ADM-11): banner no topo, notificação para um segmento e aviso de manutenção. */
export function AnnouncementsPage() {
  const t = useT(adminAnnouncementsMessages, 'AnnouncementsPage');
  const labels = useT(adminAnnouncementsMessages);
  const toast = useToast();
  const announcements = useGlobalAnnouncements();
  const games = useGames({ includeInactive: true });
  const toggle = useToggleGlobalAnnouncement();
  // A situação ("no ar", "agendado") depende da hora; ela é lida uma vez, quando a tela abre.
  const [now] = useState(() => Date.now());

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} />
      <AnnouncementForm />

      <section aria-labelledby="comunicados-lista" className="flex flex-col gap-3">
        <h2 id="comunicados-lista" className="text-lg">
          {t('criados')}
        </h2>
        {announcements.isPending ? (
          <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : announcements.isError ? (
          <ErrorState description={errorMessage(announcements.error)} onRetry={() => void announcements.refetch()} />
        ) : announcements.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-7" />} title={t('nenhum')} description={t('nenhumDescricao')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {announcements.data.map((a) => {
              const Icon = KIND_ICON[a.kind];
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
                      {t('detalhes', {
                        tipo: labels(`tipos.${a.kind}.rotulo`),
                        publico: labels(`publicos.${a.audience}`),
                        temJogo: gameName ? 'sim' : 'nao',
                        jogo: gameName ?? '',
                        autor: a.authorNickname,
                        quando: formatRelative(a.createdAt),
                      })}
                    </p>
                    {(a.startsAt || a.endsAt) && (
                      <p className="text-xs text-muted">
                        {a.startsAt && t('de', { data: formatDateTime(a.startsAt, { withZone: false }) })}
                        {a.endsAt && t('ate', { data: formatDateTime(a.endsAt) })}
                      </p>
                    )}
                    {a.kind !== 'NOTIFICATION' && (
                      <Switch
                        className="self-start gap-3"
                        label={
                          <>
                            {t('ativo')}
                            <span className="sr-only">{t('ativoSr', { titulo: a.title })}</span>
                          </>
                        }
                        checked={a.active}
                        disabled={toggle.isPending}
                        onCheckedChange={(active) =>
                          toggle.mutate(
                            { id: a.id, active },
                            {
                              onSuccess: () => toast.success(active ? t('toastAtivado') : t('toastDesativado'), a.title),
                              onError: (error) => toast.error(t('toastErro'), errorMessage(error)),
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
