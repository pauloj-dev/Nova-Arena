/**
 * Chave (issue #82, PRD RF-09, ORG-04, RN-07). Porta das rotas de chave de `apps/web/mocks/handlers/competition.ts`.
 *
 * - `POST /stages/:id/generate`: prévia da chave pelo motor (semente registrada na fase; mesma semente = mesma chave).
 * - `PATCH /stages/:id/seeding`: troca dois participantes de posição (ajuste manual, auditado).
 * - `POST /stages/:id/confirm`: a chave passa a valer; a 1ª fase coloca o campeonato em andamento.
 * - Depois da 1ª partida concluída a chave trava: gerar de novo ou ajustar = 409; só o Admin destrava (`/unlock`).
 * - `GET /stages/:id/bracket`: público para chave confirmada; a prévia só para a organização.
 *
 * A chave fica no retrato do motor da fase, com projeção em `groups`/`matches` (ADR-0002).
 *
 * Ao confirmar (#88, #100): quem saiu antes da confirmação (desistiu, foi desclassificado ou removido) já entra como
 * desistente — o adversário leva W.O. (RN-06); os participantes e quem segue o campeonato são avisados (RN-15).
 */
import { audited, withAudit } from '@nova/db';
import { generateStage, swapEntrants, createStageState, withdrawEntrant, type Entrant } from '@nova/engine';
import { Bracket, GenerateBracketInput, ReasonInput, SwapSeedingInput } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, notFound } from '../../errors';
import { requireAdminTwoFactor } from '../../auth/admin';
import { assertTournamentAccess, currentRoles, tournamentAccessDecision } from '../../auth/rbac';
import { currentSession, requireSession } from '../../auth/session';
import { buildBracket, namesFor } from '../../competition/bracket';
import { lockStage, publishStage, recordStateChanges, usersOfRegistrations, writeRun } from '../../competition/results';
import { followersOf, notify, publish } from '../../notify';
import { announceBracket } from '../discord/announce';
import { clearRun, engine, isLocked, projectRun, readRun, snapshotOf, stageWithTournament, toEngineConfig } from '../../competition/run';
import { revalidateTournaments } from '../../revalidate';
import { clientIp } from '../../security';
import { toStage } from '../tournaments/views';
import { entrantRatings } from '../seasons/ratings';

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const LOCKED_MESSAGE = 'A chave está travada porque a fase já tem partida concluída. Só um administrador pode destravar.';

async function loadStage(c: AppContext, id: string) {
  const stage = isUuid(id) ? await stageWithTournament(c.get('deps').db(), id) : null;
  if (!stage) throw notFound('Fase');
  return stage;
}

async function auditCtx(c: AppContext, reason?: string | null) {
  const session = await requireSession(c);
  return { actorId: session.userId, ip: clientIp(c.req.raw.headers), userAgent: c.req.header('user-agent') ?? null, reason: reason ?? null };
}

/** Quem vê a prévia: a organização do campeonato (inclusive moderador) e o Admin. */
async function isStaff(c: AppContext, t: { id: string; ownerId: string }): Promise<boolean> {
  const session = await currentSession(c);
  if (!session) return false;
  const staff = await c.get('deps').db().tournamentStaff.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: session.userId } }, select: { role: true } });
  return tournamentAccessDecision({ userId: session.userId, roles: await currentRoles(c), ownerId: t.ownerId, staffRole: staff?.role ?? null, level: 'moderate' }) !== null;
}

async function respondBracket(c: AppContext, stageId: string) {
  const db = c.get('deps').db();
  const stage = await stageWithTournament(db, stageId);
  if (!stage) throw notFound('Fase');
  return respond(c, Bracket, await buildBracket(db, stage, { includePreview: true }));
}

export const competition = new Hono<AppEnv>();

competition.get('/stages/:id/bracket', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  if (stage.tournament.status === 'DRAFT' && !(await isStaff(c, stage.tournament))) throw notFound('Fase');
  return respond(c, Bracket, await buildBracket(c.get('deps').db(), stage, { includePreview: await isStaff(c, stage.tournament) }));
});

competition.post('/stages/:id/generate', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const input = await body(c, GenerateBracketInput);
  const existing = readRun(stage);
  // RN-07: depois da primeira partida concluída a chave trava (só Admin destrava).
  if (existing && isLocked(existing)) throw conflict(LOCKED_MESSAGE, 'BRACKET_LOCKED');

  const db = c.get('deps').db();
  const previous = await db.stage.findFirst({ where: { tournamentId: t.id, order: stage.order - 1 }, select: { name: true } });
  let entrants: Entrant[];
  if (previous) {
    // Fases seguintes recebem os classificados no avanço da fase anterior (#88).
    if (!existing) throw conflict(`Conclua e avance a fase "${previous.name}" para preencher esta.`, 'PREVIOUS_STAGE_PENDING');
    entrants = existing.structure.entrants;
  } else {
    if (!['REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS'].includes(t.status)) throw conflict('Feche as inscrições antes de gerar a chave.', 'REGISTRATION_STILL_OPEN');
    const regs = await db.registration.findMany({
      where: { tournamentId: t.id, status: 'CONFIRMED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, seed: true, displayName: true, team: { select: { name: true } }, user: { select: { nickname: true } } },
    });
    entrants = regs.map((r) => ({ id: r.id, name: r.displayName ?? r.team?.name ?? r.user?.nickname ?? 'Inscrito', ...(r.seed !== null ? { seed: r.seed } : {}) }));
    // Seeding por ranking (#120): na primeira fase, o rating da temporada atual do jogo, quando houver.
    if (input.seeding === 'RANKED') {
      const ratings = await entrantRatings(c, t.gameId, entrants.map((e) => e.id));
      entrants = entrants.map((e) => (ratings.has(e.id) ? { ...e, rating: ratings.get(e.id) as number } : e));
    }
  }
  if (entrants.length < 2) throw conflict('São necessários pelo menos 2 participantes confirmados.', 'NOT_ENOUGH_ENTRANTS');

  let ordered = entrants;
  if (input.seeding === 'MANUAL') {
    if (!input.order || new Set(input.order).size !== entrants.length || !input.order.every((id) => entrants.some((e) => e.id === id))) {
      throw badRequest('A ordem manual precisa conter cada participante exatamente uma vez.', 'INVALID_ORDER');
    }
    ordered = input.order.map((id, i) => ({ ...(entrants.find((e) => e.id === id) as Entrant), seed: i + 1 }));
  }

  const view = toStage(stage);
  const structure = engine(() => generateStage({ format: view.format, entrants: ordered, config: toEngineConfig(view), seeding: input.seeding, ...(input.seed ? { seed: input.seed } : {}) }));
  await withAudit(db, await auditCtx(c), async (tx) => {
    await clearRun(tx, stage.id);
    const state = createStageState();
    await tx.stage.update({ where: { id: stage.id }, data: { engineSnapshot: snapshotOf(structure, state), seeding: input.seeding, randomSeed: structure.seedUsed, confirmedAt: null, unlocked: false } });
    await projectRun(tx, stage.id, { structure, state });
    await audited(tx, {
      action: 'BRACKET_GENERATED',
      entityType: 'Stage',
      entityId: stage.id,
      entityLabel: `${t.name} · ${stage.name}`,
      tournamentId: t.id,
      before: existing ? { seed: existing.structure.seedUsed } : null,
      after: { seed: structure.seedUsed, seeding: input.seeding, participantes: ordered.length },
    });
  });
  return respondBracket(c, stage.id);
});

competition.patch('/stages/:id/seeding', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const input = await body(c, SwapSeedingInput);
  const run = readRun(stage);
  if (!run) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  if (isLocked(run)) throw conflict(LOCKED_MESSAGE, 'BRACKET_LOCKED');
  const structure = engine(() => swapEntrants(run.structure, input.a, input.b, run.unlocked ? undefined : run.state));
  const db = c.get('deps').db();
  await withAudit(db, await auditCtx(c), async (tx) => {
    await tx.stage.update({ where: { id: stage.id }, data: { engineSnapshot: snapshotOf(structure, run.state) } });
    await projectRun(tx, stage.id, { structure, state: run.state });
    const name = (id: string) => structure.entrants.find((e) => e.id === id)?.name ?? id;
    await audited(tx, { action: 'BRACKET_SEEDING_CHANGED', entityType: 'Stage', entityId: stage.id, entityLabel: `${t.name} · ${stage.name}`, tournamentId: t.id, after: { trocou: [name(input.a), name(input.b)] } });
  });
  if (run.confirmed) {
    await publishStage(c, t.id, stage.id);
    revalidateTournaments(c);
  }
  return respondBracket(c, stage.id);
});

competition.post('/stages/:id/confirm', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const run = readRun(stage);
  if (!run) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  if (run.confirmed) throw conflict('Esta chave já foi confirmada.', 'ALREADY_CONFIRMED');
  const db = c.get('deps').db();
  const previous = await db.stage.findFirst({ where: { tournamentId: t.id, order: stage.order - 1 }, select: { name: true, status: true } });
  if (previous && previous.status !== 'COMPLETED') throw conflict(`A fase "${previous.name}" ainda não terminou.`, 'PREVIOUS_STAGE_PENDING');
  const now = c.get('deps').now();
  const actor = await auditCtx(c);
  await withAudit(db, actor, async (tx) => {
    // Corrida entre dois cliques: só confirma se ainda é prévia.
    const { count } = await tx.stage.updateMany({ where: { id: stage.id, confirmedAt: null }, data: { confirmedAt: now, status: 'ACTIVE' } });
    if (count === 0) throw conflict('Esta chave já foi confirmada.', 'ALREADY_CONFIRMED');
    // A 1ª fase confirmada põe o campeonato em andamento.
    if (!previous && t.status !== 'IN_PROGRESS') await tx.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS' } });
    await audited(tx, { action: 'BRACKET_CONFIRMED', entityType: 'Stage', entityId: stage.id, entityLabel: `${t.name} · ${stage.name}`, tournamentId: t.id, after: { seed: run.structure.seedUsed } });

    // Quem saiu depois da prévia e não foi substituído: desistente na chave (RN-06), com o histórico de cada W.O.
    const gone = await tx.registration.findMany({ where: { id: { in: run.structure.entrants.map((e) => e.id) }, status: { not: 'CONFIRMED' } }, select: { id: true, status: true } });
    if (gone.length > 0) {
      const locked = await lockStage(tx, stage.id);
      const current = readRun(locked);
      if (current) {
        let snapshot = { structure: current.structure, state: current.state };
        for (const r of gone) snapshot = engine(() => withdrawEntrant(snapshot.structure, snapshot.state, { entrantId: r.id, kind: r.status === 'DISQUALIFIED' ? 'DISQUALIFIED' : 'WITHDRAWN' }));
        await writeRun(tx, locked, current, snapshot);
        await recordStateChanges(tx, stage.id, snapshot.structure, current.state, snapshot.state, { actorId: actor.actorId, reason: 'Inscrição fora do campeonato na confirmação da chave', names: await namesFor(tx, t.id), source: 'WITHDRAWAL' });
        for (const node of snapshot.structure.matches) {
          const result = snapshot.state.results[node.id];
          if (result && !current.state.results[node.id]) await tx.match.updateMany({ where: { stageId: stage.id, nodeId: node.id }, data: { status: result.voided ? 'CANCELLED' : result.walkover ? 'WALKOVER' : 'VALIDATED' } });
        }
      }
    }
  });
  revalidateTournaments(c);
  // Participantes e quem segue o campeonato são avisados do início e de cada nova fase (RN-15).
  const players = await usersOfRegistrations(db, run.structure.entrants.map((e) => e.id));
  await notify(c, [...[...players.values()].flat(), ...(await followersOf(db, 'TOURNAMENT', t.id))], {
    type: 'QUALIFIED',
    title: previous ? `Você está na fase "${stage.name}"` : 'A chave saiu!',
    body: `${t.name}: confira seus confrontos.`,
    link: `/c/${t.slug}?aba=chave`,
  });
  await publishStage(c, t.id, stage.id);
  await publish(c, `tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
  await announceBracket(c, { tournamentId: t.id, tournamentName: t.name, slug: t.slug, stageId: stage.id, stageName: stage.name, first: !previous });
  return respondBracket(c, stage.id);
});

/** Só o Admin destrava uma chave que já tem partida concluída (RN-07). */
competition.post('/stages/:id/unlock', async (c) => {
  // Ação de Admin (RN-07): mesma exigência do painel — Admin ou Super Admin com o 2FA feito na sessão (RNF-08).
  await requireAdminTwoFactor(c);
  const { reason } = await body(c, ReasonInput);
  const stage = await loadStage(c, c.req.param('id'));
  const run = readRun(stage);
  if (!run?.confirmed) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  const db = c.get('deps').db();
  await withAudit(db, await auditCtx(c, reason), async (tx) => {
    await tx.stage.update({ where: { id: stage.id }, data: { unlocked: true } });
    await audited(tx, { action: 'BRACKET_UNLOCKED', entityType: 'Stage', entityId: stage.id, entityLabel: `${stage.tournament.name} · ${stage.name}`, tournamentId: stage.tournamentId, reason });
  });
  return respondBracket(c, stage.id);
});
