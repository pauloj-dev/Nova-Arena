/**
 * Resultados (issue #85) e histórico (issue #86). Porta das rotas de resultado de `competition.ts` da API simulada.
 *
 * - `PUT /matches/:id/result`: duelo (placar da série) ou queda BR (colocação + kills por equipe ou por jogador).
 *   Organização e moderador. Pontos sempre pelo motor. `Idempotency-Key` guarda a resposta original por 24 h no
 *   cache (Upstash em produção): a mesma chave devolve a mesma resposta sem gravar de novo. Corrigir um resultado
 *   já lançado exige motivo, gera evento no histórico e auditoria, e recalcula tabela e chave (CT-08).
 * - `POST /tournaments/:id/results/import`: lotes de até 50 resultados (CSV lido no navegador); cada um passa pela
 *   mesma regra, e os que falham voltam com o motivo.
 * - `GET /matches/:id/events`: linha do tempo do resultado (lançamento, correções, W.O.), do mais novo ao mais antigo.
 */
import { ImportResultsInput, ImportResultsResult, ResultEvent, SubmitResultInput, SubmitResultResponse, type Match } from '@nova/schemas';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, respond, type AppContext, type AppEnv } from '../../context';
import { HttpProblem, notFound } from '../../errors';
import { assertTournamentAccess } from '../../auth/rbac';
import { requireSession } from '../../auth/session';
import { findMatch, matchView } from '../../competition/bracket';
import { afterResult, applyMatchResult, type AppliedResult } from '../../competition/results';
import { auditCtx, isUuid } from './access';

const IDEMPOTENCY_TTL_SECONDS = 24 * 3600;

/** Resposta do lançamento: a partida atualizada e o detalhamento dos pontos de cada participação. */
export async function resultResponse(c: AppContext, applied: AppliedResult): Promise<SubmitResultResponse> {
  const match = (await matchView(c.get('deps').db(), applied.matchId)) as Match;
  const nameOf = (id: string) => match.participants.find((p) => p.registrationId === id)?.name ?? 'Inscrito';
  return { match, results: applied.breakdown.map((b) => ({ registrationId: b.registrationId, name: nameOf(b.registrationId), points: b.points, breakdown: b.breakdown })) };
}

export const results = new Hono<AppEnv>();

results.put('/matches/:id/result', async (c) => {
  const db = c.get('deps').db();
  const matchId = c.req.param('id');
  const found = await findMatch(db, matchId);
  if (!found) throw notFound('Partida');
  await assertTournamentAccess(c, found.stage.tournamentId, 'moderate');
  const session = await requireSession(c);
  const input = await body(c, SubmitResultInput);

  // Idempotência: a mesma chave (da mesma pessoa, na mesma partida) devolve a resposta já gravada.
  const key = c.req.header('Idempotency-Key')?.trim().slice(0, 200);
  const cache = c.get('deps').cache(c.get('env'));
  const cacheKey = key ? `idem:result:${session.userId}:${matchId}:${key}` : null;
  if (cacheKey) {
    const hit = await cache.get<SubmitResultResponse>(cacheKey).catch(() => null);
    if (hit) return respond(c, SubmitResultResponse, hit);
  }

  const applied = await applyMatchResult(db, matchId, input, { source: 'STAFF', audit: await auditCtx(c), now: c.get('deps').now() });
  const response = await resultResponse(c, applied);
  if (cacheKey) await cache.set(cacheKey, response, IDEMPOTENCY_TTL_SECONDS).catch((error: unknown) => c.get('log').warn('não foi possível guardar a chave de idempotência', { error: String(error) }));
  await afterResult(c, applied, response.match.status);
  return respond(c, SubmitResultResponse, response);
});

results.get('/matches/:id/events', async (c) => {
  const db = c.get('deps').db();
  const found = await findMatch(db, c.req.param('id'));
  if (!found) throw notFound('Partida');
  const rows = await db.resultEvent.findMany({ where: { matchId: found.row.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => x !== null))];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, nickname: true } })).map((u) => [u.id, u.nickname]));
  return respond(
    c,
    z.array(ResultEvent),
    rows.map((r) => ({
      id: r.id.toString(),
      matchId: r.matchId,
      type: r.type,
      actorNickname: r.actorId ? (actors.get(r.actorId) ?? 'Usuário') : 'Sistema',
      summary: String((r.after as { summary?: unknown } | null)?.summary ?? ''),
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

results.post('/tournaments/:id/results/import', async (c) => {
  const db = c.get('deps').db();
  const access = await assertTournamentAccess(c, c.req.param('id'), 'moderate');
  const input = await body(c, ImportResultsInput);
  const audit = await auditCtx(c);
  let applied = 0;
  const errors: { matchId: string; message: string }[] = [];
  for (const item of input.results) {
    try {
      const found = isUuid(item.matchId) ? await findMatch(db, item.matchId) : null;
      if (!found || found.stage.tournamentId !== access.tournamentId) throw notFound('Partida');
      const done = await applyMatchResult(db, item.matchId, { entries: item.entries, evidenceUrls: [] }, { source: 'IMPORT', audit, now: c.get('deps').now() });
      applied += 1;
      await afterResult(c, done, 'VALIDATED');
    } catch (error) {
      if (!(error instanceof HttpProblem)) c.get('log').error('falha ao importar um resultado', { matchId: item.matchId, error: error instanceof Error ? error.message : String(error) });
      errors.push({ matchId: item.matchId, message: error instanceof HttpProblem ? error.title : 'Não foi possível lançar este resultado.' });
    }
  }
  return respond(c, ImportResultsResult, { applied, errors });
});
