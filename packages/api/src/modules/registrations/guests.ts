/**
 * Inscrito avulso e elenco sem conta (RN-18): o que a organização monta à mão, sem depender de planilha nem de os
 * jogadores terem conta na plataforma.
 *
 * - `POST /tournaments/:id/registrations/manual`: um jogador ou squad sem conta, com as mesmas regras da
 *   importação por planilha (entra confirmado; sem vaga, vai para a lista de espera). Em campeonato por squad, já
 *   pode levar o elenco.
 * - `POST|PATCH|DELETE /registrations/:id/guests…`: o elenco de uma inscrição criada pela organização (importada
 *   ou avulsa). São só nomes e IDs no jogo: jogador sem conta não faz check-in nem recebe aviso.
 *
 * Só a organização (dono, co-organizador ou Admin; moderador não). O elenco segue o modo do campeonato (titulares
 * + reservas) e o mesmo ID no jogo não entra em dois squads do campeonato. Tudo na auditoria.
 */
import { audited, withAudit } from '@nova/db';
import {
  ACTIVE_REGISTRATION_STATUSES,
  canStaffEditRoster,
  GuestMemberInput,
  guestKey,
  guestRosterProblem,
  ManualRegistrationInput,
  Registration,
  RosterChangeResult,
  UpdateGuestMemberInput,
  type RegistrationStatus,
  type TournamentStatus,
} from '@nova/schemas';
import { Hono } from 'hono';
import { assertTournamentAccess } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, HttpProblem, notFound } from '../../errors';
import { revalidateTournaments } from '../../revalidate';
import { clientIp } from '../../security';
import { lockTournament, settleWaitlist, takenSlots, toRegistration, tournamentForRegistration, type TournamentForRegistration, type Tx } from './core';

/** Antes de a fase 1 começar: a organização ainda coloca inscritos. */
const BEFORE_START: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface GuestRow {
  name: string;
  gameId: string | null;
  isSub: boolean;
}

/** Elenco como vai para o banco: sem espaços nas pontas e com o ID vazio como "sem ID". */
export function normalizeGuests(members: GuestMemberInput[] | undefined): GuestRow[] {
  return (members ?? []).map((m) => ({ name: m.name.trim(), gameId: m.gameId?.trim() || null, isSub: m.isSub ?? false }));
}

/** Outro squad ativo do campeonato que já tem um destes IDs no jogo (um jogador não joga por dois squads). */
async function takenGameIdProblem(tx: Tx, tournamentId: string, guests: GuestRow[], exceptRegistrationId?: string): Promise<string | null> {
  const ids = guests.map((g) => g.gameId).filter((id): id is string => id !== null);
  if (ids.length === 0) return null;
  const taken = await tx.registrationGuest.findFirst({
    where: {
      tournamentId,
      gameId: { in: ids, mode: 'insensitive' },
      registration: { status: { in: ACTIVE_REGISTRATION_STATUSES } },
      ...(exceptRegistrationId ? { registrationId: { not: exceptRegistrationId } } : {}),
    },
    select: { gameId: true, registration: { select: { displayName: true } } },
  });
  if (!taken) return null;
  return `O ID no jogo "${taken.gameId ?? ''}" já está no elenco do ${taken.registration.displayName ?? 'outro squad'} neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.`;
}

/**
 * Confere o elenco inteiro de uma inscrição criada pela organização: o modo do campeonato (titulares e reservas),
 * nomes e IDs repetidos e o mesmo ID em outro squad. Devolve a mensagem do problema, ou `null`.
 */
export async function guestsProblem(tx: Tx, t: TournamentForRegistration, guests: GuestRow[], exceptRegistrationId?: string): Promise<string | null> {
  if (guests.length === 0) return null;
  if (t.participantType !== 'TEAM') return 'Este campeonato é individual: o inscrito não tem elenco.';
  return guestRosterProblem(guests, t.gameMode) ?? (await takenGameIdProblem(tx, t.id, guests, exceptRegistrationId));
}

/** Cria a inscrição sem conta (planilha ou cadastro manual) com o elenco, se vier. Devolve o id. */
export async function createStaffRegistration(
  tx: Tx,
  t: TournamentForRegistration,
  row: { name: string; tag?: string | undefined; contact?: string | undefined; gameId?: string | undefined },
  guests: GuestRow[],
  opts: { status: RegistrationStatus; createdAt: Date },
): Promise<string> {
  const created = await tx.registration.create({
    data: {
      tournamentId: t.id,
      displayName: row.name.trim(),
      tag: row.tag?.trim() ? row.tag.trim().toUpperCase() : null,
      importedContact: row.contact?.trim() || null,
      importedGameId: row.gameId?.trim() || null,
      status: opts.status,
      createdAt: opts.createdAt,
      ...(guests.length > 0 ? { guests: { create: guests.map((g, i) => ({ ...g, tournamentId: t.id, createdAt: new Date(opts.createdAt.getTime() + i) })) } } : {}),
    },
    select: { id: true },
  });
  return created.id;
}

async function auditCtx(c: AppContext) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

export const guests = new Hono<AppEnv>();

// ── Inscrito avulso ──────────────────────────────────────────────────
guests.post('/tournaments/:id/registrations/manual', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const tView = isUuid(id) ? await db.tournament.findUnique({ where: { id }, include: tournamentForRegistration }) : null;
  if (!tView) throw notFound('Campeonato');
  await assertTournamentAccess(c, tView.id, 'manage');
  const input = await body(c, ManualRegistrationInput);
  if (!BEFORE_START.includes(tView.status)) {
    throw conflict(tView.status === 'DRAFT' ? 'Publique o campeonato antes de adicionar inscritos.' : 'Só dá para adicionar inscritos antes de o campeonato começar.', 'REGISTRATIONS_LOCKED');
  }
  const roster = normalizeGuests(input.members);
  const now = c.get('deps').now();
  const createdId = await withAudit(db, await auditCtx(c), async (tx) => {
    const t = await lockTournament(tx, tView.id);
    await settleWaitlist(tx, t, now);
    const active = await tx.registration.findMany({ where: { tournamentId: t.id, status: { in: ACTIVE_REGISTRATION_STATUSES } }, select: { displayName: true, team: { select: { name: true } }, user: { select: { nickname: true } } } });
    if (active.some((r) => guestKey(r.displayName ?? r.team?.name ?? r.user?.nickname ?? '') === guestKey(input.name))) {
      const message = `Já existe um inscrito chamado "${input.name}" neste campeonato.`;
      throw new HttpProblem(409, message, 'NAME_TAKEN', { name: message });
    }
    const problem = await guestsProblem(tx, t, roster);
    if (problem) throw badRequest(problem, 'INVALID_ROSTER', { members: problem });
    const hasSlot = (await takenSlots(tx, t.id)) < t.maxParticipants;
    if (!hasSlot && !t.waitlistEnabled) throw conflict('As vagas acabaram e a lista de espera está desligada.', 'TOURNAMENT_FULL');
    const status: RegistrationStatus = hasSlot ? 'CONFIRMED' : 'WAITLIST';
    const registrationId = await createStaffRegistration(tx, t, input, roster, { status, createdAt: now });
    await audited(tx, { action: 'REGISTRATION_ADDED', entityType: 'Registration', entityId: registrationId, entityLabel: `${t.name} · ${input.name}`, tournamentId: t.id, after: { status, jogadores: roster.length } });
    return registrationId;
  });
  revalidateTournaments(c);
  return respond(c, Registration, await toRegistration(db, tView, createdId, { guestIds: true }), 201);
});

// ── Elenco sem conta ─────────────────────────────────────────────────

/** A inscrição e o campeonato, com a organização conferida (moderador não mexe no elenco). */
async function staffRegistration(c: AppContext, registrationId: string) {
  const db = c.get('deps').db();
  const r = isUuid(registrationId) ? await db.registration.findUnique({ where: { id: registrationId }, include: { tournament: { include: tournamentForRegistration } } }) : null;
  if (!r) throw notFound('Inscrição');
  await assertTournamentAccess(c, r.tournamentId, 'manage');
  return r;
}

/** Dentro da transação com a trava: a inscrição com o elenco atual, já conferido que ele pode mudar. */
async function lockedRoster(tx: Tx, t: TournamentForRegistration, registrationId: string) {
  const r = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, include: { guests: { orderBy: [{ isSub: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] } } });
  if (r.userId || r.teamId) throw conflict('Esta inscrição é de quem tem conta na plataforma: o elenco dela é escalado pelo apelido dos jogadores.', 'NOT_STAFF_REGISTRATION');
  if (t.participantType !== 'TEAM') throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
  if (!ACTIVE_REGISTRATION_STATUSES.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (!canStaffEditRoster(t.status)) throw conflict('Este campeonato já terminou: o elenco não muda mais.', 'ROSTER_CLOSED');
  return r;
}

async function respondRoster(c: AppContext, t: TournamentForRegistration, registrationId: string, status: 200 | 201 = 200) {
  revalidateTournaments(c);
  return respond(c, RosterChangeResult, { registrations: [await toRegistration(c.get('deps').db(), t, registrationId, { guestIds: true })] }, status);
}

guests.post('/registrations/:id/guests', async (c) => {
  const head = await staffRegistration(c, c.req.param('id'));
  const [guest] = normalizeGuests([await body(c, GuestMemberInput)]) as [GuestRow];
  await withAudit(c.get('deps').db(), await auditCtx(c), async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    const r = await lockedRoster(tx, t, head.id);
    const problem = guestRosterProblem([...r.guests, guest], t.gameMode) ?? (await guestsProblem(tx, t, [guest], r.id));
    if (problem) throw new HttpProblem(409, problem, 'INVALID_ROSTER', { name: problem });
    await tx.registrationGuest.create({ data: { ...guest, registrationId: r.id, tournamentId: t.id } });
    await audited(tx, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${r.displayName ?? 'squad'}`, tournamentId: t.id, after: { escalou: guest.name, semConta: true } });
  });
  return respondRoster(c, head.tournament, head.id, 201);
});

guests.patch('/registrations/:id/guests/:guestId', async (c) => {
  const head = await staffRegistration(c, c.req.param('id'));
  const guestId = c.req.param('guestId');
  const input = await body(c, UpdateGuestMemberInput);
  await withAudit(c.get('deps').db(), await auditCtx(c), async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    const r = await lockedRoster(tx, t, head.id);
    const current = r.guests.find((g) => g.id === guestId);
    if (!current) throw notFound('Jogador no elenco');
    const next: GuestRow = {
      name: input.name ?? current.name,
      gameId: input.gameId === undefined ? current.gameId : input.gameId?.trim() || null,
      isSub: input.isSub ?? current.isSub,
    };
    const problem = guestRosterProblem(r.guests.map((g) => (g.id === guestId ? next : g)), t.gameMode) ?? (await guestsProblem(tx, t, [next], r.id));
    if (problem) throw new HttpProblem(409, problem, 'INVALID_ROSTER', { name: problem });
    await tx.registrationGuest.update({ where: { id: guestId }, data: next });
    await audited(tx, {
      action: 'ROSTER_CHANGED',
      entityType: 'Registration',
      entityId: r.id,
      entityLabel: `${t.name} · ${r.displayName ?? 'squad'}`,
      tournamentId: t.id,
      before: { nome: current.name, reserva: current.isSub },
      after: { corrigiu: next.name, reserva: next.isSub, semConta: true },
    });
  });
  return respondRoster(c, head.tournament, head.id);
});

guests.delete('/registrations/:id/guests/:guestId', async (c) => {
  const head = await staffRegistration(c, c.req.param('id'));
  const guestId = c.req.param('guestId');
  await withAudit(c.get('deps').db(), await auditCtx(c), async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    const r = await lockedRoster(tx, t, head.id);
    const current = r.guests.find((g) => g.id === guestId);
    if (!current) throw notFound('Jogador no elenco');
    await tx.registrationGuest.delete({ where: { id: guestId } });
    await audited(tx, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${r.displayName ?? 'squad'}`, tournamentId: t.id, after: { tirou: current.name, semConta: true } });
  });
  return respondRoster(c, head.tournament, head.id);
});
