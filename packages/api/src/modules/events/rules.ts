/**
 * Regra de participação dos eventos (ADR-0005).
 *
 * Num evento `SINGLE`, cada jogador participa de um só campeonato. A pessoa "está" num campeonato quando tem uma
 * inscrição ativa (`ACTIVE_REGISTRATION_STATUSES`) como inscrita solo ou como membro **confirmado** do elenco de um
 * squad. Membro convocado que ainda não confirmou não conta: ele só passa a ocupar o lugar quando confirma, e é aí
 * que a regra é conferida de novo. Campeonato cancelado não conta.
 *
 * Concorrência: quem confere a regra dentro de uma transação trava a linha do evento (`FOR UPDATE`) depois da do
 * campeonato. Duas inscrições ao mesmo tempo em campeonatos diferentes do mesmo evento esperam uma pela outra.
 */
import type { Prisma, PrismaClient } from '@nova/db';
import { ACTIVE_REGISTRATION_STATUSES, type EventConflict, type TournamentStatus } from '@nova/schemas';
import type { AppContext } from '../../context';
import { conflict, forbidden, notFound } from '../../errors';
import { currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Db = PrismaClient | Prisma.TransactionClient;

/** Campeonato em que a pessoa já está, dentro do evento. */
export interface EventParticipation {
  userId: string;
  nickname: string;
  tournamentId: string;
  tournamentName: string;
  slug: string;
}

export const EVENT_SINGLE_RULE = 'Neste evento cada jogador participa de um só campeonato.';

const tournamentRef = { select: { id: true, name: true, slug: true } } as const;

/**
 * Participações das pessoas em campeonatos do evento (fora `exceptTournamentId`). Uma linha por pessoa e campeonato.
 */
export async function participationsInEvent(db: Db, eventId: string, userIds: readonly string[], exceptTournamentId?: string): Promise<EventParticipation[]> {
  const ids = [...new Set(userIds)];
  const scope: Prisma.RegistrationWhereInput = {
    status: { in: ACTIVE_REGISTRATION_STATUSES },
    tournament: { eventId, status: { not: 'CANCELLED' } },
    ...(exceptTournamentId ? { tournamentId: { not: exceptTournamentId } } : {}),
  };
  // Em sequência: dentro de uma transação, as consultas dividem a mesma conexão.
  const solo = await db.registration.findMany({
    where: { ...scope, ...(ids.length > 0 ? { userId: { in: ids } } : { userId: { not: null } }) },
    select: { userId: true, user: { select: { nickname: true } }, tournament: tournamentRef },
  });
  const members = await db.registrationMember.findMany({
    where: { ...(ids.length > 0 ? { userId: { in: ids } } : {}), confirmedAt: { not: null }, registration: scope },
    select: { userId: true, user: { select: { nickname: true } }, registration: { select: { tournament: tournamentRef } } },
  });
  const out = new Map<string, EventParticipation>();
  const add = (userId: string, nickname: string, t: { id: string; name: string; slug: string }) =>
    out.set(`${userId}:${t.id}`, { userId, nickname, tournamentId: t.id, tournamentName: t.name, slug: t.slug });
  for (const r of solo) if (r.userId) add(r.userId, r.user?.nickname ?? 'Jogador', r.tournament);
  for (const m of members) add(m.userId, m.user.nickname, m.registration.tournament);
  return [...out.values()];
}

/** Evento `SINGLE` do campeonato (ou nulo, quando o campeonato é avulso ou o evento aceita vários). */
async function singleEventOf(db: Db, tournamentId: string): Promise<{ id: string; name: string } | null> {
  const t = await db.tournament.findUnique({ where: { id: tournamentId }, select: { event: { select: { id: true, name: true, participationRule: true } } } });
  return t?.event?.participationRule === 'SINGLE' ? { id: t.event.id, name: t.event.name } : null;
}

/**
 * Outro campeonato do mesmo evento em que a pessoa já está, para avisar antes do clique
 * (`GET /tournaments/:id/registration-eligibility`). Nulo quando a regra não impede.
 */
export async function eventConflictFor(db: Db, tournamentId: string, userId: string): Promise<EventConflict | null> {
  const event = await singleEventOf(db, tournamentId);
  if (!event) return null;
  const [first] = await participationsInEvent(db, event.id, [userId], tournamentId);
  return first ? { tournamentId: first.tournamentId, tournamentName: first.tournamentName, slug: first.slug, eventName: event.name } : null;
}

/**
 * Garante a regra `SINGLE`: nenhuma das pessoas pode estar em outro campeonato do evento. Lança 409
 * `EVENT_SINGLE_CHAMPIONSHIP` com o nome do outro campeonato (e do jogador, quando não é quem pediu).
 * Sem efeito em campeonato avulso ou em evento `MULTIPLE`. Dentro de uma transação, trava a linha do evento.
 *
 * @param viewerId quem fez a requisição: a mensagem fala com ele na 2ª pessoa ("Você já está inscrito…").
 */
export async function assertEventExclusivity(db: Db, tournamentId: string, userIds: readonly string[], viewerId?: string): Promise<void> {
  if (userIds.length === 0) return;
  const event = await singleEventOf(db, tournamentId);
  if (!event) return;
  await db.$queryRaw`SELECT id FROM events WHERE id = ${event.id}::uuid FOR UPDATE`;
  const found = await participationsInEvent(db, event.id, userIds, tournamentId);
  if (found.length === 0) return;
  // Quem pediu vem primeiro: a mensagem fala com ele.
  const first = found.find((p) => p.userId === viewerId) ?? (found[0] as EventParticipation);
  const who = first.userId === viewerId ? 'Você já está inscrito' : `${first.nickname} já está inscrito`;
  throw conflict(`${who} no campeonato ${first.tournamentName} deste evento. ${EVENT_SINGLE_RULE}`, 'EVENT_SINGLE_CHAMPIONSHIP');
}

/** Quantas pessoas estão em dois ou mais campeonatos do evento (impede trocar a regra para `SINGLE`). */
export async function playersInSeveralTournaments(db: Db, eventId: string): Promise<number> {
  const all = await participationsInEvent(db, eventId, []);
  const perUser = new Map<string, Set<string>>();
  for (const p of all) perUser.set(p.userId, (perUser.get(p.userId) ?? new Set()).add(p.tournamentId));
  return [...perUser.values()].filter((s) => s.size > 1).length;
}

/** Quem está no campeonato (solo ou membro confirmado de um squad, com inscrição ativa). */
export async function participantsOf(db: Db, tournamentId: string): Promise<string[]> {
  const solo = await db.registration.findMany({ where: { tournamentId, status: { in: ACTIVE_REGISTRATION_STATUSES }, userId: { not: null } }, select: { userId: true } });
  const members = await db.registrationMember.findMany({ where: { tournamentId, confirmedAt: { not: null }, registration: { status: { in: ACTIVE_REGISTRATION_STATUSES } } }, select: { userId: true } });
  return [...new Set([...solo.flatMap((r) => (r.userId ? [r.userId] : [])), ...members.map((m) => m.userId)])];
}

/**
 * Colocar um campeonato num evento `SINGLE` não pode deixar ninguém em dois campeonatos do evento. Lança 409
 * `EVENT_SINGLE_CHAMPIONSHIP` dizendo quantos jogadores já estão em outro campeonato do evento.
 */
export async function assertCanJoinSingleEvent(db: Db, tournamentId: string, event: { id: string; name: string; participationRule: string }): Promise<void> {
  if (event.participationRule !== 'SINGLE') return;
  const ids = await participantsOf(db, tournamentId);
  if (ids.length === 0) return;
  const clash = new Set((await participationsInEvent(db, event.id, ids, tournamentId)).map((p) => p.userId));
  if (clash.size === 0) return;
  const n = clash.size === 1 ? '1 jogador inscrito neste campeonato já está' : `${clash.size} jogadores inscritos neste campeonato já estão`;
  throw conflict(`${n} em outro campeonato do evento ${event.name}. ${EVENT_SINGLE_RULE}`, 'EVENT_SINGLE_CHAMPIONSHIP');
}

/** O campeonato entra ou sai de um evento até começar: depois disso, a regra de participação já valeu. */
export const EVENT_EDITABLE_STATUSES: TournamentStatus[] = ['DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];

/**
 * Confere se o campeonato pode entrar no evento (ou sair, com `eventId` nulo): quem pede é dono do evento ou Admin,
 * o campeonato ainda não começou e, se o evento é `SINGLE`, ninguém fica em dois campeonatos dele.
 * Usado pelo assistente (`POST /tournaments`, `PATCH /tournaments/:id`) e por `POST /organizer/events/:id/tournaments`.
 */
export async function assertEventAssignable(c: AppContext, db: Db, t: { id: string; status: TournamentStatus; eventId: string | null } | null, eventId: string | null): Promise<void> {
  if (t && t.eventId === eventId) return;
  if (t && !EVENT_EDITABLE_STATUSES.includes(t.status)) throw conflict('O campeonato já começou: ele não entra nem sai de um evento.', 'EVENT_LOCKED');
  if (eventId === null) return;
  const event = isUuid(eventId) ? await db.event.findUnique({ where: { id: eventId }, select: { id: true, name: true, ownerId: true, participationRule: true } }) : null;
  if (!event) throw notFound('Evento');
  const session = await requireSession(c);
  if (event.ownerId !== session.userId && !isAdmin(await currentRoles(c))) throw forbidden('Só quem organiza o evento pode colocar campeonatos nele.');
  if (t) await assertCanJoinSingleEvent(db, t.id, event);
}
