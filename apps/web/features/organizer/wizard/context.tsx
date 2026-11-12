'use client';

import type { Game, GameMode } from '@nova/schemas';
import { createContext, useContext } from 'react';
import type { WizardValues } from '../lib/draft';
import type { DraftIssue } from '../validation';

export interface WizardContextValue {
  values: WizardValues;
  /** Jogos que esta conta pode escolher (ativos e liberados). */
  selectableGames: Game[];
  game: Game | null;
  mode: GameMode | null;
  userId: string;
  issues: DraftIssue[];
  /** Erro do campo: o do formulário (contrato da API) ou a pendência do passo, depois que a pessoa tentou continuar. */
  fieldError: (field: string) => string | undefined;
  /** Campeonato já publicado: jogo e modo travados e fases iniciadas só para leitura. */
  isPublished: boolean;
  /** Em andamento: vagas e datas não mudam mais. */
  hasStarted: boolean;
  lockedStageIds: string[];
  takenSlots: number;
  goToStep: (step: number) => void;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard precisa estar dentro do assistente de criação.');
  return ctx;
}
