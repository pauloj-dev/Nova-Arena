'use client';

import type { Match } from '@nova/schemas';
import { Button, Input, Modal, Select, useToast } from '@nova/ui';
import { useId, useState } from 'react';
import { errorMessage } from '@/shared/api/client';
import { useMatchLobby, useScheduleMatch, useScheduleRound, useWalkover } from '@/shared/api/hooks/competition';
import { formatDateTime } from '@/shared/lib/datetime';
import { DateTimeField } from '../components/DateTimeField';
import { NumberField } from '../components/NumberField';

const matchTitle = (m: Match) => [m.groupName, m.roundLabel].filter(Boolean).join(' · ');
const sides = (m: Match) => (m.kind === 'DUEL' ? m.participants.map((p) => (p.registrationId ? p.name : (p.sourceLabel ?? 'A definir'))).join(' x ') : `${m.participants.length} equipes`);

/** Quando os participantes passam a ver a sala (a API libera na abertura do check-in ou 15 min antes). */
export function lobbyRevealText(match: Pick<Match, 'checkInOpensAt'>, scheduledAt: string | null): string {
  if (!scheduledAt) return 'Sem horário marcado, a sala fica visível para os participantes assim que você salvar.';
  if (match.checkInOpensAt) return 'Só quem está nesta partida vê a sala, a partir da abertura do check-in. Ela nunca aparece na página pública.';
  return `Só quem está nesta partida vê a sala, a partir de 15 minutos antes do horário (${formatDateTime(new Date(new Date(scheduledAt).getTime() - 15 * 60_000).toISOString())}). Ela nunca aparece na página pública.`;
}

/** Agenda de uma partida: data e hora (com o fuso ao lado do campo), código da sala e senha. */
export function ScheduleMatchDialog({ match, onClose }: { match: Match; onClose: () => void }) {
  const formId = useId();
  const schedule = useScheduleMatch();
  const lobby = useMatchLobby(match.id, match.hasLobby);
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
      title={`Agendar: ${matchTitle(match)}`}
      description={sides(match)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} loading={schedule.isPending}>
            Salvar agenda
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
                success(scheduledAt ? 'Partida agendada' : 'Agenda atualizada', scheduledAt ? `${formatDateTime(scheduledAt)}. Os participantes foram avisados.` : undefined);
                onClose();
              },
              onError: (e) => error('Não foi possível salvar a agenda', errorMessage(e)),
            },
          );
        }}
      >
        <DateTimeField label="Data e hora da partida" value={scheduledAt} onChange={setScheduledAt} hint="Em branco, a partida fica sem horário e você inicia manualmente." />
        <div className="grid gap-4 xs:grid-cols-2">
          <Input label="Código da sala" value={codeValue} maxLength={40} autoComplete="off" onChange={(e) => setCode(e.target.value)} placeholder="Ex.: NOVA-7Q2" />
          <Input label="Senha da sala" value={passwordValue} maxLength={40} autoComplete="off" onChange={(e) => setPassword(e.target.value)} placeholder="Opcional" />
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
  const { success, error } = useToast();
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [gap, setGap] = useState(30);
  const [groupId, setGroupId] = useState('');
  const [attempted, setAttempted] = useState(false);

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Agendar rodada: ${scope.label}`}
      description={`${scope.pending} ${scope.pending === 1 ? 'partida pendente' : 'partidas pendentes'} nesta rodada. Partidas com resultado não mudam.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} loading={schedule.isPending}>
            Agendar rodada
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
                success('Rodada agendada', `A primeira partida começa ${formatDateTime(startsAt)}.`);
                onClose();
              },
              onError: (e) => error('Não foi possível agendar a rodada', errorMessage(e)),
            },
          );
        }}
      >
        <DateTimeField label="Primeira partida" required value={startsAt} onChange={setStartsAt} error={attempted && !startsAt ? 'Informe a data e a hora da primeira partida' : undefined} />
        <NumberField label="Intervalo entre as partidas (minutos)" value={gap} min={0} max={1440} onChange={setGap} hint="0 = todas no mesmo horário." />
        {scope.groups.length > 1 && (
          <Select label="Quais partidas" value={groupId} onChange={(e) => setGroupId(e.target.value)} options={[{ value: '', label: 'Todos os grupos e salas' }, ...scope.groups.map((g) => ({ value: g.id, label: `Só ${g.name}` }))]} />
        )}
      </form>
    </Modal>
  );
}

/** W.O. aplicado pela organização: escolhe quem vence e informa o motivo (RN-04). */
export function WalkoverDialog({ match, onClose }: { match: Match; onClose: () => void }) {
  const formId = useId();
  const walkover = useWalkover();
  const { success, error } = useToast();
  const players = match.participants.filter((p) => p.registrationId !== null);
  const [winner, setWinner] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const reasonError = attempted && reason.trim().length < 3 ? 'Informe o motivo (pelo menos 3 letras)' : undefined;

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={`Aplicar W.O.: ${matchTitle(match)}`}
      description="Quem recebe o W.O. vence pelo placar configurado e avança. Fica registrado na auditoria."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" type="submit" form={formId} loading={walkover.isPending}>
            Aplicar W.O.
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
                success('W.O. aplicado', `${players.find((p) => p.registrationId === winner)?.name ?? 'O vencedor'} venceu por W.O.`);
                onClose();
              },
              onError: (e) => error('Não foi possível aplicar o W.O.', errorMessage(e)),
            },
          );
        }}
      >
        <Select
          label="Quem vence por W.O."
          required
          value={winner}
          onChange={(e) => setWinner(e.target.value)}
          placeholder="Escolha o vencedor"
          options={players.map((p) => ({ value: p.registrationId as string, label: p.name }))}
          error={attempted && !winner ? 'Escolha quem vence' : undefined}
        />
        <Input label="Motivo" required value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: adversário não compareceu" error={reasonError} />
      </form>
    </Modal>
  );
}
