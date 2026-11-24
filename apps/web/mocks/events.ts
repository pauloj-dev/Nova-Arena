/**
 * Regras dos eventos na API simulada (ADR-0005) — as mesmas de `packages/api/src/modules/events/rules.ts`.
 * A pessoa "está" num campeonato com inscrição ativa como solo ou como membro confirmado de um squad;
 * campeonato cancelado não conta.
 */
import { ACTIVE_REGISTRATION_STATUSES, type Event, type EventConflict, type EventDetail, type TournamentStatus } from '@nova/schemas';
import { db, type DbTournament, type DbUser } from './db';
import { eventsStore, type DbEvent } from './event-store';
import { conflict, forbidden, isAdmin, notFound } from './http';
import { findUser, toTournamentSummary } from './views';

export const EVENT_SINGLE_RULE = 'Neste evento cada jogador participa de um só campeonato.';
export const EVENT_EDITABLE_STATUSES: TournamentStatus[] = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const PUBLIC_HIDDEN: TournamentStatus[] = ['DRAFT', 'CANCELLED'];

export const isPublicTournament = (status: TournamentStatus) => !PUBLIC_HIDDEN.includes(status);

interface Participation {
  userId: string;
  tournament: DbTournament;
}

/** Participações das pessoas (todas, com `userIds` vazio) nos campeonatos do evento, fora `exceptTournamentId`. */
export function participationsInEvent(eventId: string, userIds: readonly string[], exceptTournamentId?: string): Participation[] {
  const d = db();
  const wanted = new Set(userIds);
  const out: Participation[] = [];
  for (const t of d.tournaments) {
    if (t.eventId !== eventId || t.id === exceptTournamentId || t.status === 'CANCELLED') continue;
    for (const r of d.registrations) {
      if (r.tournamentId !== t.id || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) continue;
      const people = [...(r.userId ? [r.userId] : []), ...r.members.filter((m) => m.confirmedAt !== null).map((m) => m.userId)];
      for (const userId of new Set(people)) if (wanted.size === 0 || wanted.has(userId)) out.push({ userId, tournament: t });
    }
  }
  return out;
}

function singleEventOf(t: DbTournament): DbEvent | null {
  if (!t.eventId) return null;
  const e = eventsStore().find((x) => x.id === t.eventId);
  return e?.participationRule === 'SINGLE' ? e : null;
}

export function eventConflictFor(t: DbTournament, userId: string): EventConflict | null {
  const event = singleEventOf(t);
  if (!event) return null;
  const first = participationsInEvent(event.id, [userId], t.id)[0];
  return first ? { tournamentId: first.tournament.id, tournamentName: first.tournament.name, slug: first.tournament.slug, eventName: event.name } : null;
}

/** 409 `EVENT_SINGLE_CHAMPIONSHIP` se alguma das pessoas já está em outro campeonato do evento `SINGLE`. */
export function assertEventExclusivity(t: DbTournament, userIds: readonly string[], viewerId?: string): void {
  const event = singleEventOf(t);
  if (!event || userIds.length === 0) return;
  const found = participationsInEvent(event.id, userIds, t.id);
  const first = found.find((p) => p.userId === viewerId) ?? found[0];
  if (!first) return;
  const who = first.userId === viewerId ? 'Você já está inscrito' : `${findUser(first.userId)?.nickname ?? 'Um jogador'} já está inscrito`;
  throw conflict(`${who} no campeonato ${first.tournament.name} deste evento. ${EVENT_SINGLE_RULE}`, 'EVENT_SINGLE_CHAMPIONSHIP');
}

export function playersInSeveralTournaments(eventId: string): number {
  const perUser = new Map<string, Set<string>>();
  for (const p of participationsInEvent(eventId, [])) perUser.set(p.userId, (perUser.get(p.userId) ?? new Set()).add(p.tournament.id));
  return [...perUser.values()].filter((s) => s.size > 1).length;
}

function participantsOf(tournamentId: string): string[] {
  const ids = new Set<string>();
  for (const r of db().registrations) {
    if (r.tournamentId !== tournamentId || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) continue;
    if (r.userId) ids.add(r.userId);
    for (const m of r.members) if (m.confirmedAt !== null) ids.add(m.userId);
  }
  return [...ids];
}

/** O campeonato pode entrar no evento (ou sair, com `eventId` nulo)? Mesmas regras da API real. */
export function assertEventAssignable(user: DbUser, t: DbTournament | null, eventId: string | null): void {
  if (t && (t.eventId ?? null) === eventId) return;
  if (t && !EVENT_EDITABLE_STATUSES.includes(t.status)) throw conflict('O campeonato já começou: ele não entra nem sai de um evento.', 'EVENT_LOCKED');
  if (eventId === null) return;
  const event = eventsStore().find((e) => e.id === eventId);
  if (!event) throw notFound('Evento');
  if (event.ownerId !== user.id && !isAdmin(user)) throw forbidden('Só quem organiza o evento pode colocar campeonatos nele.');
  if (!t || event.participationRule !== 'SINGLE') return;
  const ids = participantsOf(t.id);
  const clash = new Set(participationsInEvent(event.id, ids, t.id).map((p) => p.userId));
  if (clash.size === 0) return;
  const n = clash.size === 1 ? '1 jogador inscrito neste campeonato já está' : `${clash.size} jogadores inscritos neste campeonato já estão`;
  throw conflict(`${n} em outro campeonato do evento ${event.name}. ${EVENT_SINGLE_RULE}`, 'EVENT_SINGLE_CHAMPIONSHIP');
}

const all = () => true;

export function toEvent(e: DbEvent, visible: (status: TournamentStatus) => boolean = all): Event {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    description: e.description,
    bannerUrl: e.bannerUrl,
    participationRule: e.participationRule,
    owner: { id: e.ownerId, nickname: findUser(e.ownerId)?.nickname ?? 'Organizador' },
    tournamentCount: db().tournaments.filter((t) => t.eventId === e.id && visible(t.status)).length,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function toEventDetail(e: DbEvent, visible: (status: TournamentStatus) => boolean = all): EventDetail {
  const tournaments = db()
    .tournaments.filter((t) => t.eventId === e.id && visible(t.status))
    .sort((a, b) => (a.startsAt ?? '9999').localeCompare(b.startsAt ?? '9999') || a.name.localeCompare(b.name, 'pt-BR'));
  return { ...toEvent(e, visible), tournaments: tournaments.map(toTournamentSummary) };
}
