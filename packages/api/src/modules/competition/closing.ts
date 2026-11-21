/**
 * Desistência e desclassificação (issue #100, RN-05, RN-06) e encerramento com pódio (issue #88, PRD ORG-12, RF-10).
 * Porta das rotas de `competition.ts` da API simulada.
 *
 * - `POST /registrations/:id/withdraw`: desistência (o próprio inscrito ou o capitão; a organização também registra)
 *   ou desclassificação (dono, co-organizador ou Admin — moderador não). Com a fase em andamento, o motor aplica a
 *   RN-06 conforme o formato (`withdrawEntrant`): W.O. no mata-mata, anulação ou W.O. em pontos corridos, saída dos
 *   pareamentos no suíço, pontos zerados no BR. Cada resultado que muda entra no histórico.
 * - `GET /tournaments/:id/podium` (público), `GET /tournaments/:id/podium-suggestion` (organização) e
 *   `POST /tournaments/:id/finish`: pódio, campeonato FINALIZADO, conquistas gravadas e avisos a todos os inscritos e
 *   a quem segue o campeonato.
 */
import { audited, withAudit, type Prisma, type PrismaClient } from '@nova/db';
import { isStageComplete, withdrawEntrant } from '@nova/engine';
import { FinishTournamentInput, Podium, PodiumSuggestion, Registration, WithdrawInput } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { assertTournamentAccess, currentRoles, tournamentAccessDecision } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { namesFor } from '../../competition/bracket';
import { lockStage, publishStage, recordStateChanges, usersOfRegistrations, writeRun } from '../../competition/results';
import { engine, readRun, stageWithTournament } from '../../competition/run';
import { buildStandings, standingsKey, type StandingsStage } from '../../competition/standings';
import { followersOf, notify, publish } from '../../notify';
import { revalidateTournaments, revalidateUser } from '../../revalidate';
import { toRegistration, tournamentForRegistration } from '../registrations/core';
import { auditCtx, isUuid } from './access';

type Db = PrismaClient | Prisma.TransactionClient;

async function findTournament(c: AppContext, idOrSlug: string) {
  const t = await c
    .get('deps')
    .db()
    .tournament.findFirst({ where: isUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }, select: { id: true, slug: true, name: true, ownerId: true, status: true, gameId: true } });
  if (!t) throw notFound('Campeonato');
  return t;
}

const PODIUM_TYPES = { 1: 'CHAMPION', 2: 'RUNNER_UP', 3: 'THIRD_PLACE' } as const;

export async function toPodium(db: Db, tournamentId: string): Promise<Podium | null> {
  const row = await db.tournamentPodium.findUnique({ where: { tournamentId } });
  if (!row) return null;
  const names = await namesFor(db, tournamentId);
  const places = row.places as { place: number; registrationId: string }[];
  return {
    tournamentId,
    finishedAt: row.finishedAt.toISOString(),
    places: places.map((p) => ({ place: p.place, registrationId: p.registrationId, name: names.get(p.registrationId)?.name ?? 'Inscrito', tag: names.get(p.registrationId)?.tag ?? null, logoUrl: names.get(p.registrationId)?.logoUrl ?? null })),
  };
}

/** A última fase do campeonato (pela ordem), com o que a classificação precisa. */
async function lastStageOf(db: Db, tournamentId: string) {
  const last = await db.stage.findFirst({ where: { tournamentId }, orderBy: { order: 'desc' }, select: { id: true } });
  return last ? stageWithTournament(db, last.id) : null;
}

export const closing = new Hono<AppEnv>();

// ── Desistência e desclassificação (RN-06) ───────────────────────────
closing.post('/registrations/:id/withdraw', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const reg = isUuid(id) ? await db.registration.findUnique({ where: { id }, include: { team: { select: { captainId: true } }, tournament: { select: { id: true, slug: true, name: true, ownerId: true } } } }) : null;
  if (!reg) throw notFound('Inscrição');
  const session = await requireSession(c);
  const input = await body(c, WithdrawInput);
  const t = reg.tournament;
  const staff = await db.tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  // Desclassificar: dono, co-organizador ou Admin (moderador não). Desistir: o próprio inscrito/capitão, ou a organização.
  const manager = tournamentAccessDecision({ userId: session.userId, roles: await currentRoles(c), ownerId: t.ownerId, staffRole: staff?.role ?? null, level: 'manage' });
  const ownsRegistration = reg.userId === session.userId || reg.team?.captainId === session.userId;
  if (input.kind === 'DISQUALIFIED') {
    if (!manager) throw forbidden('Só a organização pode desclassificar.');
  } else if (!ownsRegistration && !manager) {
    throw forbidden('Só o próprio inscrito (ou o capitão) pode desistir.');
  }
  if (reg.status !== 'CONFIRMED') throw conflict('Esta inscrição não está ativa.', 'REGISTRATION_NOT_ACTIVE');

  const changedStages: string[] = [];
  await withAudit(db, await auditCtx(c, input.reason), async (tx) => {
    const { count } = await tx.registration.updateMany({ where: { id: reg.id, status: 'CONFIRMED' }, data: { status: input.kind, statusReason: input.reason } });
    if (count === 0) throw conflict('Esta inscrição não está ativa.', 'REGISTRATION_NOT_ACTIVE');
    const stages = await tx.stage.findMany({ where: { tournamentId: t.id, status: 'ACTIVE', confirmedAt: { not: null } }, orderBy: { order: 'asc' }, select: { id: true } });
    const names = await namesFor(tx, t.id);
    for (const { id: stageId } of stages) {
      const stage = await lockStage(tx, stageId);
      const run = readRun(stage);
      if (!run?.confirmed || !run.structure.entrants.some((e) => e.id === reg.id)) continue;
      const snapshot = engine(() => withdrawEntrant(run.structure, run.state, { entrantId: reg.id, kind: input.kind }));
      await writeRun(tx, stage, run, snapshot);
      // W.O. e anulações que o motor decidiu: cada partida que mudou entra no histórico e tem o status atualizado.
      await recordStateChanges(tx, stageId, snapshot.structure, run.state, snapshot.state, { actorId: session.userId, reason: input.reason, names, source: 'WITHDRAWAL' });
      for (const node of snapshot.structure.matches) {
        const next = snapshot.state.results[node.id];
        if (JSON.stringify(next ?? null) === JSON.stringify(run.state.results[node.id] ?? null)) continue;
        await tx.match.updateMany({ where: { stageId, nodeId: node.id }, data: { status: !next ? 'SCHEDULED' : next.voided ? 'CANCELLED' : next.walkover ? 'WALKOVER' : 'VALIDATED' } });
      }
      changedStages.push(stageId);
    }
    const label = names.get(reg.id)?.name ?? 'Inscrito';
    await audited(tx, { action: input.kind === 'DISQUALIFIED' ? 'ENTRANT_DISQUALIFIED' : 'ENTRANT_WITHDRAWN', entityType: 'Registration', entityId: reg.id, entityLabel: `${label} · ${t.name}`, tournamentId: t.id, reason: input.reason });
  });

  for (const stageId of changedStages) {
    await c.get('deps').cache(c.get('env')).del(standingsKey(stageId)).catch(() => undefined);
    await publishStage(c, t.id, stageId);
  }
  if (input.kind === 'DISQUALIFIED') {
    const users = await usersOfRegistrations(db, [reg.id]);
    await notify(c, users.get(reg.id) ?? [], { type: 'ELIMINATED', title: 'Você foi desclassificado', body: `${t.name}: ${input.reason}`, link: `/c/${t.slug}` });
  }
  revalidateTournaments(c);
  const tView = await db.tournament.findUniqueOrThrow({ where: { id: t.id }, include: tournamentForRegistration });
  return respond(c, Registration, await toRegistration(db, tView, reg.id));
});

// ── Encerramento e pódio ─────────────────────────────────────────────
closing.get('/tournaments/:id/podium', async (c) => {
  const t = await findTournament(c, c.req.param('id'));
  return respond(c, Podium.nullable(), await toPodium(c.get('deps').db(), t.id));
});

/** Sugestão de pódio a partir da classificação da última fase. */
closing.get('/tournaments/:id/podium-suggestion', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  const db = c.get('deps').db();
  const last = await lastStageOf(db, access.tournamentId);
  const run = last ? readRun(last) : null;
  const rows = last ? (await buildStandings(db, last as StandingsStage)).overall : [];
  return respond(c, PodiumSuggestion, {
    complete: Boolean(run?.confirmed && isStageComplete(run.structure, run.state)),
    ranking: rows.slice(0, 8).map((r) => ({ registrationId: r.registrationId, name: r.name, position: r.position })),
  });
});

closing.post('/tournaments/:id/finish', async (c) => {
  const access = await assertTournamentAccess(c, c.req.param('id'), 'manage');
  const input = await body(c, FinishTournamentInput);
  const db = c.get('deps').db();
  const t = await findTournament(c, access.tournamentId);
  if (t.status !== 'IN_PROGRESS') throw conflict('Só um campeonato em andamento pode ser encerrado.', 'INVALID_TRANSITION');
  const last = await lastStageOf(db, t.id);
  const run = last ? readRun(last) : null;
  if (!last || !run?.confirmed || !isStageComplete(run.structure, run.state)) throw conflict('Conclua todas as partidas da última fase antes de encerrar.', 'STAGE_INCOMPLETE');
  const ids = [input.first, input.second, input.third].filter((x): x is string => Boolean(x));
  if (new Set(ids).size !== ids.length) throw badRequest('O mesmo participante não pode ocupar duas posições do pódio.', 'DUPLICATE_PODIUM');
  const valid = await db.registration.count({ where: { id: { in: ids.filter(isUuid) }, tournamentId: t.id } });
  if (valid !== ids.length) throw badRequest('Participante inválido no pódio.');

  const now = c.get('deps').now();
  const places = ids.map((registrationId, i) => ({ place: i + 1, registrationId }));
  const users = await usersOfRegistrations(db, ids);
  // MVP: quem fez mais kills (por jogador, RN-03) em alguma fase do campeonato.
  const stageIds = (await db.stage.findMany({ where: { tournamentId: t.id }, select: { id: true } })).map((s) => s.id);
  const mvps = new Set<string>();
  for (const stageId of stageIds) {
    const stage = await stageWithTournament(db, stageId);
    const top = stage ? (await buildStandings(db, stage as StandingsStage)).mvp[0] : undefined;
    if (top && top.kills > 0) mvps.add(top.userId);
  }

  const audit = await auditCtx(c);
  await withAudit(db, audit, async (tx) => {
    await tx.$queryRaw`SELECT id FROM tournaments WHERE id = ${t.id}::uuid FOR UPDATE`;
    const { count } = await tx.tournament.updateMany({ where: { id: t.id, status: 'IN_PROGRESS' }, data: { status: 'FINISHED' } });
    if (count === 0) throw conflict('Só um campeonato em andamento pode ser encerrado.', 'INVALID_TRANSITION');
    await tx.tournamentPodium.upsert({ where: { tournamentId: t.id }, create: { tournamentId: t.id, places, finishedAt: now, finishedById: audit.actorId }, update: { places, finishedAt: now } });
    await tx.stage.update({ where: { id: last.id }, data: { status: 'COMPLETED' } });
    // Conquistas do perfil competitivo (issue #89): medalhas do pódio e MVP.
    const achievements = [
      ...places.flatMap((p) => (users.get(p.registrationId) ?? []).map((userId) => ({ userId, gameId: t.gameId, type: PODIUM_TYPES[p.place as 1 | 2 | 3], tournamentId: t.id, awardedAt: now }))),
      ...[...mvps].map((userId) => ({ userId, gameId: t.gameId, type: 'MVP', tournamentId: t.id, awardedAt: now })),
    ];
    if (achievements.length) await tx.achievement.createMany({ data: achievements });
    const names = await namesFor(tx, t.id);
    await audited(tx, {
      action: 'TOURNAMENT_STATUS_CHANGED',
      entityType: 'Tournament',
      entityId: t.id,
      entityLabel: t.name,
      tournamentId: t.id,
      before: { status: 'IN_PROGRESS' },
      after: { status: 'FINISHED', podio: places.map((p) => `${p.place}º ${names.get(p.registrationId)?.name ?? 'Inscrito'}`) },
    });
  });
  const podium = (await toPodium(db, t.id)) as Podium;

  const confirmed = await db.registration.findMany({ where: { tournamentId: t.id, status: 'CONFIRMED' }, select: { id: true } });
  const players = await usersOfRegistrations(db, confirmed.map((r) => r.id));
  await notify(c, [...[...players.values()].flat(), ...(await followersOf(db, 'TOURNAMENT', t.id))], {
    type: 'ELIMINATED',
    title: `${t.name} terminou`,
    body: `Campeão: ${podium.places[0]?.name ?? '—'}. Veja o resultado final.`,
    link: `/c/${t.slug}`,
  });
  await publish(c, `tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
  revalidateTournaments(c);
  // Perfis competitivos de quem jogou mudaram (histórico, colocação e conquistas).
  const nicknames = await db.user.findMany({ where: { id: { in: [...players.values()].flat() } }, select: { nicknameKey: true } });
  revalidateUser(c, ...nicknames.map((u) => u.nicknameKey));
  return respond(c, Podium, podium);
});
