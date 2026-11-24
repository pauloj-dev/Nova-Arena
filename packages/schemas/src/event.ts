/**
 * Eventos (ADR-0005): um evento agrupa vários campeonatos de um organizador. A regra de participação, escolhida por
 * quem organiza, diz se cada jogador pode jogar um só campeonato do evento (`SINGLE`) ou vários (`MULTIPLE`).
 */
import { z } from 'zod';
import { Id, IsoDateTime, Slug } from './common';
import { EventParticipationRule, TournamentSummary } from './tournament';

export const Event = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  description: z.string(),
  bannerUrl: z.string().nullable(),
  participationRule: EventParticipationRule,
  owner: z.object({ id: Id, nickname: z.string() }),
  /** Campeonatos do evento que quem pede pode ver. */
  tournamentCount: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Event = z.infer<typeof Event>;

/** Evento com os campeonatos. Na página pública, só os publicados; para quem organiza, também os rascunhos. */
export const EventDetail = Event.extend({ tournaments: z.array(TournamentSummary) });
export type EventDetail = z.infer<typeof EventDetail>;

const eventName = z.string().trim().min(3, 'Use pelo menos 3 caracteres').max(80, 'Use no máximo 80 caracteres');
const eventDescription = z.string().trim().max(2000, 'Use no máximo 2000 caracteres');

export const EventInput = z.object({
  name: eventName,
  description: eventDescription.default(''),
  participationRule: EventParticipationRule.default('MULTIPLE'),
  bannerUrl: z.string().nullable().optional(),
});
export type EventInput = z.input<typeof EventInput>;

export const EventPatch = z
  .object({ name: eventName, description: eventDescription, participationRule: EventParticipationRule, bannerUrl: z.string().nullable() })
  .partial();
export type EventPatch = z.infer<typeof EventPatch>;

export const EventTournamentInput = z.object({ tournamentId: Id });
export type EventTournamentInput = z.infer<typeof EventTournamentInput>;

/** Outro campeonato do mesmo evento em que a pessoa já está (regra `SINGLE`). */
export const EventConflict = z.object({ tournamentId: Id, tournamentName: z.string(), slug: Slug, eventName: z.string() });
export type EventConflict = z.infer<typeof EventConflict>;
