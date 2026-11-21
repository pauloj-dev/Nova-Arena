'use client';

import type { Game, Match, OrganizerTournamentDetail } from '@nova/schemas';
import { Button, EmptyState, ErrorState, Select, Skeleton, useToast } from '@nova/ui';
import { CalendarClock, CalendarPlus, FileUp, Flag, MessagesSquare, PencilLine, Play, Swords, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { MatchCard } from '@/features/matches/MatchCard';
import { MatchChatDialog } from '@/features/matches/chat/MatchChatDialog';
import type { MatchViewer } from '@/features/matches/viewer';
import { errorMessage } from '@/shared/api/client';
import { useStartMatch, useTournamentMatches } from '@/shared/api/hooks/competition';
import { useT } from '@/shared/i18n/react';
import { timeZoneLabel, userTimeZone } from '@/shared/lib/datetime';
import { useSession } from '@/shared/session/useSession';
import { ScheduleMatchDialog, ScheduleRoundDialog, WalkoverDialog, type RoundScope } from '../operation/MatchDialogs';
import { ImportResultsDialog } from '../operation/results/ImportResultsDialog';
import { ResultPanel } from '../operation/results/ResultPanel';
import { PendingResultsPanel } from '../operation/results/offline/PendingResultsPanel';
import { byOrder, currentStage } from '../operation/stageUtils';
import { messages } from './messages';

type StatusFilter = 'all' | 'pending' | 'scheduled' | 'done';
const FILTERS: StatusFilter[] = ['all', 'pending', 'scheduled', 'done'];

const isDone = (m: Match) => m.status === 'VALIDATED' || m.status === 'WALKOVER';
const isOver = (m: Match) => isDone(m) || m.status === 'CANCELLED';

function matchesFilter(m: Match, filter: StatusFilter): boolean {
  if (filter === 'pending') return !isOver(m);
  if (filter === 'scheduled') return !isOver(m) && m.scheduledAt !== null;
  if (filter === 'done') return isDone(m);
  return true;
}

/** Chave das mensagens do lado da chave (a chave de vencedores não tem rótulo). */
const BRACKET_KEY = { LOSERS: 'losers', FINAL: 'final', THIRD_PLACE: 'thirdPlace' } as const;

type MatchesT = ReturnType<typeof useT<(typeof messages)['pt-BR'], 'MatchesTab'>>;

/** Nome curto de uma partida, para os rótulos dos botões: "Quartas de final: Bianca x Kaue" ou "Grupo A, Queda 2". */
function matchName(m: Match, t: MatchesT): string {
  const head = [m.groupName, m.roundLabel].filter(Boolean).join(', ');
  return m.kind === 'DUEL' ? t('nomePartida', { cabecalho: head, participantes: m.participants.map((p) => (p.registrationId ? p.name : t('aDefinir'))).join(' x ') }) : head;
}

interface RoundSection {
  key: string;
  label: string;
  round: number;
  bracket: Match['bracket'];
  matches: Match[];
}

/** Agrupa por rodada (e lado da chave), na ordem em que são jogadas. */
function groupByRound(matches: Match[], t: MatchesT): RoundSection[] {
  const bracketLabel = (b: NonNullable<Match['bracket']>) => (b === 'WINNERS' ? '' : t(`chaves.${BRACKET_KEY[b]}`));
  const sections = new Map<string, RoundSection>();
  for (const m of matches) {
    const key = `${m.bracket ?? ''}|${m.round}`;
    const section = sections.get(key) ?? { key, round: m.round, bracket: m.bracket, matches: [], label: [m.bracket ? bracketLabel(m.bracket) : '', m.roundLabel].filter(Boolean).join(' · ') };
    section.matches.push(m);
    sections.set(key, section);
  }
  const side = (b: Match['bracket']) => (b === 'LOSERS' ? 1 : b === 'FINAL' ? 2 : b === 'THIRD_PLACE' ? 3 : 0);
  return [...sections.values()]
    .sort((a, b) => side(a.bracket) - side(b.bracket) || a.round - b.round)
    .map((s) => ({ ...s, matches: s.matches.sort((a, b) => (a.groupName ?? '').localeCompare(b.groupName ?? '', 'pt-BR', { numeric: true }) || a.position - b.position) }));
}

type Dialog = { kind: 'chat'; match: Match } | { kind: 'schedule'; match: Match } | { kind: 'walkover'; match: Match } | { kind: 'round'; scope: RoundScope } | { kind: 'import' } | null;

/**
 * Aba Partidas e resultados (ORG-06 e ORG-07): partidas por fase e rodada, com filtros; agenda da
 * partida ou da rodada inteira, sala e senha, iniciar/voltar, W.O. e o lançamento de resultados.
 * Tudo aqui também é permitido ao moderador (PRD §6).
 */
export function MatchesTab({ tournament, game, onGoToStages }: { tournament: OrganizerTournamentDetail; game: Game | null; onGoToStages: () => void }) {
  const t = useT(messages, 'MatchesTab');
  const { user } = useSession();
  const query = useTournamentMatches(tournament.id);
  const start = useStartMatch();
  const { success, error } = useToast();
  const stages = byOrder(tournament.stages);
  const [stageId, setStageId] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const all = query.data ?? [];
  const stagesWithMatches = stages.filter((s) => all.some((m) => m.stageId === s.id));
  // Por padrão, a fase em que o campeonato está (ou a última que tem partidas).
  const selectedStageId = stageId ?? (stagesWithMatches.find((s) => s.id === currentStage(tournament.stages)?.id) ?? stagesWithMatches.at(-1))?.id ?? null;
  const stageMatches = all.filter((m) => m.stageId === selectedStageId);
  const sections = groupByRound(stageMatches.filter((m) => matchesFilter(m, filter)), t);
  const selectedStage = stages.find((s) => s.id === selectedStageId);
  const hasLobbies = stageMatches.some((m) => m.kind === 'LOBBY');
  const paused = tournament.status === 'PAUSED';
  const closed = tournament.status === 'FINISHED' || tournament.status === 'ARCHIVED' || tournament.status === 'CANCELLED';
  const viewer: MatchViewer = { userId: user?.id ?? null, registration: null, checkIn: tournament.checkIn, isStaff: true };
  const editing = editingId ? all.find((m) => m.id === editingId) : undefined;

  if (!query.data) {
    if (query.error) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t('carregando')}>
        <Skeleton className="h-11 w-full max-w-md" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Swords className="size-7" />}
        title={t('vazioTitulo')}
        description={t('vazioDescricao')}
        action={<Button onClick={onGoToStages}>{t('irParaFases')}</Button>}
      />
    );
  }

  if (editing) {
    return (
      <>
        <ResultPanel key={editing.id} tournament={tournament} match={editing} stageMatches={all.filter((m) => m.stageId === editing.stageId)} game={game} onClose={() => setEditingId(null)} onImportCsv={() => setDialog({ kind: 'import' })} />
        {dialog?.kind === 'import' && <ImportResultsDialog tournamentId={tournament.id} stageName={editing.stageName} matches={all.filter((m) => m.stageId === editing.stageId)} open onOpenChange={(open) => !open && setDialog(null)} />}
      </>
    );
  }

  function toggleLive(match: Match, live: boolean) {
    start.mutate(
      { matchId: match.id, live },
      { onSuccess: () => success(live ? t('iniciada') : t('voltouAgendada')), onError: (e) => error(live ? t('erroIniciar') : t('erroVoltar'), errorMessage(e)) },
    );
  }

  function actions(match: Match) {
    const name = matchName(match, t);
    // Chat da partida (issue 125): continua aberto para leitura depois do encerramento.
    const chatButton = (
      <Button key="chat" size="sm" variant="ghost" iconLeft={<MessagesSquare className="size-4" aria-hidden />} aria-label={t('chatRotulo', { nome: name })} onClick={() => setDialog({ kind: 'chat', match })}>
        {t('chat')}
      </Button>
    );
    if (closed) return match.waitingPrevious ? null : <div className="flex flex-wrap gap-2">{chatButton}</div>;
    const ready = !match.waitingPrevious;
    const buttons = [];
    if (!isOver(match) && ready) {
      buttons.push(
        <Button key="result" size="sm" disabled={paused} iconLeft={<PencilLine className="size-4" aria-hidden />} aria-label={t('lancarRotulo', { nome: name })} onClick={() => setEditingId(match.id)}>
          {t('lancar')}
        </Button>,
      );
    }
    if (isDone(match)) {
      buttons.push(
        <Button key="fix" size="sm" variant="secondary" disabled={paused} iconLeft={<PencilLine className="size-4" aria-hidden />} aria-label={t('corrigirRotulo', { nome: name })} onClick={() => setEditingId(match.id)}>
          {t('corrigir')}
        </Button>,
      );
    }
    if (!isOver(match)) {
      buttons.push(
        <Button key="schedule" size="sm" variant="secondary" iconLeft={<CalendarClock className="size-4" aria-hidden />} aria-label={t('agendarRotulo', { reagendar: match.scheduledAt ? 'sim' : 'nao', nome: name })} onClick={() => setDialog({ kind: 'schedule', match })}>
          {t('agendar', { reagendar: match.scheduledAt ? 'sim' : 'nao' })}
        </Button>,
      );
      if (ready && match.status !== 'LIVE') {
        buttons.push(
          <Button key="start" size="sm" variant="ghost" loading={start.isPending && start.variables?.matchId === match.id} iconLeft={<Play className="size-4" aria-hidden />} aria-label={t('iniciarRotulo', { nome: name })} onClick={() => toggleLive(match, true)}>
            {t('iniciar')}
          </Button>,
        );
      }
      if (match.status === 'LIVE') {
        buttons.push(
          <Button key="back" size="sm" variant="ghost" loading={start.isPending && start.variables?.matchId === match.id} iconLeft={<Undo2 className="size-4" aria-hidden />} aria-label={t('voltarAgendadaRotulo', { nome: name })} onClick={() => toggleLive(match, false)}>
            {t('voltarAgendada')}
          </Button>,
        );
      }
      if (match.kind === 'DUEL' && ready) {
        buttons.push(
          <Button key="wo" size="sm" variant="ghost" disabled={paused} iconLeft={<Flag className="size-4" aria-hidden />} aria-label={t('woRotulo', { nome: name })} onClick={() => setDialog({ kind: 'walkover', match })}>
            {t('wo')}
          </Button>,
        );
      }
    }
    if (!match.waitingPrevious) buttons.push(chatButton);
    return buttons.length > 0 ? <div className="flex flex-wrap gap-2">{buttons}</div> : null;
  }

  const groups = [...new Map(stageMatches.filter((m) => m.groupId !== null).map((m) => [m.groupId as string, { id: m.groupId as string, name: m.groupName ?? '' }])).values()];
  const count = (f: StatusFilter) => stageMatches.filter((m) => matchesFilter(m, f)).length;

  return (
    <div className="flex flex-col gap-5">
      <PendingResultsPanel tournamentId={tournament.id} onOpenMatch={setEditingId} />
      {paused && (
        <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm font-medium text-warning-soft-text">
          {t('pausado')}
        </p>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid gap-3 xs:grid-cols-2 md:flex">
          <Select className="md:w-64" label={t('fase')} value={selectedStageId ?? ''} onChange={(e) => setStageId(e.target.value)} options={stagesWithMatches.map((s) => ({ value: s.id, label: s.name }))} />
          <Select className="md:w-64" label={t('mostrar')} value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} options={FILTERS.map((f) => ({ value: f, label: t(`filtros.${f}`, { count: count(f) }) }))} />
        </div>
        {hasLobbies && !closed && (
          <Button variant="secondary" iconLeft={<FileUp className="size-4" aria-hidden />} onClick={() => setDialog({ kind: 'import' })}>
            {t('importar')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">{t('horarios', { fuso: timeZoneLabel(userTimeZone()) })}</p>

      {sections.length === 0 ? (
        <EmptyState icon={<Swords className="size-7" />} title={t('filtroVazioTitulo')} description={t('filtroVazioDescricao')} />
      ) : (
        sections.map((section) => {
          const pending = section.matches.filter((m) => !isOver(m));
          return (
            <section key={section.key} className="flex flex-col gap-3" aria-label={section.label} data-testid="round-section">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg">
                  {section.label} <span className="text-sm font-normal text-muted">{t('totalPartidas', { count: section.matches.length })}</span>
                </h2>
                {!closed && pending.length > 1 && selectedStageId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    iconLeft={<CalendarPlus className="size-4" aria-hidden />}
                    aria-label={t('agendarRodadaRotulo', { rodada: section.label })}
                    onClick={() => setDialog({ kind: 'round', scope: { stageId: selectedStageId, round: section.round, label: section.label, groups, bracket: section.bracket, pending: pending.length } })}
                  >
                    {t('agendarRodada')}
                  </Button>
                )}
              </div>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {section.matches.map((match) => (
                  <li key={match.id} className="min-w-0">
                    <MatchCard match={match} viewer={viewer} variant="compact" headingLevel={3} footer={actions(match)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {dialog?.kind === 'chat' && <MatchChatDialog key={dialog.match.id} match={dialog.match} viewer={viewer} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'schedule' && <ScheduleMatchDialog key={dialog.match.id} match={dialog.match} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'walkover' && <WalkoverDialog key={dialog.match.id} match={dialog.match} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'round' && <ScheduleRoundDialog key={`${dialog.scope.stageId}-${dialog.scope.round}`} scope={dialog.scope} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && selectedStage && <ImportResultsDialog tournamentId={tournament.id} stageName={selectedStage.name} matches={stageMatches} open onOpenChange={(open) => !open && setDialog(null)} />}
    </div>
  );
}
