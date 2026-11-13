'use client';

import type { CheckInConfig, Registration } from '@nova/schemas';
import { createContext, useContext, type ReactNode } from 'react';

/**
 * Quem está olhando as partidas de um campeonato. É o que decide o que o `MatchCard` libera:
 * destaque do próprio lado, check-in, sala e ações de resultado.
 */
export interface MatchViewer {
  /** Usuário logado (nulo para visitante). */
  userId: string | null;
  /** A inscrição dele neste campeonato (nulo se não está inscrito). */
  registration: Registration | null;
  /** Regra de check-in do campeonato. Nulo quando a tela não tem o campeonato completo. */
  checkIn: Pick<CheckInConfig, 'requireAllMembers'> | null;
  /** Organização: vê a sala de qualquer partida. */
  isStaff?: boolean;
}

export const NO_VIEWER: MatchViewer = { userId: null, registration: null, checkIn: null };

const MatchViewerContext = createContext<MatchViewer>(NO_VIEWER);

/** Informe uma vez, em volta das abas de competição; chave, listas e cartões leem daqui. */
export function MatchViewerProvider({ value, children }: { value: MatchViewer; children: ReactNode }) {
  return <MatchViewerContext.Provider value={value}>{children}</MatchViewerContext.Provider>;
}

export function useMatchViewer(): MatchViewer {
  return useContext(MatchViewerContext);
}
