/**
 * Coleção de eventos da API simulada (ADR-0005), separada das regras (`events.ts`) para `views.ts` poder montar a
 * referência do evento na página do campeonato sem importar as regras.
 */
import type { EventParticipationRule, TournamentEventRef } from '@nova/schemas';
import { collection, db, type DbTournament } from './db';

export interface DbEvent {
  id: string;
  slug: string;
  name: string;
  description: string;
  bannerUrl: string | null;
  ownerId: string;
  participationRule: EventParticipationRule;
  createdAt: string;
  updatedAt: string;
}

/**
 * Evento de demonstração: o Festival Free Fire da Camila (Copa Nova FF Squad + FF Solo Rush), um só campeonato por
 * jogador. Função pura: a seed da API real (`scripts/seed-demo.ts`) grava o mesmo evento.
 */
export function demoEvents(tournaments: readonly DbTournament[]): DbEvent[] {
  const squad = tournaments.find((t) => t.slug === 'copa-nova-ff-squad');
  const solo = tournaments.find((t) => t.slug === 'ff-solo-rush');
  if (!squad || !solo) return [];
  // Os dois campeonatos já vêm com `eventId: 'ev_festival_ff'` da seed.
  return [
    {
      id: 'ev_festival_ff',
      slug: 'festival-free-fire',
      name: 'Festival Free Fire',
      description: 'Um fim de semana de Free Fire: escolha a sua modalidade, em squad ou solo.',
      bannerUrl: null,
      ownerId: squad.ownerId,
      participationRule: 'SINGLE',
      createdAt: squad.createdAt,
      updatedAt: squad.createdAt,
    },
  ];
}

export const eventsStore = () => collection<DbEvent>('events', () => demoEvents(db().tournaments));

/** Referência do evento para a página do campeonato. */
export function eventRefOf(t: DbTournament): TournamentEventRef | null {
  if (!t.eventId) return null;
  const e = eventsStore().find((x) => x.id === t.eventId);
  return e ? { id: e.id, slug: e.slug, name: e.name, participationRule: e.participationRule } : null;
}
