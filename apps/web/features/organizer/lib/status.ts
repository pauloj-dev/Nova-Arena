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

/** Transições do ciclo de vida que a área do organizador oferece nesta fase do produto (as demais chegam com a operação do campeonato). */
export type LifecycleAction = 'open-registration' | 'close-registration' | 'cancel';

export function lifecycleActions(status: TournamentStatus): LifecycleAction[] {
  if (status === 'DRAFT') return [];
  const next = TOURNAMENT_TRANSITIONS[status];
  const actions: LifecycleAction[] = [];
  if (next.includes('REGISTRATION_OPEN')) actions.push('open-registration');
  if (next.includes('REGISTRATION_CLOSED')) actions.push('close-registration');
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
      return 'As inscrições foram encerradas. O próximo passo é o check-in e a geração da chave.';
    case 'CHECK_IN':
      return 'Check-in aberto: os inscritos estão confirmando presença.';
    case 'IN_PROGRESS':
      return 'O campeonato está em andamento.';
    case 'PAUSED':
      return 'O campeonato está pausado.';
    case 'FINISHED':
      return 'Campeonato finalizado. Ele continua na vitrine para consulta.';
    case 'ARCHIVED':
      return 'Campeonato arquivado: saiu da vitrine e fica só para consulta.';
    case 'CANCELLED':
      return 'Campeonato cancelado.';
  }
}
