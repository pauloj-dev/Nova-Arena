/**
 * Fases em andamento (issues #87 e #88). Porta das rotas de classificação, avanço e suíço de `competition.ts` e da
 * troca de pontuação de `tournaments-ops.ts` da API simulada.
 *
 * - `GET /stages/:id/standings`: público (rascunho só para a organização), com cache `standings:{stageId}`.
 *   `?at=<ISO>` reconstitui a tabela num instante passado pelo histórico de resultados (issue #86).
 * - `PATCH /stages/:id/scoring`: troca o modelo de pontuação; com a fase em andamento, todos os pontos já lançados
 *   são recalculados pelo modelo novo (RN-01, RN-02) e a troca fica na auditoria. Dono, co-organizador ou Admin.
 * - `GET /stages/:id/advance` (prévia) e `POST` (confirma): classificados, eliminados e a chave da próxima fase,
 *   que fica como prévia para a organização ajustar e confirmar. Eliminados são avisados.
 * - `POST /stages/:id/next-round`: suíço, a próxima rodada depois que a atual termina.
 */
import { audited, withAudit } from '@nova/db';
import { advanceStage, createStageState, generateSwissRound, isStageComplete, type Rule, type Tiebreaker } from '@nova/engine';
import { AdvancePreview, Bracket, StageScoringInput, Standings, type Stage } from '@nova/schemas';
import { Hono } from 'hono';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { badRequest, conflict, forbidden, notFound } from '../../errors';
import { assertTournamentAccess } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { EDGE_CACHE, isSettled, publicCache } from '../../http-cache';
import { buildBracket, namesFor } from '../../competition/bracket';
import { lockStage, publishStage, usersOfRegistrations, writeRun } from '../../competition/results';
import { clearRun, engine, projectRun, readRun, snapshotOf, stageWithTournament, toEngineConfig, toEngineQualification } from '../../competition/run';
import { buildStandings, cachedStandings, persistStandings, standingsKey, stateAt, type StandingsStage } from '../../competition/standings';
import { notify, publish } from '../../notify';
import { revalidateTournaments } from '../../revalidate';
import { toStage } from '../tournaments/views';
import { auditCtx, isUuid, staffVia } from './access';

type StageRow = NonNullable<Awaited<ReturnType<typeof stageWithTournament>>>;

async function loadStage(c: AppContext, id: string): Promise<StageRow> {
  const stage = isUuid(id) ? await stageWithTournament(c.get('deps').db(), id) : null;
  if (!stage) throw notFound('Fase');
  return stage;
}

const dropStandingsCache = (c: AppContext, stageId: string) => c.get('deps').cache(c.get('env')).del(standingsKey(stageId)).catch(() => undefined);

export const stages = new Hono<AppEnv>();

// ── Classificação ────────────────────────────────────────────────────
stages.get('/stages/:id/standings', async (c) => {
  const db = c.get('deps').db();
  const id = c.req.param('id');
  const head = isUuid(id) ? await db.stage.findUnique({ where: { id }, select: { id: true, updatedAt: true, tournament: { select: { id: true, ownerId: true, status: true } } } }) : null;
  if (!head || (head.tournament.status === 'DRAFT' && !(await staffVia(c, head.tournament)))) throw notFound('Fase');
  const load = async () => (await stageWithTournament(db, id)) as StandingsStage;

  const at = c.req.query('at');
  if (at) {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw badRequest('Informe a data no formato ISO (ex.: 2026-11-21T20:00:00Z).', 'INVALID_DATE');
    const stage = await load();
    const run = readRun(stage);
    return respond(c, Standings, await buildStandings(db, stage, run?.confirmed ? { run, state: await stateAt(db, stage.id, run, when) } : {}));
  }
  // Ao vivo, a tabela vem do Redis (o tempo real manda buscar de novo a cada resultado): sem cache na borda.
  if (isSettled(head.tournament.status)) publicCache(c, EDGE_CACHE.finished);
  return respond(c, Standings, await cachedStandings(db, c.get('deps').cache(c.get('env')), id, head.updatedAt, load));
});

/** Troca o modelo de pontuação da fase (RN-02). Com a fase em andamento, recalcula tudo pelo modelo novo. */
stages.patch('/stages/:id/scoring', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const session = await requireSession(c);
  const input = await body(c, StageScoringInput);
  if (['FINISHED', 'ARCHIVED', 'CANCELLED'].includes(t.status)) throw conflict('Este campeonato já foi encerrado e não pode mais ser alterado.', 'TOURNAMENT_READ_ONLY');
  if (stage.status === 'COMPLETED') throw conflict(`A fase "${stage.name}" já foi concluída: a pontuação dela não muda mais.`, 'STAGE_COMPLETED');

  const db = c.get('deps').db();
  const model = isUuid(input.scoringModelId) ? await db.scoringModel.findFirst({ where: { id: input.scoringModelId, gameId: t.gameId } }) : null;
  if (!model) throw badRequest('Este modelo de pontuação não existe para o jogo do campeonato.', 'VALIDATION', { scoringModelId: 'Modelo de pontuação inválido' });
  // Modelo personalizado só vale para quem o criou (o responsável pelo campeonato ou quem está editando).
  if (model.ownerId !== null && model.ownerId !== t.ownerId && model.ownerId !== session.userId) throw forbidden('Este modelo de pontuação é de outro organizador.');
  if (model.matchType !== stage.scoringModel.matchType) {
    throw badRequest('Este modelo é de outro tipo de partida e não serve para o formato desta fase.', 'SCORING_MODEL_MISMATCH', { scoringModelId: 'Modelo incompatível com o formato da fase' });
  }

  if (model.id !== stage.scoringModelId) {
    const previous = await db.scoringModel.findUnique({ where: { id: stage.scoringModelId }, select: { name: true } });
    await withAudit(db, await auditCtx(c), async (tx) => {
      await lockStage(tx, stage.id);
      await tx.stage.update({ where: { id: stage.id }, data: { scoringModelId: model.id } });
      const fresh = await lockStage(tx, stage.id);
      const run = readRun(fresh);
      // A tabela é sempre derivada das estatísticas brutas: regrava os pontos de todas as partidas (RN-01).
      if (run) {
        await projectRun(tx, stage.id, run, { rules: (model.rules ?? []) as Rule[] });
        if (run.confirmed) await persistStandings(tx, fresh as StandingsStage, run);
      }
      const played = run ? Object.values(run.state.results).filter((r) => !r.voided).length : 0;
      await audited(tx, {
        action: 'STAGE_SCORING_CHANGED',
        entityType: 'Stage',
        entityId: stage.id,
        entityLabel: `${t.name} · ${stage.name}`,
        tournamentId: t.id,
        before: { modelo: previous?.name ?? stage.scoringModelId },
        after: { modelo: model.name, faseEmAndamento: stage.status === 'ACTIVE', partidasRecalculadas: played },
      });
    });
    await dropStandingsCache(c, stage.id);
    await publishStage(c, t.id, stage.id);
    await publish(c, `tournament:${t.id}`, { type: 'tournament.updated', tournamentId: t.id });
    revalidateTournaments(c);
  }
  const fresh = (await stageWithTournament(db, stage.id)) as StageRow;
  return respond(c, Standings, await buildStandings(db, fresh));
});

// ── Avanço de fase ───────────────────────────────────────────────────
interface AdvancePlan {
  preview: AdvancePreview;
  next: StageRow;
  structure: ReturnType<typeof advanceStage>['next'];
}

/** Prévia do avanço (classificados, eliminados e a chave da próxima fase). Mesmas regras da API simulada. */
async function planAdvance(c: AppContext, stage: StageRow): Promise<AdvancePlan> {
  const db = c.get('deps').db();
  const run = readRun(stage);
  if (!run?.confirmed) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  const nextRow = await db.stage.findFirst({ where: { tournamentId: stage.tournamentId, order: stage.order + 1 }, select: { id: true } });
  const view = toStage(stage);
  const qualification = toEngineQualification(view);
  if (!nextRow || !qualification) throw conflict('Esta é a última fase. Use "Encerrar campeonato".', 'LAST_STAGE');
  if (stage.status === 'COMPLETED') throw conflict('Esta fase já foi avançada.', 'ALREADY_ADVANCED');
  if (!isStageComplete(run.structure, run.state)) throw conflict('Ainda há partidas sem resultado nesta fase.', 'STAGE_INCOMPLETE');
  const next = (await stageWithTournament(db, nextRow.id)) as StageRow;
  if (next.confirmedAt) throw conflict('A próxima fase já começou.', 'ALREADY_ADVANCED');
  const nextView: Stage = toStage(next);

  const result = engine(() =>
    advanceStage({
      structure: run.structure,
      state: run.state,
      standings: { rules: (stage.scoringModel.rules ?? []) as Rule[], tiebreakers: stage.tiebreakers as Tiebreaker[], scoreStat: 'score' },
      qualification,
      next: { format: nextView.format, config: toEngineConfig(nextView), seeding: nextView.seeding === 'RANDOM' ? 'RANDOM' : 'RANKED', seed: `${run.structure.seedUsed}-${next.order}` },
    }),
  );

  const names = await namesFor(db, stage.tournamentId);
  const name = (id: string) => names.get(id)?.name ?? run.structure.entrants.find((e) => e.id === id)?.name ?? 'Inscrito';
  const groupName = (groupId: string | null) => run.structure.groups.find((g) => g.id === groupId)?.name ?? null;
  const bracket = await buildBracket(db, next, { includePreview: true, run: { structure: result.next, state: createStageState(), confirmed: false, unlocked: false } });
  return {
    next,
    structure: result.next,
    preview: {
      fromStageId: stage.id,
      toStageId: next.id,
      qualified: result.qualified.map((q) => ({ registrationId: q.entrantId, name: q.name || name(q.entrantId), groupName: groupName(q.groupId), groupPosition: q.groupPosition, via: q.via, seed: q.seed })),
      eliminated: result.eliminated.map((id) => ({ registrationId: id, name: name(id) })),
      next: bracket,
    },
  };
}

stages.get('/stages/:id/advance', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  await assertTournamentAccess(c, stage.tournamentId, 'manage');
  return respond(c, AdvancePreview, (await planAdvance(c, stage)).preview);
});

stages.post('/stages/:id/advance', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const plan = await planAdvance(c, stage);
  const db = c.get('deps').db();
  await withAudit(db, await auditCtx(c), async (tx) => {
    await lockStage(tx, stage.id);
    // Dois cliques ao mesmo tempo: só um avança.
    const { count } = await tx.stage.updateMany({ where: { id: stage.id, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED' } });
    if (count === 0) throw conflict('Esta fase já foi avançada.', 'ALREADY_ADVANCED');
    // A próxima fase fica como prévia (chave não confirmada): a organização ainda pode ajustar e confirmar.
    await clearRun(tx, plan.next.id);
    const state = createStageState();
    await tx.stage.update({ where: { id: plan.next.id }, data: { engineSnapshot: snapshotOf(plan.structure, state), randomSeed: plan.structure.seedUsed, confirmedAt: null, unlocked: false } });
    await projectRun(tx, plan.next.id, { structure: plan.structure, state });
    await audited(tx, {
      action: 'STAGE_ADVANCED',
      entityType: 'Stage',
      entityId: stage.id,
      entityLabel: `${t.name} · ${stage.name}`,
      tournamentId: t.id,
      after: { classificados: plan.preview.qualified.map((q) => q.name), eliminados: plan.preview.eliminated.length },
    });
  });
  const users = await usersOfRegistrations(db, plan.preview.eliminated.map((e) => e.registrationId));
  await notify(c, [...users.values()].flat(), {
    type: 'ELIMINATED',
    title: 'Fim da linha neste campeonato',
    body: `Você não avançou da fase "${stage.name}" em ${t.name}. Valeu pela participação!`,
    link: `/c/${t.slug}?aba=tabela`,
  });
  await publish(c, `tournament:${t.id}`, { type: 'stage.advanced', fromStageId: stage.id, toStageId: plan.next.id });
  revalidateTournaments(c);
  const next = (await stageWithTournament(db, plan.next.id)) as StageRow;
  return respond(c, AdvancePreview, { ...plan.preview, next: await buildBracket(db, next, { includePreview: true }) });
});

/** Suíço: gera a próxima rodada depois que a atual termina. */
stages.post('/stages/:id/next-round', async (c) => {
  const stage = await loadStage(c, c.req.param('id'));
  const t = stage.tournament;
  await assertTournamentAccess(c, t.id, 'manage');
  const run = readRun(stage);
  if (!run?.confirmed) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
  if (stage.format !== 'SWISS') throw badRequest('Só o sistema suíço gera rodadas uma a uma.');
  const db = c.get('deps').db();
  await withAudit(db, await auditCtx(c), async (tx) => {
    const locked = await lockStage(tx, stage.id);
    const current = readRun(locked);
    if (!current) throw conflict('A chave desta fase ainda não foi gerada.', 'BRACKET_MISSING');
    const structure = engine(() => generateSwissRound(current.structure, current.state));
    await writeRun(tx, locked, current, { structure, state: current.state });
    await audited(tx, { action: 'BRACKET_GENERATED', entityType: 'Stage', entityId: stage.id, entityLabel: `${t.name} · ${stage.name}`, tournamentId: t.id, after: { rodada: Math.max(...structure.matches.map((m) => m.round)) } });
  });
  await dropStandingsCache(c, stage.id);
  await publishStage(c, t.id, stage.id);
  revalidateTournaments(c);
  const fresh = (await stageWithTournament(db, stage.id)) as StageRow;
  return respond(c, Bracket, await buildBracket(db, fresh, { includePreview: true }));
});
