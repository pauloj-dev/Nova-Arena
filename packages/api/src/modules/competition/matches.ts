/**
 * Partidas, agenda e sala (issue #83, PRD ORG-06, §16.5). Porta das rotas de partidas de `competition.ts` da API
 * simulada.
 *
 * - Agendar por partida (`PATCH /matches/:id`) ou por rodada (`POST /stages/:id/schedule-round`); organização e
 *   moderador. Reagendar zera os check-ins e recria as mensagens do QStash (a antiga se descarta sozinha).
 * - Código e senha da sala **cifrados** (AES-256-GCM). `GET /matches/:id/lobby` só para quem está na partida (e perto
 *   do horário) ou para a organização. O código **nunca** vai para auditoria, log nem evento: só "sala definida".
 * - Check-in (#84): `POST /matches/:id/check-in` dentro da janela; no squad, o capitão ou todos os titulares.
 * - `POST /matches/:id/start` (organização e moderador) marca "ao vivo" ou devolve para "agendada" (RN-08).
 * - `POST /matches/:id/walkover`: W.O. manual com motivo. O automático vem do QStash/Cron (`competition/walkover`).
 */
import { audited, withAudit } from '@nova/db';
import { Match, MatchLobby, ScheduleMatchInput, ScheduleRoundInput, WalkoverInput, ACTIVE_REGISTRATION_STATUSES } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, forbidden, HttpProblem, notFound } from '../../errors';
import { assertTournamentAccess, currentRoles, tournamentAccessDecision } from '../../auth/rbac';
import { currentSession, requireSession } from '../../auth/session';
import { checkInWindow, findMatch, listMatches, matchView } from '../../competition/bracket';
import { requiredUsers, rosterSelect } from '../../competition/check-in';
import { decryptLobby, encryptLobby } from '../../competition/lobby-crypto';
import { applyManualWalkover } from '../../competition/walkover';
import { checkInOf } from '../tournaments/views';
import { scheduleMatchJobs } from '../../jobs/matches';
import { revalidateTournaments } from '../../revalidate';
import { clientIp } from '../../security';

/** Sem janela de check-in, a sala aparece 15 min antes do horário. */
const REVEAL_WITHOUT_CHECKIN_MS = 15 * 60_000;

async function staffOf(c: AppContext, t: { id: string; ownerId: string }): Promise<boolean> {
  const session = await currentSession(c);
  if (!session) return false;
  const staff = await c.get('deps').db().tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  return tournamentAccessDecision({ userId: session.userId, roles: await currentRoles(c), ownerId: t.ownerId, staffRole: staff?.role ?? null, level: 'moderate' }) !== null;
}

/** A inscrição ativa do usuário no campeonato (solo ou no elenco do squad). */
async function myRegistration(c: AppContext, tournamentId: string, userId: string): Promise<string | null> {
  const r = await c
    .get('deps')
    .db()
    .registration.findFirst({ where: { tournamentId, status: { in: ACTIVE_REGISTRATION_STATUSES }, OR: [{ userId }, { members: { some: { userId } } }] }, select: { id: true } });
  return r?.id ?? null;
}

async function auditCtx(c: AppContext) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null };
}

/** Reagendou: as mensagens antigas se descartam (horário diferente) e as novas entram. Falha na fila não desfaz a agenda. */
async function rescheduleJobs(c: AppContext, match: { id: string; scheduledAt: Date | null }, tournament: { checkInConfig: unknown }) {
  await scheduleMatchJobs(c.get('deps').queue(c.get('env'), c.get('log')), match, checkInWindow(tournament, match.scheduledAt)?.closesAt ?? null).catch((error: unknown) =>
    c.get('log').warn('não foi possível agendar as mensagens da partida; o Cron cobre', { matchId: match.id, error: String(error) }),
  );
}

export const matches = new Hono<AppEnv>();

matches.get('/tournaments/:id/matches', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const t = await db.tournament.findFirst({ where: /^[0-9a-f-]{36}$/i.test(id) ? { id } : { slug: id }, select: { id: true, ownerId: true, status: true } });
  if (!t || (t.status === 'DRAFT' && !(await staffOf(c, t)))) throw notFound('Campeonato');
  let list = await listMatches(db, t.id, c.req.query('stageId') ?? null);
  if (c.req.query('mine') === '1') {
    const session = await currentSession(c);
    const reg = session ? await myRegistration(c, t.id, session.userId) : null;
    list = reg ? list.filter((m) => m.participants.some((p) => p.registrationId === reg)) : [];
  }
  return respond(c, z.array(Match), list);
});

matches.get('/matches/:id', async (c) => {
  const view = await matchView(c.get('deps').db(), c.req.param('id'));
  if (!view) throw notFound('Partida');
  return respond(c, Match, view);
});

/** Agenda e sala de uma partida. Moderador também pode (matriz RBAC). */
matches.patch('/matches/:id', async (c) => {
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const { row, stage, node } = found;
  await assertTournamentAccess(c, stage.tournamentId, 'moderate');
  const input = await body(c, ScheduleMatchInput);
  const scheduledAt = input.scheduledAt === undefined ? row.scheduledAt : input.scheduledAt ? new Date(input.scheduledAt) : null;
  const rescheduled = (scheduledAt?.getTime() ?? null) !== (row.scheduledAt?.getTime() ?? null);

  // Sala: o que veio substitui; ausente mantém; vazio apaga.
  let lobbyCodeEnc = row.lobbyCodeEnc;
  if (input.lobbyCode !== undefined || input.lobbyPassword !== undefined) {
    const current = row.lobbyCodeEnc ? decryptLobby(c.get('env'), row.id, row.lobbyCodeEnc) : { code: '', password: null };
    const code = input.lobbyCode !== undefined ? (input.lobbyCode ?? '').trim() : current.code;
    const password = input.lobbyPassword !== undefined ? input.lobbyPassword?.trim() || null : current.password;
    lobbyCodeEnc = code ? encryptLobby(c.get('env'), row.id, { code, password }) : null;
  }

  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.match.update({ where: { id: row.id }, data: { scheduledAt, lobbyCodeEnc } });
    // Reagendar zera os check-ins: a janela mudou.
    if (rescheduled) await tx.checkIn.deleteMany({ where: { matchId: row.id } });
    // O código da sala nunca entra na auditoria: só o fato de existir.
    await audited(tx, {
      action: 'MATCH_SCHEDULED',
      entityType: 'Match',
      entityId: row.id,
      entityLabel: `${stage.name} · ${node.roundLabel}`,
      tournamentId: stage.tournamentId,
      before: { scheduledAt: row.scheduledAt?.toISOString() ?? null, sala: row.lobbyCodeEnc ? 'definida' : null },
      after: { scheduledAt: scheduledAt?.toISOString() ?? null, sala: lobbyCodeEnc ? 'definida' : null },
    });
  });
  if (rescheduled) await rescheduleJobs(c, { id: row.id, scheduledAt }, stage.tournament);
  revalidateTournaments(c);
  const view = await matchView(db, row.id);
  return respond(c, Match, view as Match);
});

/** Agenda de uma rodada inteira: primeira partida em `startsAt`, as seguintes a cada `intervalMinutes`. */
matches.post('/stages/:id/schedule-round', async (c) => {
  const db = c.get('deps').db();
  const stageId = c.req.param('id');
  const stage = /^[0-9a-f-]{36}$/i.test(stageId) ? await db.stage.findUnique({ where: { id: stageId }, include: { tournament: true } }) : null;
  if (!stage) throw notFound('Fase');
  await assertTournamentAccess(c, stage.tournamentId, 'moderate');
  const input = await body(c, ScheduleRoundInput);
  const all = await listMatches(db, stage.tournamentId, stage.id);
  if (!stage.confirmedAt) throw new HttpProblem(409, 'A chave desta fase ainda não foi confirmada.', 'BRACKET_MISSING');
  const pending = all
    .filter((m) => m.round === input.round && m.status !== 'VALIDATED' && m.status !== 'WALKOVER' && m.status !== 'CANCELLED')
    .filter((m) => input.groupId === undefined || input.groupId === null || m.groupId === input.groupId)
    .filter((m) => input.bracket === undefined || input.bracket === null || m.bracket === input.bracket)
    .sort((a, b) => (a.groupId ?? '').localeCompare(b.groupId ?? '') || a.position - b.position);
  if (pending.length === 0) throw badRequest('Não há partidas pendentes nessa rodada.', 'EMPTY_ROUND');
  const start = new Date(input.startsAt).getTime();
  const plan = pending.map((m, i) => ({ id: m.id, scheduledAt: new Date(start + i * input.intervalMinutes * 60_000) }));
  await withAudit(db, await auditCtx(c), async (tx) => {
    for (const p of plan) {
      await tx.match.update({ where: { id: p.id }, data: { scheduledAt: p.scheduledAt } });
      await tx.checkIn.deleteMany({ where: { matchId: p.id } });
    }
    await audited(tx, { action: 'MATCH_SCHEDULED', entityType: 'Stage', entityId: stage.id, entityLabel: `${stage.tournament.name} · ${stage.name} · rodada ${input.round}`, tournamentId: stage.tournamentId, after: { partidas: plan.length, inicio: input.startsAt, intervaloMin: input.intervalMinutes } });
  });
  for (const p of plan) await rescheduleJobs(c, p, stage.tournament);
  revalidateTournaments(c);
  return respond(c, z.array(Match), await listMatches(db, stage.tournamentId, stage.id));
});

/** Código da sala: só para quem está na partida (e já perto do horário) ou para a organização (PRD §16.5). */
matches.get('/matches/:id/lobby', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const { row, stage, node } = found;
  const staff = await staffOf(c, stage.tournament);
  if (!staff) {
    const reg = await myRegistration(c, stage.tournamentId, session.userId);
    const inMatch = reg !== null && node.slots.some((s) => s.entrantId === reg);
    if (!inMatch) throw forbidden('A sala só é mostrada para quem está nesta partida.');
  }
  if (!row.lobbyCodeEnc) throw new HttpProblem(404, 'A organização ainda não informou a sala.', 'LOBBY_NOT_SET');
  const now = c.get('deps').now();
  if (!staff) {
    const window = checkInWindow(stage.tournament, row.scheduledAt);
    const revealAt = window ? Date.parse(window.opensAt) : row.scheduledAt ? row.scheduledAt.getTime() - REVEAL_WITHOUT_CHECKIN_MS : 0;
    if (now.getTime() < revealAt) throw new HttpProblem(403, 'A sala será liberada perto do horário da partida.', 'LOBBY_NOT_REVEALED');
  }
  const secret = decryptLobby(c.get('env'), row.id, row.lobbyCodeEnc);
  // Resposta pessoal: sem cache compartilhado.
  c.header('Cache-Control', 'private, no-store');
  return respond(c, MatchLobby, { code: secret.code, password: secret.password, revealedAt: now.toISOString() });
});

/** Check-in da partida, dentro da janela. Repetir não duplica. */
matches.post('/matches/:id/check-in', async (c) => {
  const session = await requireSession(c);
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const { row, stage, run, node } = found;
  const regId = await myRegistration(c, stage.tournamentId, session.userId);
  if (!regId || !node.slots.some((s) => s.entrantId === regId)) throw forbidden('Você não está nesta partida.');
  if (run.state.results[node.id]) throw new HttpProblem(409, 'Esta partida já foi concluída.', 'MATCH_FINISHED');
  const window = checkInWindow(stage.tournament, row.scheduledAt);
  const now = c.get('deps').now().getTime();
  if (!window) throw new HttpProblem(409, 'Esta partida não tem check-in.', 'CHECKIN_DISABLED');
  if (now < Date.parse(window.opensAt)) throw new HttpProblem(409, 'O check-in ainda não abriu.', 'CHECKIN_NOT_OPEN');
  if (now >= Date.parse(window.closesAt)) throw new HttpProblem(409, 'A janela de check-in já fechou.', 'CHECKIN_CLOSED');
  const reg = await db.registration.findUniqueOrThrow({ where: { id: regId }, select: rosterSelect });
  if (!requiredUsers(reg, stage.tournament.checkInConfig).includes(session.userId)) {
    throw forbidden(checkInOf(stage.tournament.checkInConfig).requireAllMembers ? 'Só titulares confirmados fazem check-in.' : 'Neste campeonato, quem faz o check-in do squad é o capitão.');
  }
  await db.checkIn.upsert({
    where: { matchId_registrationId_userId: { matchId: row.id, registrationId: regId, userId: session.userId } },
    create: { matchId: row.id, registrationId: regId, userId: session.userId },
    update: {},
  });
  return respond(c, Match, (await matchView(db, row.id)) as Match);
});

/** A organização inicia a partida ("ao vivo") ou devolve para agendada (RN-08). Moderador também pode. */
matches.post('/matches/:id/start', async (c) => {
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const { row, stage, run, node } = found;
  await assertTournamentAccess(c, stage.tournamentId, 'moderate');
  // Corpo opcional: sem corpo = iniciar.
  const text = await c.req.text();
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw badRequest('Corpo da requisição inválido.', 'INVALID_BODY');
  }
  const parsed = z.object({ live: z.boolean().default(true) }).safeParse(raw);
  if (!parsed.success) throw badRequest('Corpo da requisição inválido.', 'INVALID_BODY');
  const input = parsed.data;
  if (run.state.results[node.id]) throw new HttpProblem(409, 'Esta partida já foi concluída.', 'MATCH_FINISHED');
  if (node.slots.some((s) => s.entrantId === null)) throw new HttpProblem(409, 'A partida ainda espera o resultado de partidas anteriores.', 'MATCH_NOT_READY');
  await db.match.update({ where: { id: row.id }, data: { status: input.live ? 'LIVE' : 'SCHEDULED' } });
  revalidateTournaments(c);
  return respond(c, Match, (await matchView(db, row.id)) as Match);
});

/** W.O. manual (organização ou moderador), com motivo na auditoria. O vencedor avança na chave. */
matches.post('/matches/:id/walkover', async (c) => {
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const { row, stage, node } = found;
  await assertTournamentAccess(c, stage.tournamentId, 'moderate');
  const input = await body(c, WalkoverInput);
  if (!node.slots.some((s) => s.entrantId === input.winnerRegistrationId)) throw badRequest('O vencedor precisa ser um dos participantes da partida.', 'NOT_IN_MATCH');
  await applyManualWalkover(db, { ...(await auditCtx(c)), reason: input.reason }, row.id, stage.id, input.winnerRegistrationId);
  revalidateTournaments(c);
  return respond(c, Match, (await matchView(db, row.id)) as Match);
});
