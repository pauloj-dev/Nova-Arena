'use client';

import type { Registration, Tournament } from '@nova/schemas';
import { Button, Modal, StatusPill, useToast } from '@nova/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCancelRegistration, useConfirmRegistration, useDeclineRegistration } from '@/shared/api/hooks/registrations';
import { formatDateTime } from '@/shared/lib/datetime';
import { GameAccountWarning } from './GameAccountWarning';
import { canCancelRegistration, missingConfirmations } from './lib/rules';
import { RegistrationMembers } from './RegistrationMembers';

interface MyRegistrationCardProps {
  tournament: Tournament;
  registration: Registration;
  viewerId: string;
}

function statusText(r: Registration, isTeam: boolean): string {
  const who = isTeam ? 'O squad' : 'Você';
  switch (r.status) {
    case 'CONFIRMED':
      return isTeam ? 'O squad está confirmado no campeonato.' : 'Você está confirmado no campeonato.';
    case 'PENDING_MEMBERS': {
      const missing = missingConfirmations(r);
      const pending = r.members.filter((m) => m.confirmedAt === null).length;
      if (pending < missing) {
        return `O elenco ficou com menos de ${r.requiredMembers} jogadores. Cancele a inscrição e inscreva o squad de novo quando ele estiver completo.`;
      }
      return `A inscrição vale quando ${r.requiredMembers} jogadores confirmarem. ${missing === 1 ? 'Falta 1 membro confirmar' : `Faltam ${missing} membros confirmarem`}.`;
    }
    case 'PENDING_APPROVAL':
      return 'A inscrição está completa e aguarda a aprovação da organização.';
    case 'WAITLIST':
      return `${who} está na lista de espera${r.waitlistPosition ? `, na ${r.waitlistPosition}ª posição` : ''}. Se abrir uma vaga, a entrada é automática, na ordem da fila.`;
    case 'REJECTED':
      return 'A organização recusou esta inscrição.';
    case 'DISQUALIFIED':
      return isTeam ? 'O squad foi desclassificado do campeonato.' : 'Você foi desclassificado do campeonato.';
    case 'WITHDRAWN':
      return isTeam ? 'O squad desistiu do campeonato.' : 'Você desistiu do campeonato.';
    case 'CANCELLED':
      return 'Esta inscrição foi cancelada.';
  }
}

/** Estado da minha inscrição: status, elenco, confirmação pendente e cancelamento. */
export function MyRegistrationCard({ tournament, registration: r, viewerId }: MyRegistrationCardProps) {
  const { success, error } = useToast();
  const confirm = useConfirmRegistration();
  const decline = useDeclineRegistration();
  const cancel = useCancelRegistration();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // A hora é lida uma vez ao montar: o prazo que vale é o da API.
  const [now] = useState(() => new Date());

  const isTeam = r.teamId !== null;
  const me = r.members.find((m) => m.userId === viewerId);
  const active = r.status === 'CONFIRMED' || r.status === 'PENDING_MEMBERS' || r.status === 'PENDING_APPROVAL' || r.status === 'WAITLIST';
  const isOwner = isTeam ? Boolean(me?.isCaptain) : r.userId === viewerId;
  const needsMyConfirmation = active && isTeam && me !== undefined && me.confirmedAt === null;
  const missingMyAccount = me !== undefined && !me.hasGameAccount;
  const cancellable = canCancelRegistration(tournament, now);

  function onConfirm() {
    confirm.mutate(r.id, {
      onSuccess: (updated) => success('Participação confirmada', updated.status === 'PENDING_MEMBERS' ? 'Agora é esperar o resto do squad.' : undefined),
      onError: (e) => error('Não foi possível confirmar', errorMessage(e)),
    });
  }
  function onDecline() {
    decline.mutate(r.id, {
      onSuccess: () => success('Você recusou a participação', 'Você continua no squad, mas fora deste campeonato.'),
      onError: (e) => error('Não foi possível recusar', errorMessage(e)),
    });
  }
  function onCancel() {
    cancel.mutate(r.id, {
      onSuccess: () => {
        setConfirmingCancel(false);
        success(r.status === 'WAITLIST' ? 'Você saiu da lista de espera' : 'Inscrição cancelada');
      },
      onError: (e) => error('Não foi possível cancelar a inscrição', errorMessage(e)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={r.status} />
          {isTeam && (
            <span className="text-sm font-semibold">
              {r.displayName} {r.tag && <span className="tabular text-xs text-muted">[{r.tag}]</span>}
            </span>
          )}
        </div>
        <p className="text-sm text-text" data-testid="registration-status-text">
          {statusText(r, isTeam)}
        </p>
        {r.statusReason && <p className="text-sm text-muted">Motivo: {r.statusReason}</p>}
        {r.status === 'PENDING_MEMBERS' && r.reservedUntil && (
          <p className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-text">A vaga está reservada para o squad até {formatDateTime(r.reservedUntil)}. Depois disso ela passa para o próximo da lista de espera.</p>
        )}
      </div>

      {isTeam && r.members.length > 0 && <RegistrationMembers registration={r} viewerId={viewerId} />}

      {active && missingMyAccount && <GameAccountWarning gameName={tournament.gameName} context="confirm" />}

      {needsMyConfirmation && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
          <p className="text-sm font-semibold">O capitão inscreveu o squad. Você vai jogar?</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={confirm.isPending} disabled={missingMyAccount || decline.isPending} onClick={onConfirm}>
              Confirmar participação
            </Button>
            {!me?.isCaptain && (
              <Button variant="secondary" loading={decline.isPending} disabled={confirm.isPending} onClick={onDecline}>
                Recusar
              </Button>
            )}
          </div>
        </div>
      )}

      {active && isOwner && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {cancellable ? (
            <Button variant="secondary" className="self-start" onClick={() => setConfirmingCancel(true)}>
              {r.status === 'WAITLIST' ? 'Sair da lista de espera' : 'Cancelar inscrição'}
            </Button>
          ) : (
            <p className="text-sm text-muted">O prazo para cancelar a inscrição já passou. Para desistir agora, fale com a organização do campeonato.</p>
          )}
        </div>
      )}
      {active && isTeam && !isOwner && <p className="text-sm text-muted">Só o capitão pode cancelar a inscrição do squad.</p>}

      {(r.status === 'CANCELLED' || r.status === 'REJECTED') && (
        <Button asChild variant="secondary" className="self-start">
          <Link href="/campeonatos">Ver outros campeonatos</Link>
        </Button>
      )}

      <Modal
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={r.status === 'WAITLIST' ? 'Sair da lista de espera' : 'Cancelar inscrição'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingCancel(false)} disabled={cancel.isPending}>
              Voltar
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={onCancel}>
              {r.status === 'WAITLIST' ? 'Sair da lista' : 'Cancelar inscrição'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {r.status === 'WAITLIST'
            ? `Você perde o seu lugar na fila de ${tournament.name}. Se entrar de novo, vai para o fim da lista.`
            : `${isTeam ? `O ${r.displayName} sai` : 'Você sai'} de ${tournament.name} e a vaga passa para o primeiro da lista de espera. Se quiser voltar, vai precisar se inscrever de novo.`}
        </p>
      </Modal>
    </div>
  );
}
