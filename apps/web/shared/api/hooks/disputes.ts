'use client';

/**
 * Hooks de envio de resultado pelo participante, validação do staff e disputas (F2.5).
 * O resultado só vira oficial no servidor (envio aprovado ou disputa resolvida); aqui as
 * mutações só invalidam o que pode ter mudado: a partida, a chave, a tabela e as filas.
 */
import {
  Dispute,
  ResultSubmission,
  type CreateSubmissionInput,
  type DisputeMessageInput,
  type OpenDisputeInput,
  type ResolveDisputeInput,
  type ReviewSubmissionInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useLiveRefetchInterval } from '../../realtime/RealtimeProvider';
import { api } from '../client';
import { keys } from '../keys';
import { stageIdOfMatch } from './competition';

const Submissions = z.array(ResultSubmission);
const SubmissionOrNull = ResultSubmission.nullable();
const Disputes = z.array(Dispute);

export type SubmissionQueueFilter = 'QUEUE' | 'ALL' | ResultSubmission['status'];

/** Chave do envio ativo de uma partida. Fica sob a chave da partida: o evento `match.updated` a invalida junto. */
export const matchSubmissionKey = (matchId: string) => [...keys.matches.detail(matchId), 'submission'] as const;

/** Tudo o que um envio, uma validação ou uma disputa pode mudar. */
function invalidateResultFlow(qc: QueryClient, matchId: string): void {
  const stageId = stageIdOfMatch(matchId);
  void qc.invalidateQueries({ queryKey: ['submissions'] });
  void qc.invalidateQueries({ queryKey: ['disputes'] });
  void qc.invalidateQueries({ queryKey: ['match'] });
  void qc.invalidateQueries({ queryKey: ['tournaments', 'matches'] });
  void qc.invalidateQueries({ queryKey: keys.stages.bracket(stageId) });
  void qc.invalidateQueries({ queryKey: keys.stages.standings(stageId) });
}

// ── Envio do participante ────────────────────────────────────────────
/** O envio ativo da partida (pendente, confirmado ou contestado) ou `null`. Só responde para os dois lados e o staff. */
export function useMatchSubmission(matchId: string | undefined, enabled = true) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: matchSubmissionKey(matchId ?? ''),
    queryFn: ({ signal }) => api.get(`/matches/${matchId}/submission`, { schema: SubmissionOrNull, signal }),
    enabled: Boolean(matchId) && enabled,
    refetchInterval,
  });
}

/** Um envio pelo ID (mesmo já encerrado), para a tela da disputa. */
export function useSubmission(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.matches.submissions({ id: id ?? '' }),
    queryFn: ({ signal }) => api.get(`/submissions/${id}`, { schema: ResultSubmission, signal }),
    enabled: Boolean(id),
  });
}

/** Envia o placar com print. Só quem joga a partida (jogador solo ou capitão), e só em duelos. */
export function useCreateSubmission(matchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSubmissionInput) => api.post(`/matches/${matchId}/submissions`, input, { schema: ResultSubmission }),
    onSuccess: (submission) => {
      qc.setQueryData(matchSubmissionKey(matchId), submission);
      invalidateResultFlow(qc, matchId);
    },
  });
}

/** O adversário confirma o placar enviado: vai para a validação da organização. */
export function useConfirmSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submissionId: string) => api.post(`/submissions/${submissionId}/confirm`, undefined, { schema: ResultSubmission }),
    onSuccess: (submission) => {
      qc.setQueryData(matchSubmissionKey(submission.matchId), submission);
      invalidateResultFlow(qc, submission.matchId);
    },
  });
}

/** O adversário contesta o placar enviado (motivo + prova obrigatória). Abre a disputa. */
export function useContestSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ submissionId, input }: { submissionId: string; input: OpenDisputeInput }) => api.post(`/submissions/${submissionId}/dispute`, input, { schema: Dispute }),
    onSuccess: (dispute) => {
      qc.setQueryData(keys.matches.dispute(dispute.id), dispute);
      invalidateResultFlow(qc, dispute.matchId);
    },
  });
}

// ── Validação do staff ───────────────────────────────────────────────
/** Fila "Resultados para validar" (padrão: confirmados + pendentes com prazo vencido). */
export function useTournamentSubmissions(tournamentId: string | undefined, status: SubmissionQueueFilter = 'QUEUE') {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.matches.submissions({ tournamentId: tournamentId ?? '', status }),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/submissions`, { schema: Submissions, signal, query: { status } }),
    enabled: Boolean(tournamentId),
    refetchInterval,
  });
}

/** Aprova (vira resultado oficial, com os pontos calculados pelo servidor) ou recusa (com motivo). */
export function useReviewSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ submissionId, input }: { submissionId: string; input: ReviewSubmissionInput }) => api.patch(`/submissions/${submissionId}`, input, { schema: ResultSubmission }),
    onSuccess: (submission) => invalidateResultFlow(qc, submission.matchId),
  });
}

// ── Disputas ─────────────────────────────────────────────────────────
export function useDispute(id: string | undefined) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.matches.dispute(id ?? ''),
    queryFn: ({ signal }) => api.get(`/disputes/${id}`, { schema: Dispute, signal }),
    enabled: Boolean(id),
    refetchInterval,
  });
}

/** Disputas do campeonato, para o staff. As abertas vêm primeiro. */
export function useTournamentDisputes(tournamentId: string | undefined, status?: Dispute['status']) {
  const refetchInterval = useLiveRefetchInterval();
  return useQuery({
    queryKey: keys.matches.disputes({ tournamentId: tournamentId ?? '', status: status ?? 'ALL' }),
    queryFn: ({ signal }) => api.get(`/tournaments/${tournamentId}/disputes`, { schema: Disputes, signal, query: { status } }),
    enabled: Boolean(tournamentId),
    refetchInterval,
  });
}

/** As disputas das partidas em que eu jogo. */
export function useMyDisputes(enabled = true) {
  return useQuery({
    queryKey: keys.matches.disputes({ scope: 'mine' }),
    queryFn: ({ signal }) => api.get('/me/disputes', { schema: Disputes, signal }),
    enabled,
  });
}

function useDisputeMutation<TInput>(disputeId: string, run: (input: TInput) => Promise<Dispute>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (dispute) => {
      qc.setQueryData(keys.matches.dispute(disputeId), dispute);
      invalidateResultFlow(qc, dispute.matchId);
    },
  });
}

/** Mensagem (com anexos opcionais) no histórico da disputa. Envolvidos e staff. */
export function useSendDisputeMessage(disputeId: string) {
  return useDisputeMutation(disputeId, (input: DisputeMessageInput) => api.post(`/disputes/${disputeId}/messages`, input, { schema: Dispute }));
}

/** O staff do campeonato passa a decisão para a administração. */
export function useEscalateDispute(disputeId: string) {
  return useDisputeMutation(disputeId, () => api.post(`/disputes/${disputeId}/escalate`, undefined, { schema: Dispute }));
}

/** Resolve a disputa; com `result`, lança o resultado correto. Escalada: só Admin. */
export function useResolveDispute(disputeId: string) {
  return useDisputeMutation(disputeId, (input: ResolveDisputeInput) => api.post(`/disputes/${disputeId}/resolve`, input, { schema: Dispute }));
}
