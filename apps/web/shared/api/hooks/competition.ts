'use client';

/**
 * Hooks de competição (F2): chave, classificação, partidas, agenda, check-in, resultados,
 * avanço de fase, desistência e encerramento. As consultas "ao vivo" passam a atualizar por
 * polling de 10 s quando o tempo real cai (CT-10).
 */
import {
  AdvancePreview,
  Bracket,
  ImportResultsResult,
  Match,
  MatchLobby,
  Podium,
  Registration,
  ResultEvent,
  Standings,
  SubmitResultResponse,
  type FinishTournamentInput,
  type GenerateBracketInput,
  type ScheduleMatchInput,
  type ScheduleRoundInput,
  type SubmitResultInput,
  type SwapSeedingInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useLiveRefetchInterval } from '../../realtime/RealtimeProvider';
import { api } from '../client';
import { keys } from '../keys';

const Matches = z.array(Match);
const ResultEvents = z.array(ResultEvent);
const PodiumOrNull = Podium.nullable();
const PodiumSuggestion = z.object({ complete: z.boolean(), ranking: z.array(z.object({ registrationId: z.string(), name: z.string(), position: z.number() })) });
export type PodiumSuggestion = z.infer<typeof PodiumSuggestion>;

/** Tudo o que muda quando uma partida ou a chave de uma fase muda. */
function invalidateStage(qc: QueryClient, stageId: string, tournamentId?: string): void {
  void qc.invalidateQueries({ queryKey: keys.stages.bracket(stageId) });
  void qc.invalidateQueries({ queryKey: keys.stages.standings(stageId) });
  void qc.invalidateQueries({ queryKey: keys.stages.preview(stageId) });
  void qc.invalidateQueries({ queryKey: tournamentId ? ['tournaments', 'matches', tournamentId] : ['tournaments', 'matches'] });
  void qc.invalidateQueries({ queryKey: ['match'] });
}

/** ID da fase a partir do ID global da partida (`<stageId>~<nó>`). */
export function stageIdOfMatch(matchId: string): string {
  return matchId.slice(0, matchId.indexOf('~'));
}

// ── Leitura ──────────────────────────────────────────────────────────
export function useBracket(stageId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.stages.bracket(stageId ?? ''),
    queryFn: ({ signal }) => api.get(`/stages/${stageId}/bracket`, { schema: Bracket, signal }),
    enabled: Boolean(stageId),
    refetchInterval,
  });
}

export function useStandings(stageId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.stages.standings(stageId ?? ''),
    queryFn: ({ signal }) => api.get(`/stages/${stageId}/standings`, { schema: Standings, signal }),
    enabled: Boolean(stageId),
    refetchInterval,
  });
}

export function useTournamentMatches(tournamentId: string | undefined, opts: { stageId?: string; mine?: boolean } = {}) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.tournaments.matches(tournamentId ?? '', opts),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/matches`, { schema: Matches, signal, query: { stageId: opts.stageId, mine: opts.mine ? 1 : undefined } }),
    enabled: Boolean(tournamentId),
    refetchInterval,
  });
}

export function useMatch(matchId: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.matches.detail(matchId ?? ''),
    queryFn: ({ signal }) => api.get(`/matches/${matchId}`, { schema: Match, signal }),
    enabled: Boolean(matchId),
    refetchInterval,
  });
}

/** Código da sala. Só responde para quem está na partida (no horário) ou para a organização. */
export function useMatchLobby(matchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.matches.lobby(matchId ?? ''),
    queryFn: ({ signal }) => api.get(`/matches/${matchId}/lobby`, { schema: MatchLobby, signal }),
    enabled: Boolean(matchId) && enabled,
    retry: false,
    staleTime: 0,
  });
}

export function useMatchEvents(matchId: string | undefined) {
  return useQuery({
    queryKey: [...keys.matches.detail(matchId ?? ''), 'events'],
    queryFn: ({ signal }) => api.get(`/matches/${matchId}/events`, { schema: ResultEvents, signal }),
    enabled: Boolean(matchId),
  });
}

export function usePodium(tournamentId: string | undefined) {
  return useQuery({
    queryKey: [...keys.tournaments.detail(tournamentId ?? ''), 'podium'],
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/podium`, { schema: PodiumOrNull, signal }),
    enabled: Boolean(tournamentId),
  });
}

export function usePodiumSuggestion(tournamentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...keys.tournaments.detail(tournamentId ?? ''), 'podium-suggestion'],
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/podium-suggestion`, { schema: PodiumSuggestion, signal }),
    enabled: Boolean(tournamentId) && enabled,
  });
}

/** Prévia do avanço de fase (classificados, eliminados e a próxima chave). Não grava nada. */
export function useAdvancePreview(stageId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.stages.preview(stageId ?? ''),
    queryFn: ({ signal }) => api.get(`/stages/${stageId}/advance`, { schema: AdvancePreview, signal }),
    enabled: Boolean(stageId) && enabled,
    retry: false,
  });
}

// ── Chave ────────────────────────────────────────────────────────────
export function useGenerateBracket(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateBracketInput) => api.post(`/stages/${stageId}/generate`, input, { schema: Bracket }),
    onSuccess: (bracket) => qc.setQueryData(keys.stages.bracket(stageId), bracket),
  });
}

export function useSwapSeeding(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SwapSeedingInput) => api.patch(`/stages/${stageId}/seeding`, input, { schema: Bracket }),
    onSuccess: (bracket) => qc.setQueryData(keys.stages.bracket(stageId), bracket),
  });
}

export function useConfirmBracket(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/stages/${stageId}/confirm`, undefined, { schema: Bracket }),
    onSuccess: (bracket) => {
      qc.setQueryData(keys.stages.bracket(stageId), bracket);
      invalidateStage(qc, stageId, bracket.tournamentId);
      void qc.invalidateQueries({ queryKey: keys.tournaments.all });
    },
  });
}

/** Só Admin: destrava a chave depois da 1ª partida concluída. */
export function useUnlockBracket(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => api.post(`/stages/${stageId}/unlock`, { reason }, { schema: Bracket }),
    onSuccess: (bracket) => qc.setQueryData(keys.stages.bracket(stageId), bracket),
  });
}

/** Suíço: gera a próxima rodada. */
export function useNextSwissRound(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/stages/${stageId}/next-round`, undefined, { schema: Bracket }),
    onSuccess: (bracket) => {
      qc.setQueryData(keys.stages.bracket(stageId), bracket);
      invalidateStage(qc, stageId, bracket.tournamentId);
    },
  });
}

export function useAdvanceStage(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/stages/${stageId}/advance`, undefined, { schema: AdvancePreview }),
    onSuccess: (preview) => {
      invalidateStage(qc, stageId);
      invalidateStage(qc, preview.toStageId);
      void qc.invalidateQueries({ queryKey: keys.tournaments.all });
    },
  });
}

// ── Agenda, sala e check-in ──────────────────────────────────────────
export function useScheduleMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, ...input }: ScheduleMatchInput & { matchId: string }) => api.patch(`/matches/${matchId}`, input, { schema: Match }),
    onSuccess: (match) => {
      invalidateStage(qc, match.stageId, match.tournamentId);
      void qc.invalidateQueries({ queryKey: keys.matches.lobby(match.id) });
    },
  });
}

export function useScheduleRound(stageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduleRoundInput) => api.post(`/stages/${stageId}/schedule-round`, input, { schema: Matches }),
    onSuccess: () => invalidateStage(qc, stageId),
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (matchId: string) => api.post(`/matches/${matchId}/check-in`, undefined, { schema: Match }),
    onSuccess: (match) => {
      invalidateStage(qc, match.stageId, match.tournamentId);
      void qc.invalidateQueries({ queryKey: keys.tournaments.mine('participant') });
    },
  });
}

/** O staff inicia a partida manualmente (`live: true`) ou devolve para "agendada". */
export function useStartMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, live = true }: { matchId: string; live?: boolean }) => api.post(`/matches/${matchId}/start`, { live }, { schema: Match }),
    onSuccess: (match) => invalidateStage(qc, match.stageId, match.tournamentId),
  });
}

// ── Resultados ───────────────────────────────────────────────────────
function idempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Lança ou corrige o resultado de uma partida. Manda só estatísticas brutas: os pontos
 * voltam calculados pelo servidor. A chave de idempotência evita lançamento duplicado
 * quando a rede falha e a pessoa toca em "Salvar" de novo.
 */
export function useSubmitResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, key, ...input }: SubmitResultInput & { matchId: string; key?: string }) =>
      api.put(`/matches/${matchId}/result`, input, { schema: SubmitResultResponse, headers: { 'Idempotency-Key': key ?? idempotencyKey() } }),
    onSuccess: ({ match }) => invalidateStage(qc, match.stageId, match.tournamentId),
  });
}

export function useWalkover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, ...input }: { matchId: string; winnerRegistrationId: string; reason: string }) => api.post(`/matches/${matchId}/walkover`, input, { schema: Match }),
    onSuccess: (match) => invalidateStage(qc, match.stageId, match.tournamentId),
  });
}

/** Importação de resultados por CSV, um lote por chamada (até 50 partidas). */
export function useImportResults(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (results: { matchId: string; entries: SubmitResultInput['entries'] }[]) => api.post(`/tournaments/${tournamentId}/results/import`, { results }, { schema: ImportResultsResult }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bracket'] });
      void qc.invalidateQueries({ queryKey: ['standings'] });
      void qc.invalidateQueries({ queryKey: ['tournaments', 'matches', tournamentId] });
    },
  });
}

// ── Desistência, desclassificação e encerramento ─────────────────────
export function useWithdraw(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, ...input }: { registrationId: string; kind: 'WITHDRAWN' | 'DISQUALIFIED'; reason: string }) =>
      api.post(`/registrations/${registrationId}/withdraw`, input, { schema: Registration }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bracket'] });
      void qc.invalidateQueries({ queryKey: ['standings'] });
      void qc.invalidateQueries({ queryKey: ['tournaments', 'matches', tournamentId] });
      void qc.invalidateQueries({ queryKey: ['tournaments', 'registrations', tournamentId] });
      void qc.invalidateQueries({ queryKey: keys.tournaments.mine('participant') });
    },
  });
}

export function useFinishTournament(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FinishTournamentInput) => api.post(`/tournaments/${tournamentId}/finish`, input, { schema: Podium }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.tournaments.all }),
  });
}
