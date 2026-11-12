'use client';

import {
  ImportRegistrationsResult,
  OrganizerTournament,
  OrganizerTournamentDetail,
  Problem,
  ReviewRegistrationResult,
  ScoringModel,
  TournamentTemplate,
  type CancelTournamentInput,
  type CreateTournamentInput,
  type CustomScoringModelInput,
  type Game,
  type ImportRegistrationsInput,
  type ReviewRegistrationInput,
  type SaveTemplateInput,
  type TournamentDraftInput,
} from '@nova/schemas';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { API_BASE, api, ApiError } from '../client';
import { keys } from '../keys';

const OrganizerTournaments = z.array(OrganizerTournament);
const Templates = z.array(TournamentTemplate);

/** Detalhe do campeonato na área do organizador. Fica debaixo de `mine('organizer')`: invalidar a lista invalida os detalhes. */
export const organizerTournamentKey = (id: string) => [...keys.tournaments.mine('organizer'), id] as const;

/** Depois de mudar um campeonato, tudo o que lista ou mostra campeonatos pode estar velho (área do organizador e site). */
function invalidateTournaments(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: keys.tournaments.all });
}

// ── Leitura ──────────────────────────────────────────────────────────

/** Campeonatos em que sou responsável ou co-organizador. */
export function useOrganizerTournaments() {
  return useQuery({
    queryKey: keys.tournaments.mine('organizer'),
    queryFn: ({ signal }) => api.get('/organizer/tournaments', { schema: OrganizerTournaments, signal }),
  });
}

/** Detalhe para quem organiza. Dá 403 (`ApiError.status`) para quem não é da organização do campeonato. */
export function useOrganizerTournament(id: string | undefined) {
  return useQuery({
    queryKey: organizerTournamentKey(id ?? ''),
    queryFn: ({ signal }) => api.get(`/organizer/tournaments/${id}`, { schema: OrganizerTournamentDetail, signal }),
    enabled: Boolean(id),
  });
}

/** Modelos de campeonato: os da plataforma e os meus. */
export function useTournamentTemplates(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.tournaments.templates,
    queryFn: ({ signal }) => api.get('/tournament-templates', { schema: Templates, signal }),
    enabled: opts.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

// ── Rascunho ─────────────────────────────────────────────────────────

/** Cria o rascunho (opcionalmente a partir de um modelo). */
export function useCreateTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTournamentInput) => api.post('/tournaments', input, { schema: OrganizerTournamentDetail }),
    onSuccess: (t) => {
      qc.setQueryData(organizerTournamentKey(t.id), t);
      return qc.invalidateQueries({ queryKey: keys.tournaments.mine('organizer'), exact: true });
    },
  });
}

/**
 * Salva o rascunho ou a edição. Com `silent` (rascunho automático do assistente) só atualiza o cache
 * do próprio campeonato, sem refazer as consultas a cada tecla; sem `silent`, invalida as listas.
 */
export function useSaveTournament(opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  const { silent = false } = opts;
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TournamentDraftInput }) => api.patch(`/tournaments/${id}`, input, { schema: OrganizerTournamentDetail }),
    onSuccess: (t) => {
      qc.setQueryData(organizerTournamentKey(t.id), t);
      if (silent) return qc.invalidateQueries({ queryKey: keys.tournaments.mine('organizer'), exact: true, refetchType: 'none' });
      return invalidateTournaments(qc);
    },
  });
}

/** Exclui um rascunho. */
export function useDeleteTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tournaments/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: organizerTournamentKey(id) });
      return qc.invalidateQueries({ queryKey: keys.tournaments.mine('organizer'), exact: true });
    },
  });
}

// ── Ciclo de vida ────────────────────────────────────────────────────

function useLifecycle<TInput extends { id: string }>(path: (input: TInput) => string, bodyOf?: (input: TInput) => unknown) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => api.post(path(input), bodyOf?.(input), { schema: OrganizerTournamentDetail }),
    onSuccess: (t) => {
      qc.setQueryData(organizerTournamentKey(t.id), t);
      return invalidateTournaments(qc);
    },
  });
}

/** Publica o rascunho. A API valida o campeonato inteiro e os limites do organizador (RN-10). */
export function usePublishTournament() {
  return useLifecycle<{ id: string }>(({ id }) => `/tournaments/${id}/publish`);
}
export function useOpenRegistration() {
  return useLifecycle<{ id: string }>(({ id }) => `/tournaments/${id}/open-registration`);
}
export function useCloseRegistration() {
  return useLifecycle<{ id: string }>(({ id }) => `/tournaments/${id}/close-registration`);
}
/** Cancela o campeonato. O motivo é obrigatório. */
export function useCancelTournament() {
  return useLifecycle<{ id: string } & CancelTournamentInput>(({ id }) => `/tournaments/${id}/cancel`, ({ reason }) => ({ reason }));
}
/** Cria um rascunho novo copiando o campeonato. */
export function useDuplicateTournament() {
  return useLifecycle<{ id: string }>(({ id }) => `/tournaments/${id}/duplicate`);
}

// ── Modelos ──────────────────────────────────────────────────────────

/** Salva um campeonato meu como modelo. */
export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveTemplateInput) => api.post('/tournament-templates', input, { schema: TournamentTemplate }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.templates }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tournament-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tournaments.templates }),
  });
}

/** Cria (sem `id`) ou atualiza (com `id`) um modelo de pontuação personalizado, usado pela opção "personalizar" da fase. */
export function useSaveCustomScoringModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CustomScoringModelInput }) =>
      id ? api.put(`/organizer/scoring-models/${id}`, input, { schema: ScoringModel }) : api.post('/organizer/scoring-models', input, { schema: ScoringModel }),
    onSuccess: (model) => {
      // O modelo novo entra no catálogo em cache na hora: a fase que acabou de apontar para ele não fica "sem modelo" até a lista recarregar.
      // Debaixo de `games` há outras consultas (ranking…): só mexe no que tem cara de jogo.
      const withModel = <T,>(entry: T): T => {
        const game = entry as unknown as Partial<Game> | null;
        if (!game || game.id !== model.gameId || !Array.isArray(game.scoringModels)) return entry;
        return { ...game, scoringModels: [...game.scoringModels.filter((m) => m.id !== model.id), model] } as unknown as T;
      };
      qc.setQueriesData<unknown>({ queryKey: keys.games.all }, (data: unknown) => (Array.isArray(data) ? data.map(withModel) : withModel(data)));
      return qc.invalidateQueries({ queryKey: keys.games.all });
    },
  });
}

// ── Inscrições (issue #30) ───────────────────────────────────────────

function invalidateRegistrations(qc: QueryClient, tournamentId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.tournaments.registrations(tournamentId) }),
    qc.invalidateQueries({ queryKey: keys.tournaments.mine('organizer') }),
    qc.invalidateQueries({ queryKey: keys.tournaments.detail(tournamentId) }),
    qc.invalidateQueries({ queryKey: keys.tournaments.mine('participant') }),
  ]);
}

/** Aprovar, recusar, remover ou substituir uma inscrição. Devolve também quem subiu da lista de espera. */
export function useReviewRegistration(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ registrationId, input }: { registrationId: string; input: ReviewRegistrationInput }) =>
      api.patch(`/registrations/${registrationId}`, input, { schema: ReviewRegistrationResult }),
    onSettled: () => invalidateRegistrations(qc, tournamentId),
  });
}

/** Importa inscritos de uma planilha (linhas já lidas e conferidas no navegador). */
export function useImportRegistrations(tournamentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportRegistrationsInput) => api.post(`/tournaments/${tournamentId}/registrations/import`, input, { schema: ImportRegistrationsResult }),
    onSuccess: () => invalidateRegistrations(qc, tournamentId),
  });
}

/**
 * Baixa a exportação dos inscritos. O cliente único (`api`) só lê JSON; aqui a resposta é um arquivo
 * (`text/csv` com BOM), então a chamada é feita nesta camada e devolvida como `Blob`, sem tocar nos bytes.
 */
export async function fetchRegistrationsCsv(tournamentId: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_BASE}/tournaments/${tournamentId}/registrations.csv`, { credentials: 'same-origin', headers: { Accept: 'text/csv' } });
  if (!res.ok) {
    let problem: Problem = { type: 'about:blank', title: 'Não foi possível exportar os inscritos.', status: res.status };
    try {
      const parsed = Problem.safeParse(await res.json());
      if (parsed.success) problem = parsed.data;
    } catch {
      // Corpo vazio ou não-JSON: fica a mensagem genérica.
    }
    throw new ApiError(problem);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'inscritos.csv';
  return { blob: await res.blob(), filename };
}

export function useExportRegistrations(tournamentId: string) {
  return useMutation({ mutationFn: () => fetchRegistrationsCsv(tournamentId) });
}
