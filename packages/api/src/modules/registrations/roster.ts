/**
 * Elenco da inscrição de squad (PRD §12.1, "trava de elenco") e os avisos do fluxo de inscrição (PRD §12.2).
 *
 * - O capitão escala e tira membros do squad até a trava de elenco (`rosterLockAt`); depois só a organização.
 * - A organização (dono, co-organizador ou Admin; moderador não) escala qualquer jogador, tira e remaneja entre
 *   squads até o fim do campeonato. O que ela faz entra na auditoria e o jogador é avisado.
 * - Quem entra num squad pelo convite entra também no elenco das inscrições que esperam jogadores
 *   (`joinOpenRosters`): o squad que perdeu alguém completa sem passo extra.
 * - Antes de o campeonato começar, a troca recalcula o status (`statusAfterRosterChange`); depois, não.
 *
 * Toda troca roda na transação com a trava do campeonato (`lockTournament`), como as inscrições.
 */
import { audited, withAudit, type Prisma } from '@nova/db';
import {
  ACTIVE_REGISTRATION_STATUSES,
  AddRosterMemberInput,
  canCaptainEditRoster,
  canStaffEditRoster,
  MoveRosterMemberInput,
  rosterLimit,
  rosterNeedsPlayers,
  RosterChangeResult,
  statusAfterRosterChange,
  type RosterJoin,
  type TournamentStatus,
} from '@nova/schemas';
import { Hono } from 'hono';
import { assertTournamentAccess } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { messages } from '../../messages/pt-BR';
import { notify } from '../../notify';
import { revalidateTournaments } from '../../revalidate';
import { clientIp } from '../../security';
import { LOCKED_TX, lockTournament, registrationInclude, toRegistrations, tournamentForRegistration, type TournamentForRegistration, type Tx } from './core';

/** Estados em que a troca no elenco ainda mexe no status da inscrição (antes de o campeonato começar). */
const CONFIRMATION_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ── Elegibilidade ────────────────────────────────────────────────────

/**
 * Ponto único que decide se estas pessoas podem entrar no elenco de um squad neste campeonato (além da
 * exclusividade por campeonato, que o banco garante). Toda entrada no elenco passa por aqui: escalação pelo
 * capitão ou pela organização, remanejamento e a entrada pelo convite do squad.
 */
export async function assertRosterEligibility(tx: Tx, t: { id: string; ownerId: string }, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, nickname: true, status: true } });
  const nick = (id: string) => users.find((u) => u.id === id)?.nickname ?? 'Este jogador';
  const inactive = users.find((u) => u.status !== 'ACTIVE');
  if (inactive || users.length < new Set(userIds).size) {
    throw conflict(`${inactive?.nickname ?? 'Este jogador'} está com a conta suspensa, banida ou excluída e não pode jogar.`, 'USER_NOT_ACTIVE');
  }
  // PRD §6, nota ³: quem organiza não joga o próprio campeonato.
  const staff = userIds.includes(t.ownerId) ? t.ownerId : (await tx.tournamentStaff.findFirst({ where: { tournamentId: t.id, userId: { in: userIds } }, select: { userId: true } }))?.userId;
  if (staff) throw conflict(`${nick(staff)} faz parte da organização deste campeonato e não pode jogar nele.`, 'PLAYER_IS_STAFF');
}

// ── Avisos ───────────────────────────────────────────────────────────

/** "Inscrição confirmada" para quem tem vaga garantida (solo: o inscrito; squad: o elenco). Chame depois do commit. */
export async function notifyConfirmed(c: AppContext, registrationIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(registrationIds)];
  if (ids.length === 0) return;
  const rows = await c
    .get('deps')
    .db()
    .registration.findMany({
      where: { id: { in: ids }, status: 'CONFIRMED' },
      select: { userId: true, displayName: true, team: { select: { name: true } }, members: { select: { userId: true } }, tournament: { select: { name: true, slug: true } } },
    });
  for (const r of rows) {
    const link = `/c/${r.tournament.slug}`;
    if (r.userId) {
      await notify(c, [r.userId], { type: 'REGISTRATION_CONFIRMED', title: messages.registrations.confirmedSolo.title, body: messages.registrations.confirmedSolo.body(r.tournament.name), link });
    } else if (r.members.length > 0) {
      const team = r.team?.name ?? r.displayName ?? 'squad';
      await notify(c, r.members.map((m) => m.userId), { type: 'REGISTRATION_CONFIRMED', title: messages.registrations.confirmedTeam.title, body: messages.registrations.confirmedTeam.body(team, r.tournament.name), link });
    }
  }
}

/** "Confirme sua participação" para quem está no elenco e ainda não confirmou (PRD §12.2). Chame depois do commit. */
export async function notifyToConfirm(c: AppContext, registrationId: string, userIds?: string[]): Promise<void> {
  const r = await c
    .get('deps')
    .db()
    .registration.findUnique({
      where: { id: registrationId },
      select: { status: true, displayName: true, team: { select: { name: true, captainId: true } }, members: { where: { confirmedAt: null }, select: { userId: true } }, tournament: { select: { name: true, slug: true } } },
    });
  if (!r?.team || !ACTIVE_REGISTRATION_STATUSES.includes(r.status)) return;
  const pending = r.members.map((m) => m.userId).filter((id) => id !== r.team?.captainId && (!userIds || userIds.includes(id)));
  await notify(c, pending, {
    type: 'TEAM_INVITE',
    title: messages.registrations.confirmParticipation.title(r.tournament.name),
    body: messages.registrations.confirmParticipation.body(r.team.name),
    link: `/c/${r.tournament.slug}`,
  });
}

// ── Núcleo ───────────────────────────────────────────────────────────

const rosterRegistration = {
  team: { select: { id: true, name: true, captainId: true } },
  members: { select: { id: true, userId: true, isSub: true, confirmedAt: true, user: { select: { nickname: true } } } },
} satisfies Prisma.RegistrationInclude;
type RosterRegistration = Prisma.RegistrationGetPayload<{ include: typeof rosterRegistration }>;

async function loadForRoster(tx: Tx, id: string, tournamentId?: string): Promise<RosterRegistration> {
  const r = isUuid(id) ? await tx.registration.findUnique({ where: { id }, include: rosterRegistration }) : null;
  if (!r || (tournamentId && r.tournamentId !== tournamentId)) throw notFound('Inscrição');
  return r;
}

const squadName = (r: { displayName: string | null; team: { name: string } | null }) => r.displayName ?? r.team?.name ?? 'squad';

async function hasGameAccount(tx: Tx, userId: string, t: TournamentForRegistration): Promise<boolean> {
  const required = Array.isArray(t.game.requiredAccountFields) && t.game.requiredAccountFields.length > 0;
  if (!required) return true;
  return (await tx.gameAccount.count({ where: { userId, gameId: t.game.id } })) > 0;
}

/**
 * Coloca o jogador no elenco, com as conferências de vaga no elenco, exclusividade por campeonato e
 * elegibilidade. `confirmed`: a organização escalou (ou o jogador escolheu entrar no squad) e já conta.
 */
async function addToRoster(tx: Tx, t: TournamentForRegistration, r: RosterRegistration, user: { id: string; nickname: string }, opts: { confirmed: boolean; now: Date; preferSub?: boolean }): Promise<void> {
  if (!r.teamId) throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
  if (!ACTIVE_REGISTRATION_STATUSES.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (r.members.some((m) => m.userId === user.id)) throw conflict(`${user.nickname} já está no elenco do ${squadName(r)}.`, 'ALREADY_IN_ROSTER');
  const limit = rosterLimit(t.gameMode);
  if (r.members.length >= limit) throw conflict(`O elenco do ${squadName(r)} já está completo (${limit} ${limit === 1 ? 'jogador' : 'jogadores'}, contando reservas).`, 'ROSTER_FULL');
  // Exclusividade (PRD §12.1): ninguém joga o mesmo campeonato por dois squads (nem solo e por squad).
  const elsewhere = await tx.registrationMember.findFirst({ where: { tournamentId: t.id, userId: user.id }, include: { registration: { select: { displayName: true, team: { select: { name: true } } } } } });
  if (elsewhere) throw conflict(`${user.nickname} já está no elenco do ${squadName(elsewhere.registration)} neste campeonato. Um jogador não pode estar em dois squads no mesmo campeonato.`, 'PLAYER_IN_OTHER_TEAM');
  const solo = await tx.registration.count({ where: { tournamentId: t.id, userId: user.id, status: { in: ACTIVE_REGISTRATION_STATUSES } } });
  if (solo > 0) throw conflict(`${user.nickname} já está inscrito neste campeonato.`, 'ALREADY_REGISTERED');
  await assertRosterEligibility(tx, t, [user.id]);
  const starters = r.members.filter((m) => !m.isSub).length;
  await tx.registrationMember.create({
    data: { registrationId: r.id, tournamentId: t.id, userId: user.id, isSub: starters >= t.gameMode.teamSize ? true : (opts.preferSub ?? false), isCaptain: false, confirmedAt: opts.confirmed ? opts.now : null },
  });
}

/** Recalcula o status depois da troca (só antes de o campeonato começar). Devolve se a inscrição acabou de ficar confirmada. */
async function settleRosterStatus(tx: Tx, t: TournamentForRegistration, registrationId: string): Promise<boolean> {
  if (!CONFIRMATION_STATUSES.includes(t.status)) return false;
  const r = await tx.registration.findUniqueOrThrow({ where: { id: registrationId }, select: { status: true, members: { select: { confirmedAt: true } } } });
  const next = statusAfterRosterChange(r.status, { manualApproval: t.manualApproval, confirmedMembers: r.members.filter((m) => m.confirmedAt !== null).length, requiredMembers: t.gameMode.teamSize });
  if (next === r.status) return false;
  // Completou: a vaga deixa de ser só uma reserva. Perdeu o mínimo: continua com a vaga, aguardando membros.
  await tx.registration.update({ where: { id: registrationId }, data: { status: next, ...(next === 'PENDING_MEMBERS' ? {} : { reservedUntil: null }) } });
  return next === 'CONFIRMED';
}

async function findUser(tx: Tx, input: AddRosterMemberInput) {
  const user = input.userId
    ? isUuid(input.userId)
      ? await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, nickname: true, status: true } })
      : null
    : await tx.user.findUnique({ where: { nicknameKey: (input.nickname ?? '').replace(/^@/, '').trim().toLowerCase() }, select: { id: true, nickname: true, status: true } });
  if (!user || user.status === 'DELETED' || user.status === 'MERGED') throw new HttpProblem(404, 'Não encontramos nenhum jogador com este apelido.', 'USER_NOT_FOUND', { nickname: 'Não encontramos nenhum jogador com este apelido.' });
  return user;
}

// ── Entrada pelo convite do squad ────────────────────────────────────

/**
 * Quem acabou de entrar no squad entra também no elenco das inscrições do squad que esperam jogadores
 * (campeonato ainda nos estados de confirmação, antes da trava de elenco, com espaço e faltando confirmados).
 * Entra já confirmado se tem o ID do jogo exigido; senão, entra pendente e é avisado. Campeonato em que ele
 * já joga por outro squad (ou em que não pode jogar) fica de fora, sem erro.
 */
export async function joinOpenRosters(c: AppContext, userId: string, teamId: string): Promise<RosterJoin[]> {
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const candidates = await db.registration.findMany({
    where: { teamId, status: { in: ACTIVE_REGISTRATION_STATUSES }, tournament: { status: { in: CONFIRMATION_STATUSES } } },
    select: { id: true, tournamentId: true },
  });
  const joined: RosterJoin[] = [];
  const confirmedNow: string[] = [];
  for (const candidate of candidates) {
    try {
      const result = await db.$transaction(async (tx) => {
        const t = await lockTournament(tx, candidate.tournamentId);
        if (!canCaptainEditRoster({ status: t.status, rosterLockAt: iso(t.rosterLockAt) }, now)) return null;
        const r = await loadForRoster(tx, candidate.id);
        if (!ACTIVE_REGISTRATION_STATUSES.includes(r.status)) return null;
        if (!rosterNeedsPlayers({ members: r.members.length, confirmedMembers: r.members.filter((m) => m.confirmedAt !== null).length }, t.gameMode)) return null;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, nickname: true } });
        const confirmed = await hasGameAccount(tx, userId, t);
        await addToRoster(tx, t, r, user, { confirmed, now });
        const became = await settleRosterStatus(tx, t, r.id);
        return { join: { registrationId: r.id, tournamentId: t.id, tournamentName: t.name, tournamentSlug: t.slug, confirmed }, became };
      }, LOCKED_TX);
      if (!result) continue;
      joined.push(result.join);
      if (result.became) confirmedNow.push(result.join.registrationId);
    } catch (error) {
      // Não pode jogar este campeonato (outro squad, organização, conta): o convite do squad continua valendo.
      if (error instanceof HttpProblem) continue;
      throw error;
    }
  }
  if (joined.length > 0) revalidateTournaments(c);
  for (const j of joined.filter((x) => !x.confirmed)) await notifyToConfirm(c, j.registrationId, [userId]);
  await notifyConfirmed(c, confirmedNow);
  return joined;
}

// ── Rotas ────────────────────────────────────────────────────────────

export const roster = new Hono<AppEnv>();

interface Actor {
  userId: string;
  asCaptain: boolean;
}

/** Capitão do squad da inscrição ou organização (`manage`). Membro comum e moderador não mexem no elenco. */
async function rosterActor(c: AppContext, r: { tournamentId: string; team: { captainId: string } | null }): Promise<Actor> {
  const session = await requireSession(c);
  if (r.team?.captainId === session.userId) return { userId: session.userId, asCaptain: true };
  try {
    await assertTournamentAccess(c, r.tournamentId, 'manage');
  } catch (error) {
    if (error instanceof HttpProblem && error.status === 403) throw forbidden('Só o capitão do squad ou a organização do campeonato mexem no elenco.', 'NOT_ROSTER_MANAGER');
    throw error;
  }
  return { userId: session.userId, asCaptain: false };
}

function assertCanEdit(actor: Actor, t: TournamentForRegistration, now: Date): void {
  if (actor.asCaptain) {
    if (!canCaptainEditRoster({ status: t.status, rosterLockAt: iso(t.rosterLockAt) }, now)) {
      throw conflict(
        CONFIRMATION_STATUSES.includes(t.status) ? 'A trava de elenco já passou: agora só a organização troca os membros do squad.' : 'O campeonato já começou: agora só a organização troca os membros do squad.',
        'ROSTER_LOCKED',
      );
    }
  } else if (!canStaffEditRoster(t.status)) {
    throw conflict('Este campeonato já terminou: o elenco não muda mais.', 'ROSTER_CLOSED');
  }
}

async function auditCtx(c: AppContext, actorId: string) {
  return { actorId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

/** Roda a troca na transação com a trava; com a organização, também na auditoria. */
async function rosterTx<T>(c: AppContext, actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = c.get('deps').db();
  return actor.asCaptain ? db.$transaction(fn, LOCKED_TX) : withAudit(db, await auditCtx(c, actor.userId), fn);
}

async function tournamentOf(c: AppContext, registrationId: string) {
  const db = c.get('deps').db();
  const r = isUuid(registrationId) ? await db.registration.findUnique({ where: { id: registrationId }, include: { team: { select: { captainId: true } }, tournament: { include: tournamentForRegistration } } }) : null;
  if (!r) throw notFound('Inscrição');
  return r;
}

async function respondChange(c: AppContext, t: TournamentForRegistration, ids: string[]) {
  const db = c.get('deps').db();
  const rows = await db.registration.findMany({ where: { id: { in: ids } }, include: registrationInclude });
  const views = await toRegistrations(db, t, rows);
  return respond(c, RosterChangeResult, { registrations: ids.map((id) => views.find((v) => v.id === id)).filter((v) => v !== undefined) });
}

/** Escalar: o capitão escolhe um membro do squad; a organização, qualquer jogador (já confirmado). */
roster.post('/registrations/:id/members', async (c) => {
  const head = await tournamentOf(c, c.req.param('id'));
  const actor = await rosterActor(c, head);
  const input = await body(c, AddRosterMemberInput);
  const now = c.get('deps').now();
  const added = await rosterTx(c, actor, async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    assertCanEdit(actor, t, now);
    const r = await loadForRoster(tx, head.id);
    const user = await findUser(tx, input);
    let preferSub: boolean | undefined;
    if (actor.asCaptain) {
      const member = r.teamId ? await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: r.teamId, userId: user.id } } }) : null;
      if (!member) throw badRequest(`${user.nickname} não faz parte do squad. Convide o jogador para o squad primeiro.`, 'NOT_A_MEMBER', { userId: 'Escolha um membro do squad.' });
      preferSub = member.isSub;
    } else if (!(await hasGameAccount(tx, user.id, t))) {
      throw conflict(`${user.nickname} ainda não informou o ID de ${t.game.name} em Minha conta. Sem ele, não dá para entrar no elenco.`, 'GAME_ACCOUNT_REQUIRED');
    }
    // A organização decidiu (e combinou com o jogador): entra confirmado. Escalado pelo capitão confirma sozinho.
    await addToRoster(tx, t, r, user, { confirmed: !actor.asCaptain, now, ...(preferSub !== undefined ? { preferSub } : {}) });
    const became = await settleRosterStatus(tx, t, r.id);
    if (!actor.asCaptain) {
      await audited(tx, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${squadName(r)}`, tournamentId: t.id, after: { escalou: user.nickname } });
    }
    return { user, became, team: squadName(r), tournament: t.name };
  });
  revalidateTournaments(c);
  if (actor.asCaptain) await notifyToConfirm(c, head.id, [added.user.id]);
  else await notify(c, [added.user.id], { type: 'TEAM_INVITE', title: messages.registrations.rosterAdded.title(added.team), body: messages.registrations.rosterAdded.body(added.tournament, true), link: `/c/${head.tournament.slug}` });
  if (added.became) await notifyConfirmed(c, [head.id]);
  return respondChange(c, head.tournament, [head.id]);
});

/** Tirar do elenco: o capitão (até a trava, nunca a si mesmo) ou a organização (até o fim). */
roster.delete('/registrations/:id/members/:userId', async (c) => {
  const head = await tournamentOf(c, c.req.param('id'));
  const actor = await rosterActor(c, head);
  const userId = c.req.param('userId');
  const now = c.get('deps').now();
  const removed = await rosterTx(c, actor, async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    assertCanEdit(actor, t, now);
    const r = await loadForRoster(tx, head.id);
    if (!r.teamId) throw conflict('Inscrição individual não tem elenco.', 'SOLO_REGISTRATION');
    const member = r.members.find((m) => m.userId === userId);
    if (!member) throw notFound('Jogador no elenco');
    if (r.team?.captainId === userId) {
      throw conflict(actor.asCaptain ? 'Você é o capitão: para tirar o squad do campeonato, cancele a inscrição.' : 'Este jogador é o capitão do squad. Peça para ele passar a capitania antes de sair do elenco.', 'CAPTAIN_IN_ROSTER');
    }
    await tx.registrationMember.delete({ where: { id: member.id } });
    await settleRosterStatus(tx, t, r.id);
    if (!actor.asCaptain) {
      await audited(tx, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${squadName(r)}`, tournamentId: t.id, after: { tirou: member.user.nickname } });
    }
    return { team: squadName(r), tournament: t.name };
  });
  revalidateTournaments(c);
  if (userId !== actor.userId) {
    await notify(c, [userId], { type: 'TEAM_INVITE', title: messages.registrations.rosterRemoved.title(removed.team), body: messages.registrations.rosterRemoved.body(removed.tournament), link: `/c/${head.tournament.slug}` });
  }
  return respondChange(c, head.tournament, [head.id]);
});

/** Remanejar (só a organização): tira o jogador de um squad e escala em outro do mesmo campeonato. */
roster.post('/registrations/:id/members/:userId/move', async (c) => {
  const head = await tournamentOf(c, c.req.param('id'));
  await assertTournamentAccess(c, head.tournamentId, 'manage');
  const actor: Actor = { userId: (await requireSession(c)).userId, asCaptain: false };
  const userId = c.req.param('userId');
  const { toRegistrationId } = await body(c, MoveRosterMemberInput);
  if (toRegistrationId === head.id) throw badRequest('Escolha outro squad para o jogador.', 'SAME_REGISTRATION', { toRegistrationId: 'Escolha outro squad.' });
  const now = c.get('deps').now();
  const moved = await rosterTx(c, actor, async (tx) => {
    const t = await lockTournament(tx, head.tournamentId);
    assertCanEdit(actor, t, now);
    const from = await loadForRoster(tx, head.id);
    const to = await loadForRoster(tx, toRegistrationId, t.id);
    const member = from.members.find((m) => m.userId === userId);
    if (!member) throw notFound('Jogador no elenco');
    if (from.team?.captainId === userId) throw conflict('Este jogador é o capitão do squad. Peça para ele passar a capitania antes de trocar de squad.', 'CAPTAIN_IN_ROSTER');
    if (!(await hasGameAccount(tx, userId, t))) throw conflict(`${member.user.nickname} ainda não informou o ID de ${t.game.name} em Minha conta. Sem ele, não dá para entrar no elenco.`, 'GAME_ACCOUNT_REQUIRED');
    // Sai primeiro: a exclusividade por campeonato vale para a linha nova.
    await tx.registrationMember.delete({ where: { id: member.id } });
    await addToRoster(tx, t, to, { id: userId, nickname: member.user.nickname }, { confirmed: true, now });
    await settleRosterStatus(tx, t, from.id);
    const became = await settleRosterStatus(tx, t, to.id);
    await audited(tx, { action: 'ROSTER_CHANGED', entityType: 'Registration', entityId: to.id, entityLabel: `${t.name} · ${squadName(to)}`, tournamentId: t.id, before: { squad: squadName(from) }, after: { remanejou: member.user.nickname, squad: squadName(to) } });
    return { became, from: squadName(from), to: squadName(to), tournament: t.name };
  });
  revalidateTournaments(c);
  await notify(c, [userId], { type: 'TEAM_INVITE', title: messages.registrations.rosterMoved.title(moved.to), body: messages.registrations.rosterMoved.body(moved.from, moved.tournament), link: `/c/${head.tournament.slug}` });
  if (moved.became) await notifyConfirmed(c, [toRegistrationId]);
  return respondChange(c, head.tournament, [head.id, toRegistrationId]);
});
