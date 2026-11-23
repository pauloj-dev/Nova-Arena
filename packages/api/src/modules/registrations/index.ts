/**
 * Inscrições (issue #79, PRD ORG-03, RF-14, RF-23, RN-06, RN-12). Porta de `registrations.ts` e
 * `registrations-manage.ts` da API simulada: mesmas rotas, mensagens e códigos; regras puras em `@nova/schemas`.
 *
 * - Solo e squad; vagas, prazo, ID de jogo obrigatório e aprovação manual opcional.
 * - Toda mudança de vaga numa transação com `SELECT … FOR UPDATE` no campeonato (`core.ts`).
 * - Lista de espera com promoção automática no cancelamento, na recusa e na remoção.
 * - Organizador (dono ou equipe) não se inscreve no próprio campeonato.
 * - Organização: aprovar, recusar, remover, substituir; importar CSV; exportar CSV em streaming.
 *
 * Diferenças registradas: próxima partida e colocação em "Meus campeonatos" chegam com as partidas (B2);
 * desistência e desclassificação com o campeonato em andamento, na #100; avisos por notificação, na #98.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import {
  ACTIVE_REGISTRATION_STATUSES,
  canCancelRegistration,
  checkSquadSize,
  ImportRegistrationsInput,
  ImportRegistrationsResult,
  initialRegistrationStatus,
  isCurrentEntry,
  MyTournamentEntry,
  promotionFor,
  RegisterInTournamentInput,
  Registration,
  RegistrationEligibility,
  registrationsToCsv,
  registrationWindow,
  ReviewRegistrationInput,
  ReviewRegistrationResult,
  SLOT_HOLDING_STATUSES,
  squadSizeMessage,
  statusAfterMemberConfirmation,
  type RegistrationStatus,
  type TournamentStatus,
} from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, HttpProblem, notFound } from '../../errors';
import { assertTournamentAccess } from '../../auth/rbac';
import { currentSession, requireSession } from '../../auth/session';
import { clientIp } from '../../security';
import { listMatches } from '../../competition/bracket';
import { replaceEntrantInPreview } from '../../competition/maintenance';
import { revalidateTournaments } from '../../revalidate';
import { checkInOf, countsOf, toTournamentSummary, tournamentInclude } from '../tournaments/views';
import { LOCKED_TX, lockTournament, registrationIdsOfUser, registrationInclude, releaseMembers, settleWaitlist, takenSlots, toRegistration, toRegistrations, tournamentForRegistration, type TournamentForRegistration, type Tx } from './core';

/** Estados em que um membro ainda pode confirmar ou recusar a participação. */
const CONFIRMATION_STATUSES: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED'];
const BEFORE_START: TournamentStatus[] = ['PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN'];
const STARTED: TournamentStatus[] = ['IN_PROGRESS', 'PAUSED'];
const ACTIVE: RegistrationStatus[] = ACTIVE_REGISTRATION_STATUSES;
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const isUniqueViolation = (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';

/** Marca de ordem de bytes do UTF-8 (o Excel precisa dela no começo do arquivo, uma vez só). */
const BOM = String.fromCharCode(0xfeff);

const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Campeonato com o que o resumo público e as inscrições precisam. */
const summaryAndRegistration = {
  ...tournamentInclude,
  game: { select: { id: true, name: true, icon: true, requiredAccountFields: true } },
  gameMode: { select: { name: true, teamSize: true, maxSubs: true } },
} satisfies Prisma.TournamentInclude;

async function visibleTournament(c: AppContext, idOrSlug: string): Promise<TournamentForRegistration> {
  const db = c.get('deps').db();
  const t = isUuid(idOrSlug) ? await db.tournament.findUnique({ where: { id: idOrSlug }, include: tournamentForRegistration }) : await db.tournament.findUnique({ where: { slug: idOrSlug }, include: tournamentForRegistration });
  // Rascunho não existe para o público.
  if (!t || t.status === 'DRAFT') throw notFound('Campeonato');
  return t;
}

/** Dono ou equipe do campeonato. Admin que não é da equipe pode se inscrever (PRD §6). */
async function isOrganizerOf(c: AppContext, userId: string, t: { id: string; ownerId: string }): Promise<boolean> {
  if (t.ownerId === userId) return true;
  return (await c.get('deps').db().tournamentStaff.count({ where: { tournamentId: t.id, userId } })) > 0;
}

const involves = (userId: string): Prisma.RegistrationWhereInput => ({ OR: [{ userId }, { members: { some: { userId } } }] });

/** A inscrição do usuário neste campeonato: a ativa; senão, a última encerrada pela organização. */
async function myRegistrationIn(c: AppContext, t: TournamentForRegistration, userId: string) {
  const mine = await c.get('deps').db().registration.findMany({ where: { tournamentId: t.id, ...involves(userId) }, include: registrationInclude, orderBy: { createdAt: 'desc' } });
  return mine.find((r) => ACTIVE.includes(r.status)) ?? mine.find((r) => r.status !== 'CANCELLED');
}

async function hasGameAccount(tx: Tx, userId: string, t: TournamentForRegistration): Promise<boolean> {
  const required = Array.isArray(t.game.requiredAccountFields) && t.game.requiredAccountFields.length > 0;
  if (!required) return true;
  return (await tx.gameAccount.count({ where: { userId, gameId: t.game.id } })) > 0;
}

function assertGameAccountMessage(t: TournamentForRegistration): HttpProblem {
  return badRequest(`Para jogar este campeonato, informe seu ID de ${t.game.name} em Minha conta.`, 'GAME_ACCOUNT_REQUIRED');
}

async function auditCtx(c: AppContext) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

/** Status de partida que ainda não acabou para quem joga. */
const OPEN_MATCH_STATUSES = ['SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'DISPUTED'];
/** Estados do campeonato em que pode existir partida por jogar. */
const MATCH_TOURNAMENT_STATUSES = ['REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED'];

/**
 * Próxima partida e colocação final de uma inscrição (PAR-06), como na API simulada (`competitionInfo`):
 * - `nextMatch`: a partida ainda por jogar com o horário mais próximo (sem horário fica por último); `checkInOpen`
 *   enquanto a janela está aberta e o check-in da inscrição ainda não foi concluído;
 * - `finalPlacement`: o lugar no pódio, quando o campeonato terminou e a inscrição ficou entre os três primeiros.
 */
async function competitionInfo(db: PrismaClient, t: { id: string; status: string; podium: { places: unknown } | null }, registration: { id: string; status: string }): Promise<Pick<MyTournamentEntry, 'nextMatch' | 'finalPlacement'>> {
  const ended = t.status === 'FINISHED' || t.status === 'ARCHIVED';
  const places = (t.podium?.places ?? []) as { place: number; registrationId: string }[];
  const finalPlacement = ended ? (places.find((p) => p.registrationId === registration.id)?.place ?? null) : null;
  if (registration.status !== 'CONFIRMED' || !MATCH_TOURNAMENT_STATUSES.includes(t.status)) return { nextMatch: null, finalPlacement };
  const mine = (await listMatches(db, t.id))
    .filter((m) => OPEN_MATCH_STATUSES.includes(m.status) && m.participants.some((p) => p.registrationId === registration.id))
    .sort((a, b) => {
      if (a.scheduledAt && b.scheduledAt) return a.scheduledAt.localeCompare(b.scheduledAt);
      if (a.scheduledAt) return -1;
      if (b.scheduledAt) return 1;
      return a.round - b.round || a.position - b.position;
    });
  const next = mine[0];
  if (!next) return { nextMatch: null, finalPlacement };
  const me = next.participants.find((p) => p.registrationId === registration.id);
  const opponent = next.kind === 'DUEL' ? next.participants.find((p) => p.registrationId !== registration.id) : undefined;
  return {
    nextMatch: {
      id: next.id,
      label: [next.stageName, next.groupName, next.roundLabel].filter(Boolean).join(' · '),
      scheduledAt: next.scheduledAt,
      opponent: opponent?.registrationId ? opponent.name : null,
      checkInOpen: next.status === 'CHECK_IN' && !me?.checkedIn,
    },
    finalPlacement,
  };
}

export const registrations = new Hono<AppEnv>();

// ── Participante ─────────────────────────────────────────────────────
/** "Meus campeonatos": uma entrada por campeonato em que estou (solo ou no elenco de um squad). */
registrations.get('/me/registrations', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const mineIds = await registrationIdsOfUser(db, session.userId);
  const rows = await db.registration.findMany({ where: { id: { in: mineIds }, tournament: { status: { not: 'DRAFT' } } }, include: registrationInclude, orderBy: { createdAt: 'desc' } });
  // Uma inscrição por campeonato: a ativa; sem ativa, a mais recente (inclusive cancelada, para o histórico).
  const byTournament = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const current = byTournament.get(r.tournamentId);
    if (!current || (!ACTIVE.includes(current.status) && ACTIVE.includes(r.status))) byTournament.set(r.tournamentId, r);
  }
  const ids = [...byTournament.keys()];
  const tournaments = await db.tournament.findMany({ where: { id: { in: ids } }, include: summaryAndRegistration });
  const counts = await countsOf(db, ids);
  const podiums = new Map((await db.tournamentPodium.findMany({ where: { tournamentId: { in: ids } }, select: { tournamentId: true, places: true } })).map((p) => [p.tournamentId, p]));
  const entries: MyTournamentEntry[] = [];
  for (const t of tournaments) {
    const r = byTournament.get(t.id);
    if (!r) continue;
    const [registration] = await toRegistrations(db, t, [r]);
    if (registration) entries.push({ tournament: toTournamentSummary(t, counts.get(t.id)), registration, ...(await competitionInfo(db, { id: t.id, status: t.status, podium: podiums.get(t.id) ?? null }, registration)) });
  }
  // Os que estão valendo vêm primeiro, pela data mais próxima; o histórico, do mais recente para o mais antigo.
  const startsAt = (e: MyTournamentEntry) => e.tournament.startsAt ?? '9999';
  entries.sort((a, b) => Number(isCurrentEntry(b)) - Number(isCurrentEntry(a)) || (isCurrentEntry(a) ? startsAt(a).localeCompare(startsAt(b)) : startsAt(b).localeCompare(startsAt(a))));
  return respond(c, z.array(MyTournamentEntry), entries);
});

/** Minha inscrição neste campeonato, ou `null`. Visitante recebe `null` (e não 401): a página é pública. */
registrations.get('/tournaments/:id/my-registration', async (c) => {
  const t = await visibleTournament(c, c.req.param('id'));
  const session = await currentSession(c);
  if (!session) return respond(c, Registration.nullable(), null);
  const r = await myRegistrationIn(c, t, session.userId);
  return respond(c, Registration.nullable(), r ? ((await toRegistrations(c.get('deps').db(), t, [r]))[0] ?? null) : null);
});

registrations.get('/tournaments/:id/registration-eligibility', async (c) => {
  const t = await visibleTournament(c, c.req.param('id'));
  const session = await currentSession(c);
  return respond(c, RegistrationEligibility, { isOrganizer: session !== null && (await isOrganizerOf(c, session.userId, t)) });
});

/** Inscritos visíveis ao público: confirmados e aguardando. Lista de espera e recusados só para a organização (`scope=all`). */
registrations.get('/tournaments/:id/registrations', async (c) => {
  const t = await visibleTournament(c, c.req.param('id'));
  const db = c.get('deps').db();
  let staff = false;
  if (c.req.query('scope') === 'all' && (await currentSession(c))) {
    staff = await assertTournamentAccess(c, t.id, 'moderate').then(
      () => true,
      () => false,
    );
  }
  const rows = await db.registration.findMany({
    where: { tournamentId: t.id, ...(staff ? {} : { status: { in: ['CONFIRMED', 'PENDING_MEMBERS', 'PENDING_APPROVAL'] } }) },
    include: registrationInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return respond(c, z.array(Registration), await toRegistrations(db, t, rows));
});

registrations.post('/tournaments/:id/registrations', async (c) => {
  const session = await requireSession(c);
  const userId = session.userId;
  const tView = await visibleTournament(c, c.req.param('id'));
  const input = await body(c, RegisterInTournamentInput);
  if (await isOrganizerOf(c, userId, tView)) throw new HttpProblem(403, 'Você faz parte da organização deste campeonato, então não pode se inscrever nele.', 'OWN_TOURNAMENT');
  const db = c.get('deps').db();
  const now = c.get('deps').now();

  const id = await db
    .$transaction(async (tx) => {
      // A partir daqui, ninguém mais mexe nas vagas deste campeonato até o fim da transação.
      const t = await lockTournament(tx, tView.id);
      const window = registrationWindow({ status: t.status, registrationOpensAt: iso(t.registrationOpensAt), registrationClosesAt: iso(t.registrationClosesAt) }, now);
      if (window === 'NOT_OPEN_YET') {
        const when = t.registrationOpensAt ? ` Elas abrem em ${timeFmt.format(t.registrationOpensAt)} (horário de Brasília).` : '';
        throw conflict(`As inscrições deste campeonato ainda não abriram.${when}`, 'REGISTRATION_NOT_OPEN');
      }
      if (window !== 'OPEN') throw conflict(window === 'CANCELLED' ? 'Este campeonato foi cancelado.' : 'As inscrições deste campeonato já foram encerradas.', 'REGISTRATION_CLOSED');

      // Quem foi recusado ou desclassificado pela organização não entra de novo por conta própria.
      const barred = await tx.registration.count({ where: { tournamentId: t.id, status: { in: ['REJECTED', 'DISQUALIFIED'] }, OR: [{ userId }, ...(input.teamId ? [{ teamId: input.teamId }] : [])] } });
      if (barred > 0) throw conflict('A organização recusou esta inscrição. Fale com o organizador para entender o motivo.', 'REGISTRATION_REJECTED');

      let team: { id: string; name: string; members: { userId: string; isSub: boolean; user: { nickname: string } }[] } | null = null;
      if (t.participantType === 'SOLO') {
        if (input.teamId) throw badRequest('Este campeonato é individual: a inscrição é só sua, sem squad.', 'SOLO_ONLY', { teamId: 'Este campeonato é individual.' });
        if (await tx.registration.count({ where: { tournamentId: t.id, userId, status: { in: ACTIVE } } })) throw conflict('Você já está inscrito neste campeonato.', 'ALREADY_REGISTERED');
      } else {
        if (!input.teamId) throw badRequest('Este campeonato é por squad. Escolha o squad que vai jogar.', 'TEAM_REQUIRED', { teamId: 'Escolha um squad.' });
        const found = await tx.team.findUnique({ where: { id: input.teamId }, include: { members: { include: { user: { select: { nickname: true } } } } } });
        if (!found || found.archivedAt) throw notFound('Squad');
        if (found.captainId !== userId) throw new HttpProblem(403, 'Só o capitão pode inscrever o squad.', 'NOT_CAPTAIN');
        if (await tx.registration.count({ where: { tournamentId: t.id, teamId: found.id, status: { in: ACTIVE } } })) throw conflict(`O ${found.name} já está inscrito neste campeonato.`, 'ALREADY_REGISTERED');
        const size = checkSquadSize(found.members.length, t.gameMode);
        if (!size.ok) throw conflict(squadSizeMessage(size, t.gameMode) ?? 'O tamanho do squad não serve para este modo.', size.reason === 'TOO_SMALL' ? 'TEAM_TOO_SMALL' : 'TEAM_TOO_BIG');
        // Exclusividade (PRD §12.1): ninguém joga o mesmo campeonato por dois squads.
        const clash = await tx.registrationMember.findFirst({ where: { tournamentId: t.id, userId: { in: found.members.map((m) => m.userId) } }, include: { registration: { include: { team: { select: { name: true } } } } } });
        if (clash) {
          const nick = found.members.find((m) => m.userId === clash.userId)?.user.nickname;
          const who = clash.userId === userId ? 'Você já está inscrito' : `${nick ?? 'Um jogador do squad'} já está inscrito`;
          const where = clash.registration.team?.name;
          throw conflict(`${who} neste campeonato${where ? ` pelo squad ${where}` : ''}. Um jogador não pode estar em dois squads no mesmo campeonato.`, 'PLAYER_IN_OTHER_TEAM');
        }
        team = found;
      }

      // Solo: o ID do jogo é obrigatório já na inscrição. Squad: o capitão conta como confirmado, então vale para ele também.
      if (!(await hasGameAccount(tx, userId, t))) throw assertGameAccountMessage(t);

      await settleWaitlist(tx, t, now);
      const status = initialRegistrationStatus({
        freeSlots: t.maxParticipants - (await takenSlots(tx, t.id)),
        waitlistEnabled: t.waitlistEnabled,
        manualApproval: t.manualApproval,
        isTeam: team !== null,
        confirmedMembers: 1,
        requiredMembers: t.gameMode.teamSize,
      });
      if (status === 'FULL') throw conflict('As vagas deste campeonato estão esgotadas e ele não tem lista de espera.', 'TOURNAMENT_FULL');

      const data = {
        status,
        rulesAcceptedAt: now,
        statusReason: null,
        reservedUntil: null,
        seed: null,
        createdAt: now,
        ...(team ? { members: { create: team.members.map((m) => ({ tournamentId: t.id, userId: m.userId, isSub: m.isSub, isCaptain: m.userId === userId, confirmedAt: m.userId === userId ? now : null })) } } : {}),
      };
      // Inscrição cancelada antes: a mesma linha volta a valer (um registro por pessoa/squad por campeonato).
      const previous = await tx.registration.findFirst({ where: { tournamentId: t.id, ...(team ? { teamId: team.id } : { userId }) }, select: { id: true } });
      if (previous) {
        await tx.registrationMember.deleteMany({ where: { registrationId: previous.id } });
        return (await tx.registration.update({ where: { id: previous.id }, data })).id;
      }
      return (await tx.registration.create({ data: { ...data, tournamentId: t.id, userId: team ? null : userId, teamId: team?.id ?? null } })).id;
    }, LOCKED_TX)
    .catch((error: unknown) => {
      // Corrida rara entre dois cliques: a restrição única decide.
      if (isUniqueViolation(error)) throw conflict('Esta inscrição acabou de ser feita. Atualize a página.', 'ALREADY_REGISTERED');
      throw error;
    });
  revalidateTournaments(c);
  return respond(c, Registration, await toRegistration(db, tView, id), 201);
});

async function findRegistration(c: AppContext, id: string) {
  const db = c.get('deps').db();
  const r = isUuid(id) ? await db.registration.findUnique({ where: { id }, include: { ...registrationInclude, tournament: { include: tournamentForRegistration } } }) : null;
  if (!r) throw notFound('Inscrição');
  return r;
}

/** Membro do squad confirma a participação. Ao atingir o mínimo, a inscrição avança. */
registrations.post('/registrations/:id/confirm', async (c) => {
  const session = await requireSession(c);
  const r = await findRegistration(c, c.req.param('id'));
  const member = r.members.find((m) => m.userId === session.userId);
  if (!r.teamId || !member) throw forbidden('Você não está no elenco desta inscrição.');
  if (!ACTIVE.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (!CONFIRMATION_STATUSES.includes(r.tournament.status)) throw conflict('O campeonato já começou: não dá mais para confirmar participação.', 'CONFIRMATION_CLOSED');
  const db = c.get('deps').db();
  const now = c.get('deps').now();
  await db.$transaction(async (tx) => {
    const t = await lockTournament(tx, r.tournamentId);
    if (!(await hasGameAccount(tx, session.userId, t))) throw assertGameAccountMessage(t);
    await settleWaitlist(tx, t, now);
    if (member.confirmedAt !== null) return;
    await tx.registrationMember.update({ where: { id: member.id }, data: { confirmedAt: now } });
    const current = await tx.registration.findUniqueOrThrow({ where: { id: r.id }, select: { status: true, members: { select: { confirmedAt: true } } } });
    const next = statusAfterMemberConfirmation(current.status, { manualApproval: t.manualApproval, confirmedMembers: current.members.filter((m) => m.confirmedAt).length, requiredMembers: t.gameMode.teamSize });
    // O squad completou dentro do prazo: a vaga deixa de ser só uma reserva.
    if (next !== current.status) await tx.registration.update({ where: { id: r.id }, data: { status: next, reservedUntil: null } });
  }, LOCKED_TX);
  revalidateTournaments(c);
  return respond(c, Registration, await toRegistration(db, r.tournament, r.id));
});

/** Membro recusa: sai do elenco desta inscrição (continua no squad). */
registrations.post('/registrations/:id/decline', async (c) => {
  const session = await requireSession(c);
  const r = await findRegistration(c, c.req.param('id'));
  const member = r.members.find((m) => m.userId === session.userId);
  if (!r.teamId || !member) throw forbidden('Você não está no elenco desta inscrição.');
  if (!ACTIVE.includes(r.status)) throw conflict('Esta inscrição não está mais ativa.', 'REGISTRATION_INACTIVE');
  if (r.team?.captainId === session.userId) throw conflict('Você é o capitão: para tirar o squad do campeonato, cancele a inscrição.', 'CAPTAIN_CANNOT_DECLINE');
  if (member.confirmedAt !== null) throw conflict('Você já confirmou a participação. Para sair agora, fale com o capitão do squad.', 'ALREADY_CONFIRMED');
  if (!CONFIRMATION_STATUSES.includes(r.tournament.status)) throw conflict('O campeonato já começou: fale com o capitão do squad.', 'CONFIRMATION_CLOSED');
  await c.get('deps').db().registrationMember.delete({ where: { id: member.id } });
  return c.body(null, 204);
});

/** Cancelar (RN-06): só o inscrito ou o capitão, e só até o prazo. Libera a vaga e a fila anda. */
registrations.delete('/registrations/:id', async (c) => {
  const session = await requireSession(c);
  const r = await findRegistration(c, c.req.param('id'));
  const owner = r.teamId ? r.team?.captainId === session.userId : r.userId === session.userId;
  if (!owner) throw forbidden(r.teamId ? 'Só o capitão do squad pode cancelar a inscrição.' : 'Só quem se inscreveu pode cancelar a inscrição.');
  if (!ACTIVE.includes(r.status)) throw conflict('Esta inscrição já não está ativa.', 'REGISTRATION_INACTIVE');
  const t0 = r.tournament;
  if (!canCancelRegistration({ status: t0.status, startsAt: iso(t0.startsAt), rosterLockAt: iso(t0.rosterLockAt), checkIn: checkInOf(t0.checkInConfig) }, c.get('deps').now())) {
    throw conflict('O prazo para cancelar a inscrição já passou. Para desistir agora, fale com a organização do campeonato.', 'CANCELLATION_CLOSED');
  }
  const now = c.get('deps').now();
  await c
    .get('deps')
    .db()
    .$transaction(async (tx) => {
      const t = await lockTournament(tx, r.tournamentId);
      await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', reservedUntil: null } });
      await releaseMembers(tx, r.id);
      await settleWaitlist(tx, t, now);
    }, LOCKED_TX);
  revalidateTournaments(c);
  return c.body(null, 204);
});

// ── Organização ──────────────────────────────────────────────────────
registrations.patch('/registrations/:id', async (c) => {
  const r = await findRegistration(c, c.req.param('id'));
  const { via } = await assertTournamentAccess(c, r.tournamentId, 'moderate');
  const input = await body(c, ReviewRegistrationInput);
  if ((input.action === 'remove' || input.action === 'replace') && via === 'MODERATOR') {
    throw forbidden('Moderadores aprovam e recusam inscrições. Remover ou substituir um inscrito é com a organização.');
  }
  const status = r.tournament.status;
  if (STARTED.includes(status)) {
    throw conflict(
      input.action === 'replace'
        ? 'Com a fase em andamento não dá mais para substituir um inscrito. A substituição vale até a chave ser confirmada.'
        : input.action === 'remove'
          ? 'Com o campeonato em andamento, registre a desistência ou a desclassificação do inscrito (com motivo).'
          : 'Com o campeonato em andamento as inscrições não são mais aprovadas nem recusadas.',
      'TOURNAMENT_STARTED',
    );
  }
  if (!BEFORE_START.includes(status)) throw conflict('As inscrições deste campeonato não podem mais ser alteradas.', 'REGISTRATIONS_LOCKED');

  const db = c.get('deps').db();
  const now = c.get('deps').now();
  const promoted: string[] = await withAudit(db, await auditCtx(c), async (tx) => {
    const t = await lockTournament(tx, r.tournamentId);
    // RN-12: reserva vencida volta para a fila antes de qualquer decisão.
    await settleWaitlist(tx, t, now);
    const current = await tx.registration.findUniqueOrThrow({ where: { id: r.id }, include: { members: { select: { confirmedAt: true } } } });
    const label = r.displayName ?? r.team?.name ?? r.user?.nickname ?? 'Inscrito';
    switch (input.action) {
      case 'approve':
        if (current.status !== 'PENDING_APPROVAL') throw conflict('Só inscrições aguardando aprovação podem ser aprovadas.', 'INVALID_REGISTRATION_STATUS');
        await tx.registration.update({ where: { id: r.id }, data: { status: 'CONFIRMED', statusReason: null } });
        break;
      case 'reject':
        if (current.status !== 'PENDING_APPROVAL' && current.status !== 'PENDING_MEMBERS' && current.status !== 'WAITLIST') {
          throw conflict('Esta inscrição já foi decidida. Para tirar um inscrito confirmado, use "Remover".', 'INVALID_REGISTRATION_STATUS');
        }
        await tx.registration.update({ where: { id: r.id }, data: { status: 'REJECTED', statusReason: input.reason, reservedUntil: null } });
        await releaseMembers(tx, r.id);
        break;
      case 'remove':
        if (!ACTIVE.includes(current.status)) throw conflict('Esta inscrição já não está ativa.', 'INVALID_REGISTRATION_STATUS');
        await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', statusReason: input.reason, reservedUntil: null } });
        await releaseMembers(tx, r.id);
        break;
      case 'replace': {
        if (!SLOT_HOLDING_STATUSES.includes(current.status)) throw conflict('Só dá para substituir quem está ocupando uma vaga.', 'INVALID_REGISTRATION_STATUS');
        const substitute = isUuid(input.withRegistrationId) ? await tx.registration.findFirst({ where: { id: input.withRegistrationId, tournamentId: t.id }, include: { members: { select: { confirmedAt: true } }, team: { select: { name: true } }, user: { select: { nickname: true } } } }) : null;
        if (!substitute || substitute.status !== 'WAITLIST') throw conflict('O substituto precisa estar na lista de espera deste campeonato.', 'SUBSTITUTE_NOT_IN_WAITLIST');
        // A escolha foi da organização: entra direto. Squad incompleto ganha o prazo para completar,
        // a não ser que as inscrições já tenham fechado (RN-12): aí ele não tem como completar.
        const next = promotionFor(
          { id: substitute.id, status: substitute.status, createdAt: substitute.createdAt.toISOString(), isTeam: substitute.teamId !== null, confirmedMembers: substitute.members.filter((m) => m.confirmedAt).length },
          { manualApproval: false, requiredMembers: t.gameMode.teamSize, registrationClosesAt: iso(t.registrationClosesAt), now },
        );
        if (!next) throw conflict('Este squad está incompleto e as inscrições já fecharam: ele não teria como completar o elenco. Escolha outro da lista de espera.', 'SUBSTITUTE_INCOMPLETE');
        const substituteName = substitute.displayName ?? substitute.team?.name ?? substitute.user?.nickname ?? 'Inscrito';
        await tx.registration.update({ where: { id: r.id }, data: { status: 'CANCELLED', statusReason: `Substituída por ${substituteName}.`, reservedUntil: null, seed: null } });
        await releaseMembers(tx, r.id);
        await tx.registration.update({ where: { id: substitute.id }, data: { status: next.status, reservedUntil: next.reservedUntil ? new Date(next.reservedUntil) : null, statusReason: null, seed: current.seed } });
        // #100: com a prévia da chave já gerada, o substituto entra no mesmo lugar (sem precisar regerar).
        await replaceEntrantInPreview(tx, t.id, r.id, substitute.id, substituteName);
        break;
      }
    }
    await audited(tx, { action: 'REGISTRATION_REVIEWED', entityType: 'Registration', entityId: r.id, entityLabel: `${t.name} · ${label}`, tournamentId: t.id, before: { status: current.status }, after: { acao: input.action } });
    return input.action === 'approve' ? ([] as string[]) : settleWaitlist(tx, t, now, { force: true });
  });
  revalidateTournaments(c);
  const t = r.tournament;
  const rows = await db.registration.findMany({ where: { id: { in: [r.id, ...promoted] } }, include: registrationInclude });
  const views = await toRegistrations(db, t, rows);
  return respond(c, ReviewRegistrationResult, { registration: views.find((v) => v.id === r.id) as Registration, promoted: views.filter((v) => promoted.includes(v.id)) });
});


/** Inscritos sem conta na plataforma, vindos de uma planilha. O excedente vai para a lista de espera. */
registrations.post('/tournaments/:id/registrations/import', async (c) => {
  const db = c.get('deps').db();
  const tView = await db.tournament.findUnique({ where: { id: c.req.param('id') }, include: tournamentForRegistration }).catch(() => null);
  if (!tView) throw notFound('Campeonato');
  await assertTournamentAccess(c, tView.id, 'manage');
  const { rows } = await body(c, ImportRegistrationsInput);
  if (!BEFORE_START.includes(tView.status)) {
    throw conflict(tView.status === 'DRAFT' ? 'Publique o campeonato antes de importar inscritos.' : 'Só dá para importar inscritos antes de o campeonato começar.', 'REGISTRATIONS_LOCKED');
  }
  const now = c.get('deps').now();
  const result = await db.$transaction(async (tx) => {
    const t = await lockTournament(tx, tView.id);
    await settleWaitlist(tx, t, now);
    const active = await tx.registration.findMany({ where: { tournamentId: t.id, status: { in: ACTIVE } }, include: { team: { select: { name: true } }, user: { select: { nickname: true } } } });
    const names = new Set(active.map((r) => (r.displayName ?? r.team?.name ?? r.user?.nickname ?? '').trim().toLowerCase()));
    const out: ImportRegistrationsResult = { created: 0, waitlisted: 0, skipped: [] };
    let taken = await takenSlots(tx, t.id);
    for (const [index, row] of rows.entries()) {
      const line = index + 1;
      const name = row.name.trim();
      const key = name.toLowerCase();
      if (name === '') {
        out.skipped.push({ row: line, reason: 'Falta o nome.' });
        continue;
      }
      if (names.has(key)) {
        out.skipped.push({ row: line, reason: `Já existe um inscrito chamado "${name}" neste campeonato.` });
        continue;
      }
      const hasSlot = taken < t.maxParticipants;
      if (!hasSlot && !t.waitlistEnabled) {
        out.skipped.push({ row: line, reason: 'As vagas acabaram e a lista de espera está desligada.' });
        continue;
      }
      await tx.registration.create({
        data: {
          tournamentId: t.id,
          displayName: name,
          tag: row.tag?.trim() ? row.tag.trim().toUpperCase() : null,
          importedContact: row.contact?.trim() || null,
          importedGameId: row.gameId?.trim() || null,
          status: hasSlot ? 'CONFIRMED' : 'WAITLIST',
          // Um milissegundo por linha preserva a ordem do arquivo na lista de espera.
          createdAt: new Date(now.getTime() + index),
        },
      });
      names.add(key);
      if (hasSlot) {
        taken += 1;
        out.created += 1;
      } else {
        out.waitlisted += 1;
      }
    }
    return out;
  }, LOCKED_TX);
  revalidateTournaments(c);
  return respond(c, ImportRegistrationsResult, result);
});

/** Exportação para planilha em streaming: UTF-8 com BOM e `;`, para abrir certo no Excel em pt-BR. */
registrations.get('/tournaments/:id/registrations.csv', async (c) => {
  const db = c.get('deps').db();
  const t = isUuid(c.req.param('id')) ? await db.tournament.findUnique({ where: { id: c.req.param('id') }, include: tournamentForRegistration }) : null;
  if (!t) throw notFound('Campeonato');
  await assertTournamentAccess(c, t.id, 'moderate');
  const order: RegistrationStatus[] = ['CONFIRMED', 'PENDING_APPROVAL', 'PENDING_MEMBERS', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED'];
  const encoder = new TextEncoder();
  const PAGE = 200;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Cabeçalho (com BOM) e depois as linhas em lotes, por status, sem montar o arquivo inteiro na memória.
        controller.enqueue(encoder.encode(registrationsToCsv([]).replace(/\r\n$/, '\r\n')));
        for (const status of order) {
          let cursor: string | undefined;
          for (;;) {
            const rows = await db.registration.findMany({ where: { tournamentId: t.id, status }, include: registrationInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
            if (rows.length === 0) break;
            const views = await toRegistrations(db, t, rows);
            const extra = new Map(rows.map((r) => [r.id, r]));
            const body = registrationsToCsv(views.map((v) => ({ ...v, contact: extra.get(v.id)?.importedContact ?? null, gameAccountId: extra.get(v.id)?.importedGameId ?? null })));
            // Tira o BOM e o cabeçalho que `registrationsToCsv` coloca em cada lote.
            controller.enqueue(encoder.encode(body.replace(BOM, '').split('\r\n').slice(1).join('\r\n')));
            cursor = rows.at(-1)?.id;
            if (rows.length < PAGE) break;
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="inscritos-${t.slug}.csv"`, 'Cache-Control': 'private, no-store' },
  });
});

