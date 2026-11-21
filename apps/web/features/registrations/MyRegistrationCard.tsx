'use client';

import type { Registration, Tournament } from '@nova/schemas';
import { Button, Modal, StatusPill, useToast } from '@nova/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCancelRegistration, useConfirmRegistration, useDeclineRegistration } from '@/shared/api/hooks/registrations';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { GameAccountWarning } from './GameAccountWarning';
import { canCancelRegistration, missingConfirmations } from './lib/rules';
import { messages } from './messages';
import { RegistrationMembers } from './RegistrationMembers';

interface MyRegistrationCardProps {
  tournament: Tournament;
  registration: Registration;
  viewerId: string;
}

function statusText(r: Registration, isTeam: boolean): string {
  const t = getT(messages, 'MyRegistrationCard.status');
  const quem = isTeam ? 'squad' : 'voce';
  switch (r.status) {
    case 'CONFIRMED':
      return t('confirmada', { quem });
    case 'PENDING_MEMBERS': {
      const missing = missingConfirmations(r);
      const pending = r.members.filter((m) => m.confirmedAt === null).length;
      if (pending < missing) {
        return t('elencoIncompleto', { minimo: r.requiredMembers });
      }
      return t('aguardaConfirmacoes', { minimo: r.requiredMembers, count: missing });
    }
    case 'PENDING_APPROVAL':
      return t('aguardaAprovacao');
    case 'WAITLIST':
      return r.waitlistPosition ? t('listaEsperaPosicao', { quem, posicao: r.waitlistPosition }) : t('listaEspera', { quem });
    case 'REJECTED':
      return t('recusada');
    case 'DISQUALIFIED':
      return t('desclassificada', { quem });
    case 'WITHDRAWN':
      return t('desistiu', { quem });
    case 'CANCELLED':
      return t('cancelada');
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
  const t = useT(messages, 'MyRegistrationCard');

  const isTeam = r.teamId !== null;
  const me = r.members.find((m) => m.userId === viewerId);
  const active = r.status === 'CONFIRMED' || r.status === 'PENDING_MEMBERS' || r.status === 'PENDING_APPROVAL' || r.status === 'WAITLIST';
  const isOwner = isTeam ? Boolean(me?.isCaptain) : r.userId === viewerId;
  const needsMyConfirmation = active && isTeam && me !== undefined && me.confirmedAt === null;
  const missingMyAccount = me !== undefined && !me.hasGameAccount;
  const cancellable = canCancelRegistration(tournament, now);

  function onConfirm() {
    confirm.mutate(r.id, {
      onSuccess: (updated) => success(t('confirmado'), updated.status === 'PENDING_MEMBERS' ? t('esperarSquad') : undefined),
      onError: (e) => error(t('erroConfirmar'), errorMessage(e)),
    });
  }
  function onDecline() {
    decline.mutate(r.id, {
      onSuccess: () => success(t('recusou'), t('recusouDescricao')),
      onError: (e) => error(t('erroRecusar'), errorMessage(e)),
    });
  }
  function onCancel() {
    cancel.mutate(r.id, {
      onSuccess: () => {
        setConfirmingCancel(false);
        success(r.status === 'WAITLIST' ? t('saiuListaEspera') : t('cancelada'));
      },
      onError: (e) => error(t('erroCancelar'), errorMessage(e)),
    });
  }

  const cancelText =
    r.status === 'WAITLIST'
      ? t('cancelarListaTexto', { campeonato: tournament.name })
      : t('cancelarTexto', { quem: isTeam ? 'squad' : 'voce', squad: r.displayName, campeonato: tournament.name });

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
        {r.statusReason && <p className="text-sm text-muted">{t('motivo', { motivo: r.statusReason })}</p>}
        {r.status === 'PENDING_MEMBERS' && r.reservedUntil && (
          <p className="rounded-md bg-warning-soft p-3 text-sm text-warning-soft-text">{t('vagaReservada', { data: formatDateTime(r.reservedUntil) })}</p>
        )}
      </div>

      {isTeam && r.members.length > 0 && <RegistrationMembers registration={r} viewerId={viewerId} />}

      {active && missingMyAccount && <GameAccountWarning gameName={tournament.gameName} context="confirm" />}

      {needsMyConfirmation && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3">
          <p className="text-sm font-semibold">{t('voceVaiJogar')}</p>
          <div className="flex flex-wrap gap-2">
            <Button loading={confirm.isPending} disabled={missingMyAccount || decline.isPending} onClick={onConfirm}>
              {t('confirmarParticipacao')}
            </Button>
            {!me?.isCaptain && (
              <Button variant="secondary" loading={decline.isPending} disabled={confirm.isPending} onClick={onDecline}>
                {t('recusar')}
              </Button>
            )}
          </div>
        </div>
      )}

      {active && isOwner && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          {cancellable ? (
            <Button variant="secondary" className="self-start" onClick={() => setConfirmingCancel(true)}>
              {r.status === 'WAITLIST' ? t('sairListaEspera') : t('cancelarInscricao')}
            </Button>
          ) : (
            <p className="text-sm text-muted">{t('prazoPassou')}</p>
          )}
        </div>
      )}
      {active && isTeam && !isOwner && <p className="text-sm text-muted">{t('soCapitaoCancela')}</p>}

      {(r.status === 'CANCELLED' || r.status === 'REJECTED') && (
        <Button asChild variant="secondary" className="self-start">
          <Link href="/campeonatos">{t('verOutros')}</Link>
        </Button>
      )}

      <Modal
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title={r.status === 'WAITLIST' ? t('sairListaEspera') : t('cancelarInscricao')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingCancel(false)} disabled={cancel.isPending}>
              {t('voltar')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={onCancel}>
              {r.status === 'WAITLIST' ? t('sairDaLista') : t('cancelarInscricao')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {cancelText}
        </p>
      </Modal>
    </div>
  );
}
