'use client';

import type { OrganizerTournamentDetail, TournamentDraftInput } from '@nova/schemas';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateTournament, useSaveTournament } from '@/shared/api/hooks/organizer';

export type SaveState = 'unsaved' | 'dirty' | 'saving' | 'saved' | 'error';

interface AutosaveOptions {
  /** Nulo enquanto o rascunho ainda não existe na API. */
  tournamentId: string | null;
  /** Corpo atual do rascunho, já no contrato da API. */
  payload: TournamentDraftInput;
  /** Modelo de origem, enviado só na criação. */
  templateId?: string;
  /** Só cria o rascunho quando há o mínimo (um nome válido). */
  canCreate: boolean;
  /** Rascunho automático ligado? (Campeonato publicado é salvo só quando a pessoa pede.) */
  auto: boolean;
  /** Chamado depois de cada gravação, com o campeonato devolvido pela API. Devolve o corpo já conciliado com a resposta. */
  onSaved: (tournament: OrganizerTournamentDetail, sent: TournamentDraftInput, created: boolean) => TournamentDraftInput | void;
  debounceMs?: number;
}

/**
 * Rascunho automático do assistente: grava com debounce durante a edição, na hora ao trocar de
 * passo (`flush`) e ao sair da tela. A primeira gravação cria o rascunho; as seguintes atualizam.
 */
export function useAutosave({ tournamentId, payload, templateId, canCreate, auto, onSaved, debounceMs = 1200 }: AutosaveOptions) {
  const create = useCreateTournament();
  const save = useSaveTournament({ silent: true });
  const json = JSON.stringify(payload);
  // O que está gravado na API. Ao abrir um rascunho existente, o que veio dele já está salvo.
  const [savedJson, setSavedJson] = useState<string | null>(() => (tournamentId ? json : null));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [failedJson, setFailedJson] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const latest = useRef({ tournamentId, payload, json, templateId, canCreate, onSaved, savedJson });
  useEffect(() => {
    latest.current = { tournamentId, payload, json, templateId, canCreate, onSaved, savedJson };
  });
  const inFlight = useRef<Promise<string | null> | null>(null);
  const lastError = useRef<unknown>(null);
  const createMutate = create.mutateAsync;
  const saveMutate = save.mutateAsync;

  /** Grava agora. Devolve o id do campeonato, ou nulo se não deu (ou se ainda não dá para criar). */
  const flush = useCallback(
    async (override?: TournamentDraftInput): Promise<string | null> => {
      // Uma gravação por vez: a seguinte espera a atual, para não gravar fora de ordem.
      if (inFlight.current) await inFlight.current.catch(() => null);
      const now = latest.current;
      const body = override ?? now.payload;
      const bodyJson = JSON.stringify(body);
      if (now.tournamentId && bodyJson === now.savedJson) return now.tournamentId;
      if (!now.tournamentId && !now.canCreate) return null;

      const run = (async () => {
        setSaving(true);
        try {
          const created = !now.tournamentId;
          const tournament = now.tournamentId ? await saveMutate({ id: now.tournamentId, input: body }) : await createMutate({ ...body, templateId: now.templateId });
          const reconciled = latest.current.onSaved(tournament, body, created);
          const reconciledJson = reconciled ? JSON.stringify(reconciled) : bodyJson;
          latest.current = { ...latest.current, tournamentId: tournament.id, savedJson: reconciledJson };
          setSavedJson(reconciledJson);
          setSavedAt(new Date().toISOString());
          setFailedJson(null);
          lastError.current = null;
          return tournament.id;
        } catch (error) {
          lastError.current = error;
          setFailedJson(bodyJson);
          return null;
        } finally {
          setSaving(false);
        }
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        if (inFlight.current === run) inFlight.current = null;
      }
    },
    [createMutate, saveMutate],
  );

  const dirty = json !== savedJson;
  const canSaveNow = tournamentId !== null || canCreate;

  // Debounce durante a edição. Depois de um erro, só tenta de novo quando algo mudar (ou no "Tentar de novo").
  useEffect(() => {
    if (!auto || !dirty || !canSaveNow || json === failedJson) return;
    const timer = setTimeout(() => void flush(), debounceMs);
    return () => clearTimeout(timer);
  }, [auto, dirty, canSaveNow, json, failedJson, flush, debounceMs]);

  // Saiu da tela com alteração pendente: grava o que falta.
  const autoRef = useRef(auto);
  useEffect(() => {
    autoRef.current = auto;
  });
  useEffect(
    () => () => {
      const now = latest.current;
      if (autoRef.current && now.json !== now.savedJson && (now.tournamentId || now.canCreate)) void flush();
    },
    [flush],
  );

  const state: SaveState = saving ? 'saving' : failedJson !== null && json === failedJson ? 'error' : !dirty ? (savedAt ? 'saved' : tournamentId ? 'saved' : 'unsaved') : canSaveNow ? 'dirty' : 'unsaved';
  return { state, savedAt, dirty, flush, retry: () => flush(), /** Erro da última gravação que falhou (para a tela mostrar o motivo). */ lastError };
}
