'use client';

import type { OrganizerTournament } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Progress, Skeleton, StatusPill, Tabs, useToast } from '@nova/ui';
import { CalendarClock, Copy, FileStack, Hourglass, PencilLine, PlusCircle, Settings2, Trash2, Trophy, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useDuplicateTournament, useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { CancelTournamentDialog, DeleteDraftDialog, SaveTemplateDialog } from '../components/TournamentDialogs';
import { inGroup, lifecycleActions, STATUS_GROUPS, type StatusGroup } from '../lib/status';

type Dialog = { kind: 'cancel' | 'delete' | 'template'; tournament: OrganizerTournament } | null;

function nextDate(t: OrganizerTournament): string {
  if (t.status === 'DRAFT') return `Editado em ${formatDateTime(t.updatedAt, { withZone: false })}`;
  if (t.status === 'PUBLISHED' && t.registrationOpensAt) return `Inscrições abrem ${formatDateTime(t.registrationOpensAt)}`;
  if (t.status === 'REGISTRATION_OPEN' && t.registrationClosesAt) return `Inscrições até ${formatDateTime(t.registrationClosesAt)}`;
  return t.startsAt ? `Início: ${formatDateTime(t.startsAt)}` : 'Sem data de início';
}

function TournamentRow({ t, onDialog }: { t: OrganizerTournament; onDialog: (dialog: Dialog) => void }) {
  const router = useRouter();
  const duplicate = useDuplicateTournament();
  const { success, error } = useToast();
  const isDraft = t.status === 'DRAFT';
  const isOwner = t.access !== 'CO_ORGANIZER';
  const canCancel = isOwner && lifecycleActions(t.status).includes('cancel');

  return (
    <Card className="flex flex-col gap-3" data-testid={`tournament-${t.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">{t.name}</h3>
          <p className="text-sm text-muted">
            <span aria-hidden>{t.gameIcon} </span>
            {t.gameName} · {t.modeName}
            {t.access === 'CO_ORGANIZER' ? ' · você é co-organizador' : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {t.pendingApprovals > 0 && (
            <Badge tone="warning" icon={<Hourglass className="size-3.5" aria-hidden />}>
              {t.pendingApprovals} aguardando aprovação
            </Badge>
          )}
          <StatusPill status={t.status} />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted md:flex-row md:items-center md:gap-6">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {nextDate(t)}
        </span>
        {!isDraft && <Progress className="md:w-56" value={t.takenSlots} max={t.maxParticipants} label={`Vagas ocupadas em ${t.name}`} />}
        {isDraft && <span>Parou no passo {t.draftStep + 1} de 7</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {isDraft ? (
          <Button asChild size="sm">
            <Link href={`/organizador/campeonatos/${t.id}/editar`} aria-label={`Continuar rascunho de ${t.name}`}>
              <PencilLine className="size-4" aria-hidden />
              Continuar rascunho
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href={`/organizador/campeonatos/${t.id}`} aria-label={`Gerenciar ${t.name}`}>
              <Settings2 className="size-4" aria-hidden />
              Gerenciar
            </Link>
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={duplicate.isPending}
          iconLeft={<Copy className="size-4" aria-hidden />}
          aria-label={`Duplicar ${t.name}`}
          onClick={() =>
            duplicate.mutate(
              { id: t.id },
              {
                onSuccess: (copy) => {
                  success('Campeonato duplicado', 'A cópia é um rascunho: ajuste o nome e as datas.');
                  router.push(`/organizador/campeonatos/${copy.id}/editar`);
                },
                onError: (e) => error('Não foi possível duplicar', errorMessage(e)),
              },
            )
          }
        >
          Duplicar
        </Button>
        {t.stageCount > 0 && (
          <Button variant="secondary" size="sm" iconLeft={<FileStack className="size-4" aria-hidden />} aria-label={`Salvar ${t.name} como modelo`} onClick={() => onDialog({ kind: 'template', tournament: t })}>
            Salvar como modelo
          </Button>
        )}
        {isDraft && isOwner && (
          <Button variant="ghost" size="sm" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={`Excluir rascunho ${t.name}`} onClick={() => onDialog({ kind: 'delete', tournament: t })}>
            Excluir rascunho
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="sm" iconLeft={<XCircle className="size-4" aria-hidden />} aria-label={`Cancelar ${t.name}`} onClick={() => onDialog({ kind: 'cancel', tournament: t })}>
            Cancelar
          </Button>
        )}
      </div>
    </Card>
  );
}

const EMPTY_BY_GROUP: Record<StatusGroup, { title: string; description: string }> = {
  all: { title: 'Você ainda não tem campeonatos', description: 'Crie o primeiro em poucos minutos: o assistente sugere tudo, das vagas ao regulamento.' },
  draft: { title: 'Nenhum rascunho', description: 'Tudo o que você começou já foi publicado ou excluído.' },
  active: { title: 'Nenhum campeonato ativo', description: 'Publique um rascunho para ele aparecer na vitrine e receber inscrições.' },
  finished: { title: 'Nenhum campeonato encerrado', description: 'Os campeonatos finalizados e arquivados aparecem aqui.' },
  cancelled: { title: 'Nenhum campeonato cancelado', description: 'Que continue assim.' },
};

/** `/organizador/campeonatos` — Meus campeonatos, por status, com ações rápidas (issue #24). */
export function TournamentList() {
  const query = useOrganizerTournaments();
  const [group, setGroup] = useState<StatusGroup>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const list = query.data ?? [];

  const createButton = (
    <Button asChild>
      <Link href="/organizador/novo">
        <PlusCircle className="size-4" aria-hidden />
        Criar campeonato
      </Link>
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title="Meus campeonatos" description="Os campeonatos em que você é responsável ou co-organizador." actions={createButton} />

      {!query.data && query.error ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-3" role="status" aria-label="Carregando campeonatos">
          <Skeleton className="h-11 w-full max-w-lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title={EMPTY_BY_GROUP.all.title} description={EMPTY_BY_GROUP.all.description} action={createButton} />
      ) : (
        <Tabs
          label="Filtrar por status"
          value={group}
          onValueChange={(value) => setGroup(value as StatusGroup)}
          items={STATUS_GROUPS.map((g) => {
            const rows = list.filter((t) => inGroup(t.status, g.id));
            return {
              value: g.id,
              label: `${g.label} (${rows.length})`,
              content:
                rows.length === 0 ? (
                  <EmptyState title={EMPTY_BY_GROUP[g.id].title} description={EMPTY_BY_GROUP[g.id].description} />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {rows.map((t) => (
                      <li key={t.id}>
                        <TournamentRow t={t} onDialog={setDialog} />
                      </li>
                    ))}
                  </ul>
                ),
            };
          })}
        />
      )}

      {dialog?.kind === 'cancel' && <CancelTournamentDialog tournament={dialog.tournament} open onOpenChange={(open) => !open && setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteDraftDialog tournament={dialog.tournament} open onOpenChange={(open) => !open && setDialog(null)} />}
      {dialog?.kind === 'template' && <SaveTemplateDialog tournament={dialog.tournament} open onOpenChange={(open) => !open && setDialog(null)} />}
    </PageContainer>
  );
}
