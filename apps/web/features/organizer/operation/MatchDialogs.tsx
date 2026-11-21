'use client';

import type { Match } from '@nova/schemas';
import { Button, Input, Modal, Select, useToast } from '@nova/ui';
import { useId, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMatchLobby, useScheduleMatch, useScheduleRound, useWalkover } from '@/shared/api/hooks/competition';
import { getT } from '@/shared/i18n/core';
import { useT } from '@/shared/i18n/react';
import { formatDateTime } from '@/shared/lib/datetime';
import { DateTimeField } from '../components/DateTimeField';
import { NumberField } from '../components/NumberField';
import { messages } from './messages';

const matchTitle = (m: Match) => [m.groupName, m.roundLabel].filter(Boolean).join(' · ');
function sides(m: Match): string {
  const t = getT(messages, 'MatchDialogs');
  return m.kind === 'DUEL' ? m.participants.map((p) => (p.registrationId ? p.name : (p.sourceLabel ?? t('aDefinir')))).join(' x ') : t('equipes', { count: m.participants.length });
}

/** Quando os participantes passam a ver a sala (a API libera na abertura do check-in ou 15 min antes). */
export function lobbyRevealText(match: Pick<Match, 'checkInOpensAt'>, scheduledAt: string | null): string {
  const t = getT(messages, 'MatchDialogs');
  if (!scheduledAt) return t('salaSemHorario');
  if (match.checkInOpensAt) return t('salaCheckIn');
  return t('salaAntes', { when: formatDateTime(new Date(new Date(scheduledAt).getTime() - 15 * 60_000).toISOString()) });
}

/** Agenda de uma partida: data e hora (com o fuso ao lado do campo), código da sala e senha. */
export function ScheduleMatchDialog({ match, onClose }: { match: Match; onClose: () => void }) {
  const formId = useId();
  const schedule = useScheduleMatch();
  const lobby = useMatchLobby(match.id, match.hasLobby);
  const t = useT(messages, 'MatchDialogs');
  const { success, error } = useToast();
  const [scheduledAt, setScheduledAt] = useState<string | null>(match.scheduledAt);
  const [code, setCode] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  // A sala já cadastrada chega depois (só a organização a lê); o que a pessoa digitar tem prioridade.
  const codeValue = code ?? lobby.data?.code ?? '';
  const passwordValue = password ?? lobby.data?.password ?? '';

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('agendarTitulo', { title: matchTitle(match) })}
      description={sides(match)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button type="submit" form={formId} loading={schedule.isPending}>
            {t('salvarAgenda')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          schedule.mutate(
            { matchId: match.id, scheduledAt, lobbyCode: codeValue.trim() || null, lobbyPassword: passwordValue.trim() || null },
            {
              onSuccess: () => {
                success(scheduledAt ? t('partidaAgendada') : t('agendaAtualizada'), scheduledAt ? t('agendadaDescricao', { when: formatDateTime(scheduledAt) }) : undefined);
                onClose();
              },
              onError: (e) => error(t('erroAgenda'), errorMessage(e)),
            },
          );
        }}
      >
        <DateTimeField label={t('dataHora')} value={scheduledAt} onChange={setScheduledAt} hint={t('dataHoraDica')} />
        <div className="grid gap-4 xs:grid-cols-2">
          <Input label={t('codigoSala')} value={codeValue} maxLength={40} autoComplete="off" onChange={(e) => setCode(e.target.value)} placeholder={t('codigoSalaPlaceholder')} />
          <Input label={t('senhaSala')} value={passwordValue} maxLength={40} autoComplete="off" onChange={(e) => setPassword(e.target.value)} placeholder={t('senhaSalaPlaceholder')} />
        </div>
        <p className="rounded-md bg-info-soft px-3 py-2 text-sm text-info-soft-text" data-testid="lobby-reveal">
          {lobbyRevealText(match, scheduledAt)}
        </p>
      </form>
    </Modal>
  );
}

export interface RoundScope {
  stageId: string;
  round: number;
  label: string;
  /** Grupos ou salas da fase, quando existem. */
  groups: { id: string; name: string }[];
  bracket: Match['bracket'];
  pending: number;
}

/** Agenda da rodada inteira: a primeira partida no horário escolhido e as seguintes a cada N minutos. */
export function ScheduleRoundDialog({ scope, onClose }: { scope: RoundScope; onClose: () => void }) {
  const formId = useId();
  const schedule = useScheduleRound(scope.stageId);
  const t = useT(messages, 'MatchDialogs');
  const { success, error } = useToast();
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [gap, setGap] = useState(30);
  const [groupId, setGroupId] = useState('');
  const [attempted, setAttempted] = useState(false);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('agendarRodadaTitulo', { label: scope.label })}
      description={t('agendarRodadaDescricao', { count: scope.pending })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button type="submit" form={formId} loading={schedule.isPending}>
            {t('agendarRodada')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (!startsAt) return;
          schedule.mutate(
            { round: scope.round, startsAt, intervalMinutes: gap, ...(groupId ? { groupId } : {}), ...(scope.bracket ? { bracket: scope.bracket } : {}) },
            {
              onSuccess: () => {
                success(t('rodadaAgendada'), t('rodadaAgendadaDescricao', { when: formatDateTime(startsAt) }));
                onClose();
              },
              onError: (e) => error(t('erroRodada'), errorMessage(e)),
            },
          );
        }}
      >
        <DateTimeField label={t('primeiraPartida')} required value={startsAt} onChange={setStartsAt} error={attempted && !startsAt ? t('primeiraPartidaErro') : undefined} />
        <NumberField label={t('intervalo')} value={gap} min={0} max={1440} onChange={setGap} hint={t('intervaloDica')} />
        {scope.groups.length > 1 && (
          <Select label={t('quaisPartidas')} value={groupId} onChange={(e) => setGroupId(e.target.value)} options={[{ value: '', label: t('todosGrupos') }, ...scope.groups.map((g) => ({ value: g.id, label: t('soGrupo', { name: g.name }) }))]} />
        )}
      </form>
    </Modal>
  );
}

/** W.O. aplicado pela organização: escolhe quem vence e informa o motivo (RN-04). */
export function WalkoverDialog({ match, onClose }: { match: Match; onClose: () => void }) {
  const formId = useId();
  const walkover = useWalkover();
  const t = useT(messages, 'MatchDialogs');
  const { success, error } = useToast();
  const players = match.participants.filter((p) => p.registrationId !== null);
  const [winner, setWinner] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonError = attempted && reason.trim().length < 3 ? t('motivoErro') : undefined;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={t('woTitulo', { title: matchTitle(match) })}
      description={t('woDescricao')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('voltar')}
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={walkover.isPending}>
            {t('aplicarWo')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (!winner || reason.trim().length < 3) return;
          walkover.mutate(
            { matchId: match.id, winnerRegistrationId: winner, reason: reason.trim() },
            {
              onSuccess: () => {
                success(t('woAplicado'), t('woVenceu', { name: players.find((p) => p.registrationId === winner)?.name ?? t('oVencedor') }));
                onClose();
              },
              onError: (e) => error(t('erroWo'), errorMessage(e)),
            },
          );
        }}
      >
        <Select
          label={t('quemVence')}
          required
          value={winner}
          onChange={(e) => setWinner(e.target.value)}
          placeholder={t('escolhaVencedor')}
          options={players.map((p) => ({ value: p.registrationId as string, label: p.name }))}
          error={attempted && !winner ? t('escolhaQuemVence') : undefined}
        />
        <Input label={t('motivo')} required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder={t('motivoPlaceholder')} error={reasonError} />
      </form>
    </Modal>
  );
}
