'use client';

import type { Team, TeamInvite, TeamMember } from '@nova/schemas';
import { Button, Card, ConfirmDestructive, EmptyState, ErrorState, Modal, Skeleton, useToast } from '@nova/ui';
import { ArrowLeft, Pencil, SearchX, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ReportButton } from '@/features/reports/ReportButton';
import { ApiError, errorMessage } from '@/shared/api/client';
import { useDeleteTeam, useRemoveTeamMember, useRevokeTeamInvite, useTeam, useTransferCaptain, useUpdateTeamMember } from '@/shared/api/hooks/teams';
import { PageContainer } from '@/shared/layout/AreaShell';
import { useSession } from '@/shared/session/useSession';
import { InvitePanel } from './InvitePanel';
import { SquadRoster } from './SquadRoster';
import { TeamFormModal } from './TeamFormModal';
import { TeamLogo } from './TeamLogo';

const backLink = (
  <Link href="/minha-conta/squads" className="flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-muted hover:text-text">
    <ArrowLeft className="size-4" aria-hidden /> Meus squads
  </Link>
);

/** `/minha-conta/squads/[id]`: elenco, convites e ações do squad. */
export function TeamDetailPage({ teamId }: { teamId: string }) {
  const { user } = useSession();
  const team = useTeam(teamId);

  if (team.isPending) {
    return (
      <PageContainer>
        {backLink}
        <div className="flex flex-col gap-6" role="status" aria-label="Carregando o squad">
          <Skeleton className="h-20 w-full max-w-md" />
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </PageContainer>
    );
  }
  if (team.isError) {
    const missing = team.error instanceof ApiError && team.error.status === 404;
    return (
      <PageContainer>
        {backLink}
        <h1 className="sr-only">Squad</h1>
        {missing ? (
          <EmptyState
            icon={<SearchX className="size-7" />}
            title="Squad não encontrado"
            description="Ele pode ter sido excluído pelo capitão."
            action={
              <Button asChild>
                <Link href="/minha-conta/squads">Ver meus squads</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="Não foi possível carregar o squad" description={errorMessage(team.error)} onRetry={() => void team.refetch()} />
        )}
      </PageContainer>
    );
  }
  return <TeamDetail team={team.data} viewerId={user?.id ?? null} />;
}

type Dialog = { kind: 'transfer'; member: TeamMember } | { kind: 'remove'; member: TeamMember } | { kind: 'leave' } | { kind: 'delete' } | { kind: 'edit' } | null;

function TeamDetail({ team, viewerId }: { team: Team; viewerId: string | null }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const close = () => setDialog(null);

  const updateMember = useUpdateTeamMember(team.id);
  const removeMember = useRemoveTeamMember(team.id);
  const transfer = useTransferCaptain(team.id);
  const revoke = useRevokeTeamInvite();
  const remove = useDeleteTeam();

  const isCaptain = viewerId !== null && viewerId === team.captainId;
  const isMember = viewerId !== null && team.members.some((m) => m.userId === viewerId);
  const count = team.members.length;

  function toggleSub(member: TeamMember) {
    updateMember.mutate(
      { userId: member.userId, isSub: !member.isSub },
      {
        onSuccess: () => success(member.isSub ? `${member.nickname} voltou a ser titular` : `${member.nickname} agora é reserva`),
        onError: (e) => error('Não foi possível mudar a escalação', errorMessage(e)),
      },
    );
  }
  function revokeInvite(invite: TeamInvite) {
    setRevokingId(invite.id);
    revoke.mutate(invite.id, {
      onSuccess: () => success('Convite cancelado'),
      onError: (e) => error('Não foi possível cancelar o convite', errorMessage(e)),
      onSettled: () => setRevokingId(null),
    });
  }
  function confirmTransfer(member: TeamMember) {
    transfer.mutate(member.userId, {
      onSuccess: () => {
        success(`${member.nickname} agora é o capitão`);
        close();
      },
      onError: (e) => error('Não foi possível transferir a capitania', errorMessage(e)),
    });
  }
  function confirmRemove(member: TeamMember) {
    removeMember.mutate(member.userId, {
      onSuccess: () => {
        success(`${member.nickname} saiu do squad`);
        close();
      },
      onError: (e) => error(`Não foi possível remover ${member.nickname}`, errorMessage(e)),
    });
  }
  function confirmLeave() {
    if (!viewerId) return;
    removeMember.mutate(viewerId, {
      onSuccess: () => {
        success(`Você saiu do ${team.name}`);
        router.push('/minha-conta/squads');
      },
      onError: (e) => error('Não foi possível sair do squad', errorMessage(e)),
    });
  }
  function confirmDelete() {
    remove.mutate(team.id, {
      onSuccess: () => {
        success(`${team.name} excluído`);
        router.push('/minha-conta/squads');
      },
      onError: (e) => error('Não foi possível excluir o squad', errorMessage(e)),
    });
  }

  return (
    <PageContainer>
      {backLink}

      <div className="flex flex-wrap items-center gap-4">
        <TeamLogo tag={team.tag} logoUrl={team.logoUrl} size="xl" />
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="break-words text-xl md:text-2xl">{team.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span className="tabular">[{team.tag}]</span>
            <span className="flex items-center gap-1.5">
              <Users className="size-4" aria-hidden />
              {count === 1 ? '1 membro' : `${count} membros`}
            </span>
          </p>
        </div>
        {isCaptain ? (
          <Button variant="secondary" iconLeft={<Pencil className="size-4" aria-hidden />} onClick={() => setDialog({ kind: 'edit' })}>
            Editar
          </Button>
        ) : (
          <ReportButton targetType="TEAM" targetId={team.id} targetLabel={team.name} />
        )}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card className="min-w-0">
          <section aria-labelledby="squad-elenco" className="flex flex-col gap-2">
            <h2 id="squad-elenco" className="text-lg">
              Elenco
            </h2>
            <SquadRoster
              team={team}
              viewerId={viewerId}
              onToggleSub={isCaptain ? toggleSub : undefined}
              onTransfer={isCaptain ? (member) => setDialog({ kind: 'transfer', member }) : undefined}
              onRemove={isCaptain ? (member) => setDialog({ kind: 'remove', member }) : undefined}
              onLeave={isMember && !isCaptain ? () => setDialog({ kind: 'leave' }) : undefined}
              onRevokeInvite={isCaptain ? revokeInvite : undefined}
              revokingInviteId={revokingId}
            />
          </section>
        </Card>

        {isCaptain && (
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <section aria-labelledby="squad-convidar" className="flex flex-col gap-4">
                <h2 id="squad-convidar" className="text-lg">
                  Convidar jogadores
                </h2>
                <InvitePanel team={team} />
              </section>
            </Card>

            <Card>
              <section aria-labelledby="squad-excluir" className="flex flex-col gap-3">
                <h2 id="squad-excluir" className="text-lg">
                  Excluir squad
                </h2>
                <p className="text-sm text-muted">
                  O squad some para todos os membros. Não dá para excluir enquanto ele estiver inscrito em um campeonato que ainda não terminou. Para sair sem excluir, passe a capitania para outro membro.
                </p>
                <Button variant="danger" className="self-start" iconLeft={<Trash2 className="size-4" aria-hidden />} onClick={() => setDialog({ kind: 'delete' })}>
                  Excluir squad
                </Button>
              </section>
            </Card>
          </div>
        )}
      </div>

      <TeamFormModal open={dialog?.kind === 'edit'} onOpenChange={(open) => !open && close()} team={team} />

      <ConfirmModal
        open={dialog?.kind === 'transfer'}
        onClose={close}
        title="Passar a capitania"
        confirmLabel="Passar a capitania"
        loading={transfer.isPending}
        onConfirm={() => dialog?.kind === 'transfer' && confirmTransfer(dialog.member)}
      >
        {dialog?.kind === 'transfer' && (
          <p>
            <strong>{dialog.member.nickname}</strong> vira o capitão do {team.name}: só ele poderá convidar, remover membros e inscrever o squad em campeonatos. Você continua no squad como membro.
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={dialog?.kind === 'remove'}
        onClose={close}
        title="Remover do squad"
        confirmLabel="Remover"
        danger
        loading={removeMember.isPending}
        onConfirm={() => dialog?.kind === 'remove' && confirmRemove(dialog.member)}
      >
        {dialog?.kind === 'remove' && (
          <p>
            <strong>{dialog.member.nickname}</strong> sai do {team.name}. Para voltar, vai precisar de um novo convite.
          </p>
        )}
      </ConfirmModal>

      <ConfirmModal open={dialog?.kind === 'leave'} onClose={close} title="Sair do squad" confirmLabel="Sair do squad" danger loading={removeMember.isPending} onConfirm={confirmLeave}>
        <p>Você deixa de fazer parte do {team.name}. Para voltar, vai precisar de um novo convite do capitão.</p>
      </ConfirmModal>

      <ConfirmDestructive
        open={dialog?.kind === 'delete'}
        onOpenChange={(open) => !open && close()}
        title="Excluir squad"
        description="Esta ação não pode ser desfeita. O squad some para todos os membros e os convites pendentes são cancelados."
        confirmText={team.name}
        confirmLabel="Excluir squad"
        loading={remove.isPending}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: () => void;
  children: ReactNode;
}

/** Confirmação simples (sim/não) para ações que mudam o elenco. */
function ConfirmModal({ open, onClose, title, confirmLabel, danger, loading, onConfirm, children }: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Voltar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-text">{children}</div>
    </Modal>
  );
}
