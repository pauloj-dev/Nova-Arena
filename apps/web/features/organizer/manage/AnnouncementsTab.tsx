'use client';

import type { OrganizerTournamentDetail } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Select, Skeleton, Textarea, useToast } from '@nova/ui';
import { Megaphone, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useBracket } from '@/shared/api/hooks/competition';
import { useCreateAnnouncement, useDeleteAnnouncement } from '@/shared/api/hooks/organizer-ops';
import { useTournamentAnnouncements } from '@/shared/api/hooks/tournaments';
import { formatDateTime } from '@/shared/lib/datetime';
import { byOrder, permissionsOf } from '../operation/stageUtils';

/** Aba Comunicados (ORG-11): escrever para todos os inscritos, uma fase ou um grupo, e ver o que já foi enviado. */
export function AnnouncementsTab({ tournament: t }: { tournament: OrganizerTournamentDetail }) {
  const perms = permissionsOf(t.access);
  const list = useTournamentAnnouncements(t.id);
  const create = useCreateAnnouncement(t.id);
  const remove = useDeleteAnnouncement(t.id);
  const { success, error } = useToast();
  const stages = byOrder(t.stages);
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
  const canSend = perms.canManage && t.status !== 'DRAFT';

  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name;
  const titleError = fieldErrors.title ?? (attempted && title.trim() === '' ? 'Dê um título' : undefined);
  const bodyError = fieldErrors.body ?? (attempted && body.trim() === '' ? 'Escreva a mensagem' : undefined);

  function submit() {
    setAttempted(true);
    setFieldErrors({});
    if (title.trim() === '' || body.trim() === '') return;
    create.mutate(
      { title: title.trim(), body: body.trim(), stageId: stageId || null, groupId: stageId && groupId ? groupId : null },
      {
        onSuccess: () => {
          success('Comunicado enviado', 'Os inscritos do público escolhido foram notificados e ele já aparece na página pública.');
          setTitle('');
          setBody('');
          setAttempted(false);
        },
        onError: (e) => {
          if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
          error('Não foi possível enviar', errorMessage(e));
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
              aria-label="Novo comunicado"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <h2 className="text-lg">Novo comunicado</h2>
              <div className="grid gap-4 xs:grid-cols-2">
                <Select
                  label="Para quem"
                  value={stageId}
                  onChange={(e) => {
                    setStageId(e.target.value);
                    setGroupId('');
                  }}
                  options={[{ value: '', label: 'Todos os inscritos' }, ...stages.map((s) => ({ value: s.id, label: `Só a fase: ${s.name}` }))]}
                />
                {stageId && (
                  <Select
                    label="Grupo ou sala"
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    options={[{ value: '', label: 'A fase inteira' }, ...groups.map((g) => ({ value: g.id, label: `Só ${g.name}` }))]}
                    hint={groups.length === 0 ? 'Esta fase ainda não tem grupos (a chave não foi gerada ou o formato não usa grupos).' : undefined}
                    error={fieldErrors.groupId}
                  />
                )}
              </div>
              <Input label="Título" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} error={titleError} />
              <Textarea label="Mensagem" required rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} error={bodyError} hint="Vai como notificação para o público escolhido e fica na página pública do campeonato." />
              <div>
                <Button type="submit" loading={create.isPending} iconLeft={<Send className="size-4" aria-hidden />}>
                  Enviar comunicado
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted">Os comunicados ficam disponíveis depois que o campeonato é publicado.</p>
          )}
        </Card>
      )}

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="comunicados-enviados">
        <h2 id="comunicados-enviados" className="text-lg">
          Enviados
        </h2>
        {list.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : list.error ? (
          <ErrorState description={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <EmptyState icon={<Megaphone className="size-7" />} title="Nenhum comunicado ainda" description="Avise os inscritos sobre horários, mudanças de sala e regras." />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Comunicados enviados">
            {list.data.map((a) => (
              <li key={a.id}>
                <Card padding="sm" className="flex flex-col gap-2" data-testid="announcement">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="min-w-0 text-base break-words">{a.title}</h3>
                    <Badge tone={a.stageId ? 'info' : 'neutral'}>{a.stageId ? `${stageName(a.stageId) ?? 'Uma fase'}${a.groupId ? ' · um grupo' : ''}` : 'Todos'}</Badge>
                  </div>
                  <p className="text-sm break-words whitespace-pre-line text-text">{a.body}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">
                      {a.authorNickname} · {formatDateTime(a.createdAt)}
                    </p>
                    {perms.canManage && (
                      <Button size="sm" variant="ghost" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={`Apagar o comunicado: ${a.title}`} onClick={() => setRemoving({ id: a.id, title: a.title })}>
                        Apagar
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
        title="Apagar este comunicado?"
        description={removing ? `"${removing.title}" sai da página pública. As notificações que já foram enviadas não são desfeitas.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Voltar
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (!removing) return;
                remove.mutate(removing.id, {
                  onSuccess: () => {
                    success('Comunicado apagado');
                    setRemoving(null);
                  },
                  onError: (e) => error('Não foi possível apagar', errorMessage(e)),
                });
              }}
            >
              Apagar comunicado
            </Button>
          </>
        }
      />
    </div>
  );
}
