/**
 * Envio de resultado pelo participante e disputas (issue #90, PRD PAR-08, ORG-08, RF-19, §16.5). Porta de
 * `apps/web/mocks/handlers/submissions.ts`: mesmas rotas, mensagens e códigos.
 *
 * Regras centrais:
 * - só quem joga a partida envia (o jogador solo ou o capitão do squad), e só em duelos; com a flag
 *   `resultSubmission` desligada, o envio é recusado (403);
 * - print obrigatório no envio e prova obrigatória na contestação (risco R1); as provas são uploads privados;
 * - o adversário tem 30 min para confirmar ou contestar; depois disso o envio vai para a fila do staff;
 * - nada disso mexe na tabela: o resultado só vira oficial por `applyMatchResult` (envio aprovado pelo staff ou
 *   disputa resolvida), a mesma função do lançamento do staff (#85);
 * - disputa escalada só o Admin resolve.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { applyResult, getMatchStatus } from '@nova/engine';
import {
  CreateSubmissionInput,
  Dispute,
  DisputeMessageInput,
  DisputeStatus,
  OpenDisputeInput,
  ResolveDisputeInput,
  ResultSubmission,
  ReviewSubmissionInput,
  SubmissionStatus,
  type ResultEntryInput,
} from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { ADMIN_ROLES, assertTournamentAccess, currentRoles, isAdmin } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { findMatch, namesFor } from '../../competition/bracket';
import { afterResult, applyMatchResult, attachEvidence, matchLabelOf, tiebreakWinner, toEngineInput, usersOfRegistrations } from '../../competition/results';
import { registrationIdsOfUser } from '../registrations/core';
import { engine } from '../../competition/run';
import { isFlagEnabled } from '../site';
import { notify, publish } from '../../notify';
import { revalidateTournaments } from '../../revalidate';
import { auditCtx, isUuid, staffVia } from '../competition/access';

type Db = PrismaClient | Prisma.TransactionClient;
type SubmissionStatusT = z.infer<typeof SubmissionStatus>;
type DisputeStatusT = z.infer<typeof DisputeStatus>;
type AuthorRole = Dispute['messages'][number]['authorRole'];

/** Tempo que o adversário tem para confirmar ou contestar antes de o envio ir para a validação do staff. */
export const RESPONSE_WINDOW_MS = 30 * 60_000;
const ACTIVE: SubmissionStatusT[] = ['PENDING', 'CONFIRMED', 'CONTESTED'];

/** O que fica guardado no `payload` do envio (além das colunas). */
interface SubmissionPayload {
  entries: ResultEntryInput[];
  winnerRegistrationId: string | null;
  submittedByRegistrationId: string;
  opponentRegistrationId: string;
  tournamentId: string;
  tournamentName: string;
  stageId: string;
  matchLabel: string;
}

type SubmissionRow = Prisma.ResultSubmissionGetPayload<object>;
const payloadOf = (s: { payload: unknown }) => s.payload as SubmissionPayload;
const respondByOf = (s: { createdAt: Date }) => new Date(s.createdAt.getTime() + RESPONSE_WINDOW_MS);

async function nicknames(db: Db, ids: string[]): Promise<Map<string, string>> {
  const rows = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, nickname: true } });
  return new Map(rows.map((u) => [u.id, u.nickname]));
}

async function toSubmissions(db: Db, rows: SubmissionRow[]): Promise<ResultSubmission[]> {
  const nicks = await nicknames(db, rows.map((r) => r.submittedById));
  return rows.map((s) => {
    const p = payloadOf(s);
    return {
      id: s.id,
      matchId: s.matchId,
      tournamentId: p.tournamentId,
      tournamentName: p.tournamentName,
      matchLabel: p.matchLabel,
      submittedByNickname: nicks.get(s.submittedById) ?? 'Usuário',
      submittedByRegistrationId: p.submittedByRegistrationId,
      entries: p.entries,
      winnerRegistrationId: p.winnerRegistrationId,
      evidenceUrls: s.evidenceUrls,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      respondBy: respondByOf(s).toISOString(),
    };
  });
}
const toSubmission = async (db: Db, row: SubmissionRow) => (await toSubmissions(db, [row]))[0] as ResultSubmission;

const disputeInclude = { submission: true, messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } satisfies Prisma.DisputeInclude;
type DisputeRow = Prisma.DisputeGetPayload<{ include: typeof disputeInclude }>;

/** Contexto da disputa: as duas inscrições envolvidas, o campeonato e o rótulo da partida. */
async function disputeContext(db: Db, d: DisputeRow): Promise<{ registrationIds: string[]; tournamentId: string; tournamentName: string; matchLabel: string; stageId: string }> {
  if (d.submission) {
    const p = payloadOf(d.submission);
    return { registrationIds: [p.submittedByRegistrationId, p.opponentRegistrationId], tournamentId: p.tournamentId, tournamentName: p.tournamentName, matchLabel: p.matchLabel, stageId: p.stageId };
  }
  const m = await db.match.findUniqueOrThrow({ where: { id: d.matchId }, select: { stageId: true, roundLabel: true, participants: { select: { registrationId: true } }, stage: { select: { tournament: { select: { id: true, name: true } } } } } });
  return { registrationIds: m.participants.map((p) => p.registrationId), tournamentId: m.stage.tournament.id, tournamentName: m.stage.tournament.name, matchLabel: m.roundLabel, stageId: m.stageId };
}

async function toDisputes(db: Db, rows: DisputeRow[]): Promise<Dispute[]> {
  const nicks = await nicknames(db, rows.flatMap((d) => [d.openedById, ...d.messages.map((m) => m.authorId)]));
  const out: Dispute[] = [];
  for (const d of rows) {
    const ctx = await disputeContext(db, d);
    out.push({
      id: d.id,
      matchId: d.matchId,
      submissionId: d.submissionId,
      tournamentId: ctx.tournamentId,
      tournamentName: ctx.tournamentName,
      matchLabel: ctx.matchLabel,
      openedByNickname: nicks.get(d.openedById) ?? 'Usuário',
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      messages: d.messages.map((m) => ({ id: m.id, authorNickname: nicks.get(m.authorId) ?? 'Usuário', authorRole: (m.authorRole ?? 'PARTICIPANT') as AuthorRole, body: m.body, evidenceUrls: m.evidenceUrls, createdAt: m.createdAt.toISOString() })),
      createdAt: d.createdAt.toISOString(),
      resolvedAt: d.resolvedAt?.toISOString() ?? null,
    });
  }
  return out;
}
const toDispute = async (db: Db, row: DisputeRow) => (await toDisputes(db, [row]))[0] as Dispute;

// ── Contexto da partida ──────────────────────────────────────────────
async function matchContext(db: PrismaClient, matchId: string) {
  // Chave ainda em prévia não existe para o participante.
  const found = await findMatch(db, matchId);
  if (!found) throw notFound('Partida');
  const names = await namesFor(db, found.stage.tournamentId);
  const groupName = found.run.structure.groups.find((g) => g.id === found.node.groupId)?.name ?? null;
  return { ...found, tournament: found.stage.tournament, label: matchLabelOf(found.node, names, found.stage, groupName) };
}
type MatchContext = Awaited<ReturnType<typeof matchContext>>;

/** A inscrição pela qual a pessoa participa do campeonato (solo ou membro confirmado do squad). */
async function registrationOfUser(db: Db, tournamentId: string, userId: string) {
  return db.registration.findFirst({
    where: { tournamentId, status: { in: ['CONFIRMED', 'WITHDRAWN', 'DISQUALIFIED'] }, OR: [{ userId }, { members: { some: { userId, confirmedAt: { not: null } } } }] },
    select: { id: true, status: true, userId: true, team: { select: { captainId: true } } },
  });
}

/** Quem responde por uma inscrição: o próprio jogador (solo) ou o capitão do squad. */
async function actsFor(db: Db, registrationId: string, userId: string): Promise<boolean> {
  const r = await db.registration.findUnique({ where: { id: registrationId }, select: { userId: true, team: { select: { captainId: true } } } });
  if (!r) return false;
  return r.userId ? r.userId === userId : r.team?.captainId === userId;
}

async function involvedUsers(db: Db, registrationIds: string[]): Promise<string[]> {
  return [...(await usersOfRegistrations(db, registrationIds)).values()].flat();
}

/** Dono e equipe do campeonato: quem recebe os avisos de validação e de disputa. */
async function staffUserIds(db: Db, tournamentId: string): Promise<string[]> {
  const t = await db.tournament.findUniqueOrThrow({ where: { id: tournamentId }, select: { ownerId: true, staff: { select: { userId: true } } } });
  return [t.ownerId, ...t.staff.map((s) => s.userId)];
}

async function adminUserIds(db: Db): Promise<string[]> {
  const rows = await db.user.findMany({ where: { status: 'ACTIVE', roles: { some: { role: { in: [...ADMIN_ROLES] } } } }, select: { id: true } });
  return rows.map((u) => u.id);
}

async function authorRole(c: AppContext, t: { id: string; ownerId: string }): Promise<AuthorRole> {
  if (isAdmin(await currentRoles(c))) return 'ADMIN';
  return (await staffVia(c, t)) ? 'STAFF' : 'PARTICIPANT';
}

const disputeLink = (id: string) => `/disputas/${id}`;
const matchesLink = (slug: string) => `/c/${slug}?aba=partidas`;
const manageLink = (id: string) => `/organizador/campeonatos/${id}`;

/**
 * Confere o placar com o motor sem gravar nada (mesmas regras do lançamento pelo staff: série melhor de N, empate em
 * mata-mata — RN-14). Devolve o vencedor que o motor apurou.
 */
async function dryRun(db: PrismaClient, ctx: MatchContext, entries: ResultEntryInput[], winnerRegistrationId: string | null | undefined): Promise<string | null> {
  const game = await db.game.findUnique({ where: { id: ctx.tournament.gameId }, select: { extraStatFields: true } });
  const winnerId = winnerRegistrationId ?? tiebreakWinner(entries, game?.extraStatFields);
  const input = toEngineInput(ctx.node.id, entries.map((e) => ({ registrationId: e.registrationId, ...(e.score !== undefined ? { score: e.score } : {}), ...(e.stats ? { stats: e.stats } : {}) })), winnerId);
  return engine(() => applyResult(ctx.run.structure, ctx.run.state, input)).state.results[ctx.node.id]?.winnerId ?? null;
}

function sameResult(p: SubmissionPayload, entries: ResultEntryInput[], winnerRegistrationId: string | null | undefined): boolean {
  const score = (list: ResultEntryInput[], id: string) => list.find((e) => e.registrationId === id)?.score ?? null;
  const sameScores = p.entries.every((e) => score(entries, e.registrationId) === (e.score ?? null));
  return sameScores && (winnerRegistrationId === undefined || winnerRegistrationId === p.winnerRegistrationId);
}

/** Só o outro lado do duelo responde ao envio — nunca quem enviou. */
async function requireOpponent(db: Db, s: SubmissionRow, userId: string): Promise<void> {
  const p = payloadOf(s);
  const sameSide = (await involvedUsers(db, [p.submittedByRegistrationId])).includes(userId);
  if (sameSide) throw forbidden('Quem enviou o resultado não pode responder ao próprio envio. A confirmação é do adversário.');
  if (!(await actsFor(db, p.opponentRegistrationId, userId))) {
    const involved = (await involvedUsers(db, [p.opponentRegistrationId])).includes(userId);
    throw forbidden(involved ? 'No squad, quem responde ao resultado é o capitão.' : 'Só o adversário desta partida pode responder ao envio.');
  }
}

async function findSubmission(db: Db, id: string): Promise<SubmissionRow> {
  const s = isUuid(id) ? await db.resultSubmission.findUnique({ where: { id } }) : null;
  if (!s) throw notFound('Envio');
  return s;
}

async function findDispute(db: Db, id: string): Promise<DisputeRow> {
  const d = isUuid(id) ? await db.dispute.findUnique({ where: { id }, include: disputeInclude }) : null;
  if (!d) throw notFound('Disputa');
  return d;
}

/** Exige envolvido na partida, staff do campeonato ou Admin. */
async function requireDisputeAccess(c: AppContext, d: DisputeRow) {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const ctx = await disputeContext(db, d);
  const t = await db.tournament.findUniqueOrThrow({ where: { id: ctx.tournamentId }, select: { id: true, ownerId: true, slug: true, name: true } });
  const staff = (await staffVia(c, t)) !== null;
  if (!staff && !(await involvedUsers(db, ctx.registrationIds)).includes(session.userId)) throw forbidden('Só quem está nesta partida ou a organização do campeonato vê a disputa.');
  return { session, tournament: t, ctx, staff };
}

/** O status da partida volta ao calculado (agenda/check-in), se ela não tem resultado oficial. */
async function clearMatchOverride(tx: Db, matchId: string): Promise<void> {
  await tx.match.updateMany({ where: { id: matchId, status: { in: ['AWAITING_VALIDATION', 'DISPUTED'] } }, data: { status: 'SCHEDULED' } });
}

/** `createdAt` crescente dentro da disputa (o relógio pode repetir o mesmo instante). */
async function nextMessageAt(tx: Db, disputeId: string, now: Date): Promise<Date> {
  const last = await tx.disputeMessage.findFirst({ where: { disputeId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  return last && last.createdAt.getTime() >= now.getTime() ? new Date(last.createdAt.getTime() + 1) : now;
}

export const submissions = new Hono<AppEnv>();

// ── Filas do staff ───────────────────────────────────────────────────
/** "Resultados para validar": confirmados pelo adversário + pendentes cujo prazo de resposta venceu. `?status=` troca o filtro. */
submissions.get('/tournaments/:id/submissions', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'moderate');
  const db = c.get('deps').db();
  const raw = c.req.query('status');
  const mine: Prisma.ResultSubmissionWhereInput = { match: { stage: { tournamentId: access.tournamentId } } };
  let where: Prisma.ResultSubmissionWhereInput;
  if (!raw || raw === 'QUEUE') {
    const expired = new Date(c.get('deps').now().getTime() - RESPONSE_WINDOW_MS);
    where = { ...mine, OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', createdAt: { lte: expired } }] };
  } else if (raw === 'ALL') {
    where = mine;
  } else {
    const status = SubmissionStatus.safeParse(raw);
    if (!status.success) throw badRequest('Filtro de status inválido.', 'INVALID_STATUS');
    where = { ...mine, status: status.data };
  }
  // Fila: os mais antigos primeiro (quem espera há mais tempo).
  const rows = await db.resultSubmission.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return respond(c, z.array(ResultSubmission), await toSubmissions(db, rows));
});

submissions.get('/tournaments/:id/disputes', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'moderate');
  const db = c.get('deps').db();
  const raw = c.req.query('status');
  const status = raw ? DisputeStatus.safeParse(raw) : null;
  if (status && !status.success) throw badRequest('Filtro de status inválido.', 'INVALID_STATUS');
  const order: Record<DisputeStatusT, number> = { OPEN: 0, ESCALATED: 1, RESOLVED: 2 };
  const rows = await db.dispute.findMany({ where: { match: { stage: { tournamentId: access.tournamentId } }, ...(status?.success ? { status: status.data } : {}) }, include: disputeInclude, orderBy: { createdAt: 'desc' } });
  rows.sort((a, b) => order[a.status] - order[b.status] || b.createdAt.getTime() - a.createdAt.getTime());
  return respond(c, z.array(Dispute), await toDisputes(db, rows));
});

/** As disputas das partidas em que eu jogo (dos dois lados). */
submissions.get('/me/disputes', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const ids = await registrationIdsOfUser(db, session.userId, { confirmedMember: true });
  const rows = ids.length ? await db.dispute.findMany({ where: { match: { participants: { some: { registrationId: { in: ids } } } } }, include: disputeInclude, orderBy: { createdAt: 'desc' } }) : [];
  return respond(c, z.array(Dispute), await toDisputes(db, rows));
});

// ── Envio pelo participante ──────────────────────────────────────────
submissions.post('/matches/:id/submissions', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  if (!(await isFlagEnabled(c, 'resultSubmission'))) throw forbidden('O envio de resultado pelos participantes está desligado. A organização lança os resultados.', 'FEATURE_DISABLED');
  const ctx = await matchContext(db, c.req.param('id'));
  const { tournament: t, node, run } = ctx;
  const mine = await registrationOfUser(db, t.id, session.userId);
  if (!mine || mine.status !== 'CONFIRMED' || !node.slots.some((s) => s.entrantId === mine.id)) throw forbidden('Só quem joga esta partida pode enviar o resultado.');
  if (!(mine.userId ? mine.userId === session.userId : mine.team?.captainId === session.userId)) throw forbidden('No squad, quem envia o resultado é o capitão.');
  if (node.kind !== 'DUEL') throw badRequest('Em Battle Royale o resultado da queda é lançado pela organização. Mande o print para a organização do campeonato.', 'LOBBY_RESULT_BY_STAFF');
  const input = await body(c, CreateSubmissionInput);

  if (t.status === 'PAUSED') throw conflict('O campeonato está pausado. Aguarde a organização retomar.', 'TOURNAMENT_PAUSED');
  if (t.status !== 'IN_PROGRESS') throw conflict('O campeonato não está em andamento.', 'TOURNAMENT_NOT_RUNNING');
  if (run.state.results[node.id]) throw conflict('Esta partida já tem resultado oficial.', 'MATCH_FINISHED');
  const opponentId = node.slots.find((s) => s.entrantId !== mine.id)?.entrantId ?? null;
  if (node.slots.length !== 2 || !opponentId || getMatchStatus(run.structure, run.state, node.id) !== 'READY') throw conflict('Esta partida ainda não está pronta para receber resultado.', 'MATCH_NOT_READY');

  // Na ordem das vagas da partida, a mesma do rótulo ("A x B").
  const sides = node.slots.map((slot) => slot.entrantId as string);
  const complete = input.entries.length === 2 && sides.every((id) => input.entries.some((e) => e.registrationId === id && e.score !== undefined));
  if (!complete) throw badRequest('Informe o placar dos dois lados da partida.', 'INVALID_RESULT');
  // Só estatísticas brutas de duelo: placar e campo de desempate. Pontos nunca vêm do cliente (RN-01).
  const entries: ResultEntryInput[] = sides.map((id) => {
    const e = input.entries.find((x) => x.registrationId === id) as ResultEntryInput;
    return { registrationId: id, score: e.score, ...(e.stats ? { stats: e.stats } : {}) };
  });
  const winnerRegistrationId = await dryRun(db, ctx, entries, input.winnerRegistrationId);

  const now = c.get('deps').now();
  const payload: SubmissionPayload = { entries, winnerRegistrationId, submittedByRegistrationId: mine.id, opponentRegistrationId: opponentId, tournamentId: t.id, tournamentName: t.name, stageId: ctx.stage.id, matchLabel: ctx.label };
  const created = await db.$transaction(async (tx) => {
    // Um envio ativo por partida: a linha da partida fica travada enquanto confere.
    await tx.$queryRaw`SELECT id FROM matches WHERE id = ${ctx.row.id}::uuid FOR UPDATE`;
    if ((await tx.resultSubmission.count({ where: { matchId: ctx.row.id, status: { in: ACTIVE } } })) > 0) {
      throw conflict('Já existe um resultado enviado para esta partida aguardando resposta.', 'SUBMISSION_EXISTS');
    }
    await attachEvidence(tx, { urls: input.evidenceUrls, ownerId: session.userId, type: 'MATCH', id: ctx.row.id, now });
    const row = await tx.resultSubmission.create({ data: { matchId: ctx.row.id, submittedById: session.userId, payload: payload as unknown as Prisma.InputJsonValue, evidenceUrls: input.evidenceUrls, status: 'PENDING', createdAt: now } });
    await tx.match.update({ where: { id: ctx.row.id }, data: { status: 'AWAITING_VALIDATION' } });
    return row;
  });

  const nick = (await nicknames(db, [session.userId])).get(session.userId) ?? 'Seu adversário';
  await notify(c, await involvedUsers(db, [opponentId]), { type: 'RESULT_POSTED', title: 'Confirme o resultado da sua partida', body: `${nick} enviou o placar de ${ctx.label} (${t.name}). Você tem 30 minutos para confirmar ou contestar.`, link: matchesLink(t.slug) });
  await publish(c, `tournament:${t.id}`, { type: 'match.updated', matchId: ctx.row.id, stageId: ctx.stage.id, status: 'AWAITING_VALIDATION' });
  return respond(c, ResultSubmission, await toSubmission(db, created), 201);
});

/** O envio ativo da partida (pendente, confirmado ou contestado), ou `null`. Só para os dois lados e o staff. */
submissions.get('/matches/:id/submission', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const ctx = await matchContext(db, c.req.param('id'));
  const staff = (await staffVia(c, ctx.tournament)) !== null;
  const sides = ctx.node.slots.map((s) => s.entrantId).filter((x): x is string => x !== null);
  if (!staff && !(await involvedUsers(db, sides)).includes(session.userId)) throw forbidden('Só quem joga esta partida ou a organização vê o resultado enviado.');
  const active = await db.resultSubmission.findFirst({ where: { matchId: ctx.row.id, status: { in: ACTIVE } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  return respond(c, ResultSubmission.nullable(), active ? await toSubmission(db, active) : null);
});

// ── Resposta do adversário ───────────────────────────────────────────
submissions.post('/submissions/:id/confirm', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const s = await findSubmission(db, c.req.param('id'));
  await requireOpponent(db, s, session.userId);
  const p = payloadOf(s);
  const { count } = await db.resultSubmission.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status: 'CONFIRMED', confirmedById: session.userId } });
  if (count === 0) throw conflict('Este envio já foi respondido.', 'SUBMISSION_NOT_PENDING');
  const t = await db.tournament.findUniqueOrThrow({ where: { id: p.tournamentId }, select: { id: true, slug: true } });
  await notify(c, await involvedUsers(db, [p.submittedByRegistrationId]), { type: 'RESULT_POSTED', title: 'O adversário confirmou o resultado', body: `${p.matchLabel} (${p.tournamentName}) agora aguarda a validação da organização.`, link: matchesLink(t.slug) });
  await notify(c, await staffUserIds(db, t.id), { type: 'RESULT_POSTED', title: 'Resultado para validar', body: `${p.matchLabel} (${p.tournamentName}): os dois lados concordam com o placar enviado.`, link: manageLink(t.id) });
  await publish(c, `tournament:${t.id}`, { type: 'match.updated', matchId: s.matchId, stageId: p.stageId, status: 'AWAITING_VALIDATION' });
  return respond(c, ResultSubmission, await toSubmission(db, await findSubmission(db, s.id)));
});

/** Contestação: prova obrigatória (PRD §16.5). O resultado contestado não altera a tabela até ser resolvido. */
submissions.post('/submissions/:id/dispute', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const s = await findSubmission(db, c.req.param('id'));
  await requireOpponent(db, s, session.userId);
  const input = await body(c, OpenDisputeInput);
  const p = payloadOf(s);
  const now = c.get('deps').now();
  const dispute = await db.$transaction(async (tx) => {
    const { count } = await tx.resultSubmission.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status: 'CONTESTED' } });
    if (count === 0) throw conflict('Este envio já foi respondido.', 'SUBMISSION_NOT_PENDING');
    const d = await tx.dispute.create({ data: { submissionId: s.id, matchId: s.matchId, openedById: session.userId, reason: input.reason, evidenceUrls: input.evidenceUrls, status: 'OPEN', createdAt: now } });
    await attachEvidence(tx, { urls: input.evidenceUrls, ownerId: session.userId, type: 'DISPUTE', id: d.id, now });
    // A contestação abre o histórico, com as provas de quem contestou.
    await tx.disputeMessage.create({ data: { disputeId: d.id, authorId: session.userId, authorRole: 'PARTICIPANT', body: input.reason, evidenceUrls: input.evidenceUrls, createdAt: now } });
    await tx.match.update({ where: { id: s.matchId }, data: { status: 'DISPUTED' } });
    return d;
  });

  const nick = (await nicknames(db, [session.userId, s.submittedById]));
  await notify(c, await involvedUsers(db, [p.submittedByRegistrationId]), { type: 'DISPUTE_UPDATE', title: 'Seu resultado foi contestado', body: `${nick.get(session.userId) ?? 'O adversário'} contestou o placar de ${p.matchLabel} (${p.tournamentName}). A organização vai analisar as provas.`, link: disputeLink(dispute.id) });
  await notify(c, await staffUserIds(db, p.tournamentId), { type: 'DISPUTE_UPDATE', title: 'Nova disputa para analisar', body: `${p.matchLabel} (${p.tournamentName}): ${nick.get(session.userId) ?? 'o adversário'} contestou o resultado enviado por ${nick.get(s.submittedById) ?? 'um participante'}.`, link: disputeLink(dispute.id) });
  await publish(c, `tournament:${p.tournamentId}`, { type: 'match.updated', matchId: s.matchId, stageId: p.stageId, status: 'DISPUTED' });
  return respond(c, Dispute, await toDispute(db, await findDispute(db, dispute.id)), 201);
});

// ── Validação do staff ───────────────────────────────────────────────
/** Detalhe de um envio (inclusive já encerrado), para a tela da disputa. */
submissions.get('/submissions/:id', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const s = await findSubmission(db, c.req.param('id'));
  const p = payloadOf(s);
  const t = await db.tournament.findUniqueOrThrow({ where: { id: p.tournamentId }, select: { id: true, ownerId: true } });
  const staff = (await staffVia(c, t)) !== null;
  if (!staff && !(await involvedUsers(db, [p.submittedByRegistrationId, p.opponentRegistrationId])).includes(session.userId)) throw forbidden('Só quem joga esta partida ou a organização vê o resultado enviado.');
  return respond(c, ResultSubmission, await toSubmission(db, s));
});

submissions.patch('/submissions/:id', async (c) => {
  const db = c.get('deps').db();
  const s = await findSubmission(db, c.req.param('id'));
  const p = payloadOf(s);
  await assertTournamentAccess(c, p.tournamentId, 'moderate');
  const input = await body(c, ReviewSubmissionInput);
  if (s.status === 'CONTESTED') throw conflict('Este envio foi contestado: resolva pela disputa.', 'SUBMISSION_CONTESTED');
  if (s.status !== 'PENDING' && s.status !== 'CONFIRMED') throw conflict('Este envio já foi analisado.', 'SUBMISSION_REVIEWED');
  const actor = await auditCtx(c);
  const now = c.get('deps').now();
  const t = await db.tournament.findUniqueOrThrow({ where: { id: p.tournamentId }, select: { id: true, slug: true } });

  if (input.action === 'approve') {
    // Enquanto o adversário ainda pode responder, o envio não entra na fila de validação.
    if (s.status === 'PENDING' && respondByOf(s).getTime() > now.getTime()) throw conflict('O adversário ainda está no prazo para confirmar ou contestar este envio.', 'SUBMISSION_AWAITING_OPPONENT');
    // É por aqui que o envio vira resultado oficial: os pontos são calculados pelo servidor.
    const applied = await applyMatchResult(db, s.matchId, { entries: p.entries, winnerRegistrationId: p.winnerRegistrationId, evidenceUrls: s.evidenceUrls }, {
      source: 'SUBMISSION',
      audit: actor,
      now,
      reuseEvidence: [{ type: 'MATCH', id: s.matchId }],
      guard: async (tx) => {
        const { count } = await tx.resultSubmission.updateMany({ where: { id: s.id, status: { in: ['PENDING', 'CONFIRMED'] } }, data: { status: 'APPROVED', reviewedById: actor.actorId } });
        if (count === 0) throw conflict('Este envio já foi analisado.', 'SUBMISSION_REVIEWED');
      },
    });
    await afterResult(c, applied, 'VALIDATED');
  } else {
    await withAudit(db, { ...actor, reason: input.reason }, async (tx) => {
      const { count } = await tx.resultSubmission.updateMany({ where: { id: s.id, status: { in: ['PENDING', 'CONFIRMED'] } }, data: { status: 'REJECTED', rejectReason: input.reason, reviewedById: actor.actorId } });
      if (count === 0) throw conflict('Este envio já foi analisado.', 'SUBMISSION_REVIEWED');
      await clearMatchOverride(tx, s.matchId);
      await audited(tx, { action: 'SUBMISSION_REJECTED', entityType: 'Match', entityId: s.matchId, entityLabel: `${p.matchLabel} · ${p.tournamentName}`, tournamentId: t.id, reason: input.reason });
    });
    await notify(c, await involvedUsers(db, [p.submittedByRegistrationId]), { type: 'RESULT_POSTED', title: 'Seu envio de resultado foi recusado', body: `${p.matchLabel} (${p.tournamentName}): ${input.reason}`, link: matchesLink(t.slug) });
    await publish(c, `tournament:${t.id}`, { type: 'match.updated', matchId: s.matchId, stageId: p.stageId, status: 'SCHEDULED' });
    revalidateTournaments(c);
  }
  return respond(c, ResultSubmission, await toSubmission(db, await findSubmission(db, s.id)));
});

// ── Disputas ─────────────────────────────────────────────────────────
submissions.post('/disputes/:id/messages', async (c) => {
  const db = c.get('deps').db();
  const d = await findDispute(db, c.req.param('id'));
  const { session, tournament, ctx } = await requireDisputeAccess(c, d);
  const input = await body(c, DisputeMessageInput);
  if (d.status === 'RESOLVED') throw conflict('Esta disputa já foi resolvida e não recebe novas mensagens.', 'DISPUTE_CLOSED');
  const role = await authorRole(c, tournament);
  const now = c.get('deps').now();
  await db.$transaction(async (tx) => {
    await attachEvidence(tx, { urls: input.evidenceUrls, ownerId: session.userId, type: 'DISPUTE', id: d.id, now });
    await tx.disputeMessage.create({ data: { disputeId: d.id, authorId: session.userId, authorRole: role, body: input.body, evidenceUrls: input.evidenceUrls, createdAt: await nextMessageAt(tx, d.id, now) } });
  });
  const nick = (await nicknames(db, [session.userId])).get(session.userId) ?? 'Alguém';
  const others = [...(await involvedUsers(db, ctx.registrationIds)), ...(await staffUserIds(db, tournament.id)), ...(d.status === 'ESCALATED' ? await adminUserIds(db) : [])].filter((id) => id !== session.userId);
  await notify(c, others, { type: 'DISPUTE_UPDATE', title: 'Nova mensagem na disputa', body: `${nick} escreveu na disputa de ${ctx.matchLabel} (${ctx.tournamentName}).`, link: disputeLink(d.id) });
  return respond(c, Dispute, await toDispute(db, await findDispute(db, d.id)), 201);
});

/** O staff do campeonato passa a decisão para a administração da plataforma. */
submissions.post('/disputes/:id/escalate', async (c) => {
  const db = c.get('deps').db();
  const d = await findDispute(db, c.req.param('id'));
  const ctx = await disputeContext(db, d);
  await assertTournamentAccess(c, ctx.tournamentId, 'moderate');
  if (d.status !== 'OPEN') throw conflict(d.status === 'ESCALATED' ? 'Esta disputa já foi escalada para a administração.' : 'Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
  const actor = await auditCtx(c);
  const t = await db.tournament.findUniqueOrThrow({ where: { id: ctx.tournamentId }, select: { id: true, ownerId: true } });
  const role = await authorRole(c, t);
  const now = c.get('deps').now();
  await withAudit(db, actor, async (tx) => {
    const { count } = await tx.dispute.updateMany({ where: { id: d.id, status: 'OPEN' }, data: { status: 'ESCALATED', escalatedAt: now, escalatedById: actor.actorId } });
    if (count === 0) throw conflict('Esta disputa já foi escalada para a administração.', 'DISPUTE_NOT_OPEN');
    await tx.disputeMessage.create({ data: { disputeId: d.id, authorId: actor.actorId, authorRole: role, body: 'Disputa escalada para a administração da Nova Arena.', evidenceUrls: [], createdAt: await nextMessageAt(tx, d.id, now) } });
    await audited(tx, { action: 'DISPUTE_ESCALATED', entityType: 'Dispute', entityId: d.id, entityLabel: `${ctx.matchLabel} · ${ctx.tournamentName}`, tournamentId: t.id });
  });
  await notify(c, await involvedUsers(db, ctx.registrationIds), { type: 'DISPUTE_UPDATE', title: 'Disputa escalada para a administração', body: `A organização passou a decisão sobre ${ctx.matchLabel} (${ctx.tournamentName}) para a administração da Nova Arena.`, link: disputeLink(d.id) });
  await notify(
    c,
    (await adminUserIds(db)).filter((id) => id !== actor.actorId),
    { type: 'DISPUTE_UPDATE', title: 'Disputa escalada para análise', body: `${ctx.matchLabel} (${ctx.tournamentName}) aguarda decisão da administração.`, link: disputeLink(d.id) },
  );
  return respond(c, Dispute, await toDispute(db, await findDispute(db, d.id)));
});

/** Resolve a disputa. Com `result`, lança o resultado correto (oficial) pela mesma função do staff. Escalada: só Admin. */
submissions.post('/disputes/:id/resolve', async (c) => {
  const db = c.get('deps').db();
  const d = await findDispute(db, c.req.param('id'));
  const ctx = await disputeContext(db, d);
  const access = await assertTournamentAccess(c, ctx.tournamentId, 'moderate');
  const input = await body(c, ResolveDisputeInput);
  if (d.status === 'RESOLVED') throw conflict('Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
  if (d.status === 'ESCALATED' && access.via !== 'admin') throw forbidden('Esta disputa foi escalada: agora só a administração da Nova Arena pode resolver.');

  const actor = await auditCtx(c);
  const now = c.get('deps').now();
  const previous = d.status;
  const p = d.submission ? payloadOf(d.submission) : null;
  const resultApplied = Boolean(input.result);
  const submissionStatus: SubmissionStatusT = input.result && p && sameResult(p, input.result.entries, input.result.winnerRegistrationId) ? 'APPROVED' : 'REJECTED';

  /** Fecha a disputa e o envio, com auditoria — na mesma transação do resultado, quando houver. */
  const close = async (tx: Prisma.TransactionClient) => {
    const { count } = await tx.dispute.updateMany({ where: { id: d.id, status: previous }, data: { status: 'RESOLVED', resolution: input.resolution, resolvedAt: now, resolvedById: actor.actorId } });
    if (count === 0) throw conflict('Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
    if (d.submissionId) await tx.resultSubmission.update({ where: { id: d.submissionId }, data: { status: submissionStatus, reviewedById: actor.actorId } });
    await audited(tx, {
      action: 'DISPUTE_RESOLVED',
      entityType: 'Dispute',
      entityId: d.id,
      entityLabel: `${ctx.matchLabel} · ${ctx.tournamentName}`,
      tournamentId: ctx.tournamentId,
      before: { status: previous },
      after: { status: 'RESOLVED', resultadoLancado: resultApplied },
      reason: input.resolution,
    });
  };

  if (input.result) {
    // Sem prova nova na resolução, a partida fica com o print do envio original.
    const evidenceUrls = input.result.evidenceUrls.length > 0 ? input.result.evidenceUrls : (d.submission?.evidenceUrls ?? []);
    const applied = await applyMatchResult(db, d.matchId, { ...input.result, evidenceUrls }, {
      source: 'DISPUTE',
      audit: actor,
      now,
      reuseEvidence: [{ type: 'MATCH', id: d.matchId }, { type: 'DISPUTE', id: d.id }],
      guard: async (tx) => {
        const fresh = await tx.dispute.findUniqueOrThrow({ where: { id: d.id }, select: { status: true } });
        if (fresh.status !== previous) throw conflict('Esta disputa já foi resolvida.', 'DISPUTE_NOT_OPEN');
      },
      extra: close,
    });
    await afterResult(c, applied, 'VALIDATED');
  } else {
    // Sem resultado: a partida volta ao estado normal e pode receber um novo envio.
    await withAudit(db, { ...actor, reason: input.resolution }, async (tx) => {
      await close(tx);
      await clearMatchOverride(tx, d.matchId);
    });
    await publish(c, `tournament:${ctx.tournamentId}`, { type: 'match.updated', matchId: d.matchId, stageId: ctx.stageId, status: 'SCHEDULED' });
    revalidateTournaments(c);
  }
  await notify(c, await involvedUsers(db, ctx.registrationIds), {
    type: 'DISPUTE_UPDATE',
    title: 'Disputa resolvida',
    body: `${ctx.matchLabel} (${ctx.tournamentName}): ${resultApplied ? 'o resultado oficial foi lançado.' : 'o resultado enviado foi anulado e a partida aguarda novo resultado.'}`,
    link: disputeLink(d.id),
  });
  return respond(c, Dispute, await toDispute(db, await findDispute(db, d.id)));
});

submissions.get('/disputes/:id', async (c) => {
  const db = c.get('deps').db();
  const d = await findDispute(db, c.req.param('id'));
  await requireDisputeAccess(c, d);
  return respond(c, Dispute, await toDispute(db, d));
});
