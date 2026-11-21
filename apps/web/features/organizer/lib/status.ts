/** Agrupamento dos campeonatos por estado, para as abas de "Meus campeonatos" e o painel. */
import { ACTIVE_TOURNAMENT_STATUSES, TOURNAMENT_TRANSITIONS, type TournamentStatus } from '@nova/schemas';
import { getT } from '@/shared/i18n/core';
import { messages } from '../messages';

export type StatusGroup = 'all' | 'draft' | 'active' | 'finished' | 'cancelled';

function group(id: StatusGroup, statuses: TournamentStatus[] | null): { id: StatusGroup; readonly label: string; statuses: TournamentStatus[] | null } {
  return {
    id,
    // O rótulo é lido do catálogo na hora em que é usado (não no carregamento do módulo).
    get label() {
      return getT(messages, 'status.grupos')(id);
    },
    statuses,
  };
}

export const STATUS_GROUPS: { id: StatusGroup; readonly label: string; statuses: TournamentStatus[] | null }[] = [
  group('all', null),
  group('draft', ['DRAFT']),
  group('active', ACTIVE_TOURNAMENT_STATUSES),
  group('finished', ['FINISHED', 'ARCHIVED']),
  group('cancelled', ['CANCELLED']),
];

export function inGroup(status: TournamentStatus, group: StatusGroup): boolean {
  const statuses = STATUS_GROUPS.find((g) => g.id === group)?.statuses;
  return !statuses || statuses.includes(status);
}

export const isActive = (status: TournamentStatus) => ACTIVE_TOURNAMENT_STATUSES.includes(status);
export const isReadOnly = (status: TournamentStatus) => status === 'FINISHED' || status === 'ARCHIVED' || status === 'CANCELLED';

/**
 * Ações do ciclo de vida (PRD §8.3) que a área do organizador oferece em cada estado.
 * Só aparece o que a máquina de estados (`TOURNAMENT_TRANSITIONS`) permite a partir dali:
 * - `start`: gerar e confirmar a chave da fase 1 (é o que põe o campeonato em andamento);
 * - `finish`: encerrar com pódio (a API ainda exige a última fase concluída).
 */
export type LifecycleAction = 'open-registration' | 'close-registration' | 'start' | 'pause' | 'resume' | 'finish' | 'archive' | 'cancel';

export function lifecycleActions(status: TournamentStatus): LifecycleAction[] {
  if (status === 'DRAFT') return [];
  const next = TOURNAMENT_TRANSITIONS[status];
  const actions: LifecycleAction[] = [];
  if (next.includes('REGISTRATION_OPEN')) actions.push('open-registration');
  if (next.includes('REGISTRATION_CLOSED')) actions.push('close-registration');
  if (next.includes('IN_PROGRESS')) actions.push(status === 'PAUSED' ? 'resume' : 'start');
  if (next.includes('PAUSED')) actions.push('pause');
  if (next.includes('FINISHED')) actions.push('finish');
  if (next.includes('ARCHIVED')) actions.push('archive');
  if (next.includes('CANCELLED')) actions.push('cancel');
  return actions;
}

/** Uma frase que explica o estado atual para quem organiza. */
export function statusExplanation(status: TournamentStatus): string {
  return getT(messages, 'status.explicacao')(status);
}
