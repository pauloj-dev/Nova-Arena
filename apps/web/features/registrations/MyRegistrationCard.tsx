'use client';

import type { Registration, Tournament } from '@nova/schemas';
import { Button, Modal, StatusPill, useToast } from '@nova/ui';
import { UserMinus } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCancelRegistration, useConfirmRegistration, useDeclineRegistration, useRemoveRosterMember } from '@/shared/api/hooks/registrations';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { GameAccountWarning } from './GameAccountWarning';
import { canCancelRegistration, canCaptainEditRoster, missingConfirmations } from './lib/rules';
import { messages } from './messages';
import { RegistrationMembers } from './RegistrationMembers';

// Só o capitão, com o elenco ainda aberto, escala membros: fora do JS de quem só acompanha.
const CaptainRoster = dynamic(() => import('./CaptainRoster').then((m) => m.CaptainRoster));

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
  const remove = useRemoveRosterMember();
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
  // Trava de elenco (PRD §12.1): até ela o capitão troca membros; depois, só a organização.
  const rosterOpen = active && isTeam && canCaptainEditRoster({ status: tournament.status, rosterLockAt: tournament.rosterLockAt }, now);
  const editsRoster = rosterOpen && Boolean(me?.isCaptain);

  function onConfirm() {
    confirm.mutate(r.id, {
      onSuccess: (updated) => success(t('confirmado'), updated.status === 'PENDING_MEMBERS' ? t('esperarSquad') : undefined),
      onError: (e) => error(t('erroConfirmar'), errorMessage(e)),
    });
  }
  // Recusar e cancelar tiram este cartão da tela (a inscrição deixa de ser minha) assim que a lista recarrega. O
  // `onSuccess` de `mutate` é descartado quando o componente já saiu; a promessa de `mutateAsync` não: o aviso sempre aparece.
  function onDecline() {
    decline.mutateAsync(r.id).then(
      () => success(t('recusou'), t('recusouDescricao')),
      (e: unknown) => error(t('erroRecusar'), errorMessage(e)),
    );
  }
  function onRemove(userId: string, nickname: string) {
    remove.mutate(
      { registrationId: r.id, userId },
      {
        onSuccess: () => success(t('tirou', { nome: nickname })),
        onError: (e) => error(t('erroElenco'), errorMessage(e)),
      },
    );
  }
  function onCancel() {
    const leavingWaitlist = r.status === 'WAITLIST';
    cancel.mutateAsync(r.id).then(
      () => {
        setConfirmingCancel(false);
        success(leavingWaitlist ? t('saiuListaEspera') : t('cancelada'));
      },
      (e: unknown) => error(t('erroCancelar'), errorMessage(e)),
    );
  }

  const cancelText =
    r.status === 'WAITLIST'
      ? t('cancelarListaTexto', { campeonato: tournament.name })
      : t('cancelarTexto', { quem: isTeam ? 'squad' : 'voce', squad: r.displayName, campeonato: tournament.name });

  return (
    <div className="flex flex-col gap-4">
      {needsMyConfirmation && (
        <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning-soft p-3 text-warning-soft-text" data-testid="confirm-participation">
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

      {isTeam && r.members.length > 0 && (
        <RegistrationMembers
          registration={r}
          viewerId={viewerId}
          actions={
            editsRoster
              ? (m) =>
                  m.isCaptain ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      iconLeft={<UserMinus className="size-4" aria-hidden />}
                      aria-label={t('tirarRotulo', { nome: m.nickname })}
                      loading={remove.isPending && remove.variables?.userId === m.userId}
                      disabled={remove.isPending}
                      onClick={() => onRemove(m.userId, m.nickname)}
                    >
                      {t('tirar')}
                    </Button>
                  )
              : undefined
          }
        />
      )}
      {rosterOpen && <p className="text-xs text-muted">{tournament.rosterLockAt ? t('trocarElencoAte', { data: formatDateTime(tournament.rosterLockAt) }) : t('trocarElencoSemData')}</p>}
      {editsRoster && <CaptainRoster tournament={tournament} registration={r} />}

      {active && missingMyAccount && <GameAccountWarning gameId={tournament.gameId} gameName={tournament.gameName} context="confirm" />}

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
