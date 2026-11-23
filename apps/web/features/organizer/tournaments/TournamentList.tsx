'use client';

import type { OrganizerTournament } from '@nova/schemas';
import { Badge, Button, Card, EmptyState, ErrorState, Progress, Skeleton, StatusPill, Tabs, useToast } from '@nova/ui';
import { CalendarClock, Copy, FileStack, Hourglass, PencilLine, PlusCircle, Settings2, Trash2, Trophy, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useDuplicateTournament, useOrganizerTournaments } from '@/shared/api/hooks/organizer';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { PageContainer, PageHeader } from '@/shared/layout/AreaShell';
import { formatDateTime } from '@/shared/lib/datetime';
import { CancelTournamentDialog, DeleteDraftDialog, SaveTemplateDialog } from '../components/TournamentDialogs';
import { inGroup, lifecycleActions, STATUS_GROUPS, type StatusGroup } from '../lib/status';
import { messages } from '../messages';

type Dialog = { kind: 'cancel' | 'delete' | 'template'; tournament: OrganizerTournament } | null;

function nextDate(tournament: OrganizerTournament): string {
  const t = getT(messages, 'TournamentList');
  if (tournament.status === 'DRAFT') return t('editadoEm', { data: formatDateTime(tournament.updatedAt, { withZone: false }) });
  if (tournament.status === 'PUBLISHED' && tournament.registrationOpensAt) return t('inscricoesAbrem', { data: formatDateTime(tournament.registrationOpensAt) });
  if (tournament.status === 'REGISTRATION_OPEN' && tournament.registrationClosesAt) return t('inscricoesAte', { data: formatDateTime(tournament.registrationClosesAt) });
  return tournament.startsAt ? t('inicio', { data: formatDateTime(tournament.startsAt) }) : t('semInicio');
}

function TournamentRow({ tournament, onDialog }: { tournament: OrganizerTournament; onDialog: (dialog: Dialog) => void }) {
  const t = useT(messages, 'TournamentList');
  const router = useRouter();
  const duplicate = useDuplicateTournament();
  const { success, error } = useToast();
  const isDraft = tournament.status === 'DRAFT';
  const isOwner = tournament.access !== 'CO_ORGANIZER';
  const canCancel = isOwner && lifecycleActions(tournament.status).includes('cancel');

  return (
    <Card className="flex flex-col gap-3" data-testid={`tournament-${tournament.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">{tournament.name}</h3>
          <p className="text-sm text-muted">
            <span aria-hidden>{tournament.gameIcon} </span>
            {tournament.gameName} · {tournament.modeName}
            {tournament.access === 'CO_ORGANIZER' ? t('coOrganizador') : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tournament.pendingApprovals > 0 && (
            <Badge tone="warning" icon={<Hourglass className="size-3.5" aria-hidden />}>
              {t('aguardandoAprovacao', { count: String(tournament.pendingApprovals) })}
            </Badge>
          )}
          <StatusPill status={tournament.status} />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted md:flex-row md:items-center md:gap-6">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {nextDate(tournament)}
        </span>
        {!isDraft && <Progress className="md:w-56" value={tournament.takenSlots} max={tournament.maxParticipants} label={t('vagasOcupadas', { nome: tournament.name })} />}
        {isDraft && <span>{t('parouNoPasso', { passo: String(tournament.draftStep + 1) })}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {isDraft ? (
          <Button asChild size="sm">
            <Link href={`/organizador/campeonatos/${tournament.id}/editar`} aria-label={t('continuarDe', { nome: tournament.name })}>
              <PencilLine className="size-4" aria-hidden />
              {t('continuarRascunho')}
            </Link>
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href={`/organizador/campeonatos/${tournament.id}`} aria-label={t('gerenciarDe', { nome: tournament.name })}>
              <Settings2 className="size-4" aria-hidden />
              {t('gerenciar')}
            </Link>
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={duplicate.isPending}
          iconLeft={<Copy className="size-4" aria-hidden />}
          aria-label={t('duplicarDe', { nome: tournament.name })}
          onClick={() =>
            duplicate.mutate(
              { id: tournament.id },
              {
                onSuccess: (copy) => {
                  success(t('duplicado'), t('duplicadoDetalhe'));
                  router.push(`/organizador/campeonatos/${copy.id}/editar`);
                },
                onError: (e) => error(t('erroDuplicar'), errorMessage(e)),
              },
            )
          }
        >
          {t('duplicar')}
        </Button>
        {tournament.stageCount > 0 && (
          <Button variant="secondary" size="sm" iconLeft={<FileStack className="size-4" aria-hidden />} aria-label={t('salvarModeloDe', { nome: tournament.name })} onClick={() => onDialog({ kind: 'template', tournament })}>
            {t('salvarModelo')}
          </Button>
        )}
        {isDraft && isOwner && (
          <Button variant="ghost" size="sm" iconLeft={<Trash2 className="size-4" aria-hidden />} aria-label={t('excluirRascunhoDe', { nome: tournament.name })} onClick={() => onDialog({ kind: 'delete', tournament })}>
            {t('excluirRascunho')}
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="sm" iconLeft={<XCircle className="size-4" aria-hidden />} aria-label={t('cancelarDe', { nome: tournament.name })} onClick={() => onDialog({ kind: 'cancel', tournament })}>
            {t('cancelar')}
          </Button>
        )}
      </div>
    </Card>
  );
}


/** `/organizador/campeonatos` — Meus campeonatos, por status, com ações rápidas (issue #24). */
export function TournamentList() {
  const t = useT(messages, 'TournamentList');
  const query = useOrganizerTournaments();
  const [group, setGroup] = useState<StatusGroup>('all');
  const [dialog, setDialog] = useState<Dialog>(null);
  const list = query.data ?? [];

  const createButton = (
    <Button asChild>
      <Link href="/organizador/novo">
        <PlusCircle className="size-4" aria-hidden />
        {t('criarCampeonato')}
      </Link>
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title={t('titulo')} description={t('descricao')} actions={createButton} />

      {!query.data && query.error ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
          <Skeleton className="h-11 w-full max-w-lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<Trophy className="size-7" />} title={t('vazio.all.titulo')} description={t('vazio.all.descricao')} action={createButton} />
      ) : (
        <Tabs
          label={t('filtrar')}
          value={group}
          onValueChange={(value) => setGroup(value as StatusGroup)}
          items={STATUS_GROUPS.map((g) => {
            const rows = list.filter((tournament) => inGroup(tournament.status, g.id));
            return {
              value: g.id,
              label: t('aba', { grupo: g.label, count: String(rows.length) }),
              content:
                rows.length === 0 ? (
                  <EmptyState title={t(`vazio.${g.id}.titulo`)} description={t(`vazio.${g.id}.descricao`)} />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {rows.map((tournament) => (
                      <li key={tournament.id}>
                        <TournamentRow tournament={tournament} onDialog={setDialog} />
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
