/** Agrupamento dos campeonatos por estado, para as abas de "Meus campeonatos" e o painel. */
import { ACTIVE_TOURNAMENT_STATUSES, TOURNAMENT_TRANSITIONS, type TournamentStatus } from '@nova/schemas';

export type StatusGroup = 'all' | 'draft' | 'active' | 'finished' | 'cancelled';

export const STATUS_GROUPS: { id: StatusGroup; label: string; statuses: TournamentStatus[] | null }[] = [
  { id: 'all', label: 'Todos', statuses: null },
  { id: 'draft', label: 'Rascunhos', statuses: ['DRAFT'] },
  { id: 'active', label: 'Ativos', statuses: ACTIVE_TOURNAMENT_STATUSES },
  { id: 'finished', label: 'Encerrados', statuses: ['FINISHED', 'ARCHIVED'] },
  { id: 'cancelled', label: 'Cancelados', statuses: ['CANCELLED'] },
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
  switch (status) {
    case 'DRAFT':
      return 'Ainda é um rascunho: só você e a sua equipe enxergam. Termine o assistente e publique.';
    case 'PUBLISHED':
      return 'Publicado e visível na vitrine. As inscrições abrem na data marcada — ou agora, se você quiser.';
    case 'REGISTRATION_OPEN':
      return 'As inscrições estão abertas. Elas fecham sozinhas no prazo, ou você pode encerrar antes.';
    case 'REGISTRATION_CLOSED':
      return 'As inscrições foram encerradas. O próximo passo é gerar a chave da primeira fase, na aba Fases e chave.';
    case 'CHECK_IN':
      return 'Check-in aberto: os inscritos estão confirmando presença.';
    case 'IN_PROGRESS':
      return 'O campeonato está em andamento. Agende as partidas e lance os resultados; a tabela se atualiza sozinha.';
    case 'PAUSED':
      return 'O campeonato está pausado: ninguém lança resultado até você retomar.';
    case 'FINISHED':
      return 'Campeonato finalizado, com pódio definido. Ele continua na vitrine para consulta até você arquivar.';
    case 'ARCHIVED':
      return 'Campeonato arquivado: saiu da vitrine e fica só para consulta.';
    case 'CANCELLED':
      return 'Campeonato cancelado.';
  }
}
