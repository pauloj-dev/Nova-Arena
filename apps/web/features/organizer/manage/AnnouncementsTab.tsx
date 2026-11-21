'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Textarea, useToast } from '@nova/ui';
import { Megaphone, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useBracket } from '@/shared/api/hooks/competition';
import { useCreateAnnouncement, useDeleteAnnouncement } from '@/shared/api/hooks/organizer-ops';
import { useTournamentAnnouncements } from '@/shared/api/hooks/tournaments';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { byOrder, permissionsOf } from '../operation/stageUtils';
import { messages } from './messages';

/** Aba Comunicados (ORG-11): escrever para todos os inscritos, uma fase ou um grupo, e ver o que já foi enviado. */
export function AnnouncementsTab({ tournament }: { tournament: OrganizerTournamentDetail }) {
  const t = useT(messages, 'AnnouncementsTab');
  const perms = permissionsOf(tournament.access);
  const list = useTournamentAnnouncements(tournament.id);
  const create = useCreateAnnouncement(tournament.id);
  const remove = useDeleteAnnouncement(tournament.id);
  const { success, error } = useToast();
  const stages = byOrder(tournament.stages);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [stageId, setStageId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<{ id: string; title: string } | null>(null);
  // Os grupos só existem depois que a chave da fase é gerada.
  const bracket = useBracket(stageId || undefined);
  const groups = bracket.data?.groups ?? [];
  const canSend = perms.canManage && tournament.status !== 'DRAFT';

  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name;
  const titleError = fieldErrors.title ?? (attempted && title.trim() === '' ? t('erroTitulo') : undefined);
  const bodyError = fieldErrors.body ?? (attempted && body.trim() === '' ? t('erroMensagem') : undefined);

  function submit() {
    setAttempted(true);
    setFieldErrors({});
    if (title.trim() === '' || body.trim() === '') return;
    create.mutate(
      { title: title.trim(), body: body.trim(), stageId: stageId || null, groupId: stageId && groupId ? groupId : null },
      {
        onSuccess: () => {
          success(t('enviado'), t('enviadoDescricao'));
          setTitle('');
          setBody('');
          setAttempted(false);
        },
        onError: (e) => {
          if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
          error(t('erroEnviar'), errorMessage(e));
        },
      },
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {perms.canManage && (
        <Card className="h-fit">
          {canSend ? (
            <form
              noValidate
              className="flex flex-col gap-4"
              aria-label={t('novo')}
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <h2 className="text-lg">{t('novo')}</h2>
              <div className="grid gap-4 xs:grid-cols-2">
                <Select
                  label={t('paraQuem')}
                  value={stageId}
                  onChange={(e) => {
                    setStageId(e.target.value);
                    setGroupId('');
                  }}
                  options={[{ value: '', label: t('todosInscritos') }, ...stages.map((s) => ({ value: s.id, label: t('soFase', { fase: s.name }) }))]}
                />
                {stageId && (
                  <Select
                    label={t('grupoOuSala')}
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    options={[{ value: '', label: t('faseInteira') }, ...groups.map((g) => ({ value: g.id, label: t('soGrupo', { grupo: g.name }) }))]}
                    hint={groups.length === 0 ? t('semGrupos') : undefined}
                    error={fieldErrors.groupId}
                  />
                )}
              </div>
              <Input label={t('titulo')} required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} />
              <Textarea label={t('mensagem')} required rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} error={bodyError} hint={t('mensagemDica')} />
              <div>
                <Button type="submit" loading={create.isPending} iconLeft={<Send className="size-4" aria-hidden />}>
                  {t('enviar')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted">{t('indisponivel')}</p>
          )}
        </Card>
      )}

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="comunicados-enviados">
        <h2 id="comunicados-enviados" className="text-lg">
          {t('enviados')}
        </h2>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.error ? (
          <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-7" />} title={t('vazioTitulo')} description={t('vazioDescricao')} />
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('listaEnviados')}>
            {list.data.map((a) => (
              <li key={a.id}>
                <Card padding="sm" className="flex flex-col gap-2" data-testid="announcement">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 text-base break-words">{a.title}</h3>
                    <Badge tone={a.stageId ? 'info' : 'neutral'}>{a.stageId ? t('publicoFase', { fase: stageName(a.stageId) ?? t('umaFase'), grupo: a.groupId ? 'sim' : 'nao' }) : t('publicoTodos')}</Badge>
                  </div>
                  <p className="text-sm break-words whitespace-pre-line text-text">{a.body}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">
                      {a.authorNickname} · {formatDateTime(a.createdAt)}
                    </p>
                    {perms.canManage && (
                      <Button size="sm" variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={t('apagarRotulo', { titulo: a.title })} onClick={() => setRemoving({ id: a.id, title: a.title })}>
                        {t('apagar')}
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title={t('apagarTitulo')}
        description={removing ? t('apagarDescricao', { titulo: removing.title }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('voltar')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    success(t('apagado'));
                    setRemoving(null);
                  },
                  onError: (e) => error(t('erroApagar'), errorMessage(e)),
                });
              }}
            >
              {t('apagarConfirmar')}
            </Button>
          </>
        }
      />
    </div>
  );
}
