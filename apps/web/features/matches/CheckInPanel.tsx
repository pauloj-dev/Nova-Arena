'use client';

import type { Match } from '@nova/schemas';
import { Button, cn, useToast } from '@nova/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, UserX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useCheckIn } from '@/shared/api/hooks/competition';
import { keys } from '@/shared/api/keys';
import { browserTimeZone, formatRelative, formatTime, timeZoneLabel } from '@/shared/lib/datetime';
import { checkInDuty, checkInPhase, countdownSpoken, formatCountdown, msUntilClose } from './checkin';
import { isOver, participantOf } from './matchText';
import { useNow } from './useNow';
import type { MatchViewer } from './viewer';

export interface CheckInPanelProps {
  match: Match;
  viewer: MatchViewer;
  className?: string;
}

const box = 'flex flex-col gap-2 rounded-md border border-border p-3 text-sm';

/**
 * Check-in de uma partida, só para quem está nela (PAR-07):
 * antes da janela diz quando abre; durante, mostra o botão (para quem precisa fazer) e a contagem
 * regressiva; depois, o que aconteceu. Em squad, explica quem faz o check-in.
 */
export function CheckInPanel({ match, viewer, className }: CheckInPanelProps) {
  const registration = viewer.registration;
  const mine = participantOf(match, registration?.id);
  const playing = Boolean(mine) && registration?.status === 'CONFIRMED';
  const over = isOver(match);
  const hasWindow = Boolean(match.checkInOpensAt && match.checkInClosesAt);

  const now = useNow(1000, playing && hasWindow && !over);
  const phase = checkInPhase(match, now);
  const checkIn = useCheckIn();
  const qc = useQueryClient();
  const { success, error } = useToast();
  /** Check-in que eu acabei de fazer (a API só diz quando o squad inteiro terminou). */
  const [doneByMe, setDoneByMe] = useState(false);
  const [apiMessage, setApiMessage] = useState<string | null>(null);

  // Quando a janela abre ou fecha, o status da partida (e a sala) mudam no servidor: busca de novo.
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    void qc.invalidateQueries({ queryKey: keys.matches.detail(match.id) });
    void qc.invalidateQueries({ queryKey: keys.stages.bracket(match.stageId) });
    void qc.invalidateQueries({ queryKey: keys.tournaments.matches(match.tournamentId) });
    void qc.invalidateQueries({ queryKey: keys.tournaments.mine('participant') });
  }, [phase, qc, match.id, match.stageId, match.tournamentId]);

  if (!mine || !playing || !registration) return null;

  const team = registration.teamId !== null;
  const who = team ? 'O squad' : 'Você';

  if (over) {
    if (match.status !== 'WALKOVER') return null;
    return (
      <div className={cn(box, mine.isWinner ? 'bg-primary-soft text-primary-soft-text' : 'bg-danger-soft text-danger-soft-text', className)} data-testid="checkin-panel">
        <p className="flex items-center gap-1.5 font-semibold">
          <UserX className="size-4 shrink-0" aria-hidden />
          {mine.isWinner ? `${who} venceu por W.O.` : `${who} levou W.O. nesta partida.`}
        </p>
        <p>{mine.isWinner ? 'O adversário não se apresentou.' : 'Se você acha que houve engano, fale com a organização do campeonato.'}</p>
      </div>
    );
  }

  if (phase === 'NONE') return null;

  const duty = checkInDuty(registration, viewer.userId, viewer.checkIn?.requireAllMembers ?? null);
  const done = mine.checkedIn || (doneByMe && !team);
  const zone = timeZoneLabel(browserTimeZone(), new Date(now));

  if (phase === 'BEFORE' && match.checkInOpensAt && match.checkInClosesAt) {
    return (
      <div className={cn(box, 'bg-surface-2', className)} data-testid="checkin-panel">
        <p className="flex items-center gap-1.5 font-semibold">
          <Clock className="size-4 shrink-0 text-muted" aria-hidden />
          O check-in abre às {formatTime(match.checkInOpensAt)}
        </p>
        <p className="text-muted">
          {formatRelative(match.checkInOpensAt, new Date(now))} · fecha às {formatTime(match.checkInClosesAt)} · {zone}. Quem não fizer leva W.O.
        </p>
        {duty.explanation && <p className="text-muted">{duty.explanation}</p>}
      </div>
    );
  }

  if (phase === 'CLOSED') {
    return done ? (
      <div className={cn(box, 'bg-primary-soft text-primary-soft-text', className)} data-testid="checkin-panel">
        <p className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Check-in feito
        </p>
        <p>A janela fechou com a presença confirmada. {match.scheduledAt ? `A partida começa às ${formatTime(match.scheduledAt)} · ${zone}.` : ''}</p>
      </div>
    ) : (
      <div className={cn(box, 'bg-warning-soft text-warning-soft-text', className)} data-testid="checkin-panel">
        <p className="flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          O check-in fechou sem a presença {team ? 'do squad' : 'confirmada'}
        </p>
        <p>A organização define o que acontece agora. Sem check-in, o resultado costuma ser W.O.</p>
      </div>
    );
  }

  // Janela aberta.
  const remaining = msUntilClose(match, now);
  const countdown = (
    <p className="flex items-center gap-1.5">
      <Clock className="size-4 shrink-0" aria-hidden />
      Fecha em{' '}
      <span role="timer" aria-live="off" className="tabular text-base" data-testid="checkin-countdown">
        {formatCountdown(remaining)}
      </span>
    </p>
  );

  function onCheckIn() {
    setApiMessage(null);
    checkIn.mutate(match.id, {
      onSuccess: () => {
        setDoneByMe(true);
        success('Check-in feito', 'Sua presença está confirmada.');
      },
      onError: (e) => {
        // 403/409: a API explica por quê (janela fechou, é o capitão quem faz…).
        setApiMessage(errorMessage(e));
        error('Não foi possível fazer o check-in', errorMessage(e));
      },
    });
  }

  if (done) {
    return (
      <div className={cn(box, 'bg-primary-soft text-primary-soft-text', className)} data-testid="checkin-panel">
        <p className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Check-in feito
        </p>
        <p>{team ? 'O squad está confirmado nesta partida.' : 'Sua presença está confirmada.'} Fique de olho na sala da partida.</p>
      </div>
    );
  }

  return (
    <div className={cn(box, 'bg-warning-soft text-warning-soft-text', className)} data-testid="checkin-panel">
      <p className="font-semibold">Check-in aberto</p>
      {doneByMe ? (
        <p className="flex items-center gap-1.5 font-semibold">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          Seu check-in está feito. Falta o de outros titulares do squad.
        </p>
      ) : duty.mustCheckIn ? (
        <>
          <p>Confirme a presença {team ? 'do squad ' : ''}para não levar W.O.</p>
          <Button className="self-start" loading={checkIn.isPending} onClick={onCheckIn}>
            Fazer check-in
          </Button>
        </>
      ) : (
        <p>Aguardando o check-in do squad.</p>
      )}
      {countdown}
      {/* Fala só de minuto em minuto: a contagem visível muda a cada segundo. */}
      <p className="sr-only" aria-live="polite">
        {countdownSpoken(remaining)}
      </p>
      {duty.explanation && <p>{duty.explanation}</p>}
      {apiMessage && (
        <p role="alert" className="font-semibold">
          {apiMessage}
        </p>
      )}
    </div>
  );
}
