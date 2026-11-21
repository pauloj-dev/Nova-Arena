/**
 * Indicadores do painel Admin.
 *
 * - `GET /admin/stats` (issue #91, ADM-01): KPIs do dashboard com cache de 5 min, incluindo a **North Star** (PRD §3.3):
 *   partidas concluídas com resultado validado (W.O. não conta) nos últimos 7 dias. Porta de `buildStats` de
 *   `apps/web/mocks/handlers/admin-audit.ts`.
 * - `GET /admin/metrics` (issue #101): os Key Results do PRD §3.2 e o HEART do §20.1, cada um com valor, meta e se
 *   está dentro dela. Calculado das tabelas da plataforma, da auditoria e dos eventos de produto (`product_events`,
 *   sem cookies). Cache de 5 min.
 *
 * De onde vem "partida concluída": o retrato do motor de cada fase confirmada (`engineSnapshot`, fonte da verdade da
 * chave — ADR-0002), resultado que vale (não anulado). A data do resultado é o primeiro registro de auditoria da
 * partida (`RESULT_ENTERED`, `RESULT_CORRECTED`, `WALKOVER_APPLIED`); sem ele, a última alteração da partida.
 */
import type { PrismaClient } from '@nova/db';
import { ACTIVE_TOURNAMENT_STATUSES, AdminStats, ProductMetrics, type ProductMetric } from '@nova/schemas';
import { Hono } from 'hono';
import { requireAdmin } from '../../auth/admin';
import { readRun } from '../../competition/run';
import { respond, type AppContext, type AppEnv } from '../../context';
import { boundary } from './audit';
import { expireSuspensions } from './sanctions';
import { DAY_MS } from './shared';

const CACHE_TTL_SECONDS = 300;
const RESULT_ACTIONS = ['RESULT_ENTERED', 'RESULT_CORRECTED', 'WALKOVER_APPLIED'];

export const adminStats = new Hono<AppEnv>();

const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Intervalo pedido: padrão últimos 30 dias, limitado a um ano e a hoje. */
export function rangeOf(fromParam: string | undefined, toParam: string | undefined, now: Date): { from: number; to: number } {
  const to = Math.min(boundary(toParam, true)?.getTime() ?? now.getTime(), now.getTime());
  const from = Math.max(boundary(fromParam, false)?.getTime() ?? to - 29 * DAY_MS, to - 365 * DAY_MS);
  return { from: Math.min(from, to), to };
}

function dailySeries(times: number[], from: number, to: number): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of times) if (t >= from && t <= to) counts.set(dayKey(t), (counts.get(dayKey(t)) ?? 0) + 1);
  const out: { date: string; count: number }[] = [];
  for (let t = from; dayKey(t) <= dayKey(to); t += DAY_MS) out.push({ date: dayKey(t), count: counts.get(dayKey(t)) ?? 0 });
  return out;
}

export interface PlayedMatch {
  id: string;
  tournamentId: string;
  at: number;
  walkover: boolean;
  kind: string;
}

/** Partidas com resultado que vale, das fases alteradas desde `since` (o resultado grava o retrato da fase). */
export async function concludedMatches(db: PrismaClient, since: number): Promise<PlayedMatch[]> {
  const stages = await db.stage.findMany({ where: { confirmedAt: { not: null }, updatedAt: { gte: new Date(since) } }, select: { id: true, tournamentId: true, engineSnapshot: true, confirmedAt: true, unlocked: true } });
  const decided: { stageId: string; tournamentId: string; nodeId: string; walkover: boolean }[] = [];
  for (const stage of stages) {
    const run = readRun(stage);
    if (!run?.confirmed) continue;
    for (const [nodeId, result] of Object.entries(run.state.results)) {
      if (result.voided) continue;
      decided.push({ stageId: stage.id, tournamentId: stage.tournamentId, nodeId, walkover: result.walkover });
    }
  }
  if (decided.length === 0) return [];
  const rows = await db.match.findMany({ where: { stageId: { in: [...new Set(decided.map((d) => d.stageId))] } }, select: { id: true, stageId: true, nodeId: true, kind: true, updatedAt: true } });
  const byNode = new Map(rows.map((r) => [`${r.stageId}|${r.nodeId}`, r]));
  const firstResult = new Map<string, number>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 5000) {
    const chunk = ids.slice(i, i + 5000);
    const audit = await db.auditLog.groupBy({ by: ['entityId'], where: { entityType: 'Match', entityId: { in: chunk }, action: { in: RESULT_ACTIONS } }, _min: { createdAt: true } });
    for (const a of audit) if (a._min.createdAt) firstResult.set(a.entityId, a._min.createdAt.getTime());
  }
  const out: PlayedMatch[] = [];
  for (const d of decided) {
    const row = byNode.get(`${d.stageId}|${d.nodeId}`);
    if (!row) continue;
    out.push({ id: row.id, tournamentId: d.tournamentId, at: firstResult.get(row.id) ?? row.updatedAt.getTime(), walkover: d.walkover, kind: row.kind });
  }
  return out;
}

async function cached<T>(c: AppContext, key: string, build: () => Promise<T>): Promise<T> {
  const cache = c.get('deps').cache(c.get('env'));
  const hit = await cache.get<T>(key).catch(() => null);
  if (hit !== null) return hit;
  const value = await build();
  await cache.set(key, value, CACHE_TTL_SECONDS).catch((error: unknown) => c.get('log').warn('cache dos indicadores indisponível', { error: String(error) }));
  return value;
}

export async function buildStats(db: PrismaClient, now: Date, range: { from: number; to: number }): Promise<AdminStats> {
  const { from, to } = range;
  const nowMs = now.getTime();
  const weekAgo = nowMs - 7 * DAY_MS;
  const activeSince = new Date(nowMs - 30 * DAY_MS);
  const people = { status: { notIn: ['MERGED', 'DELETED'] as ('MERGED' | 'DELETED')[] } };

  const [totalUsers, activeUsers, activeTournaments, finishedTournaments, openDisputes, openReports, pendingOrganizerRequests, disputesInRange, signupRows, byGame, played, scheduled] = await Promise.all([
    db.user.count({ where: people }),
    // Ativo = entrou ou renovou a sessão nos últimos 30 dias.
    db.user.count({ where: { status: 'ACTIVE', OR: [{ lastSeenAt: { gte: activeSince } }, { sessions: { some: { createdAt: { gte: activeSince } } } }] } }),
    db.tournament.count({ where: { status: { in: ACTIVE_TOURNAMENT_STATUSES } } }),
    db.tournament.count({ where: { status: { in: ['FINISHED', 'ARCHIVED'] } } }),
    db.dispute.count({ where: { status: { not: 'RESOLVED' } } }),
    db.report.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
    db.organizerRequest.count({ where: { status: 'PENDING' } }),
    db.dispute.count({ where: { createdAt: { gte: new Date(from), lte: new Date(to) } } }),
    db.$queryRaw<{ day: string; n: number }[]>`SELECT to_char(("createdAt" AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM users WHERE status NOT IN ('MERGED','DELETED') AND "createdAt" BETWEEN ${new Date(from)} AND ${new Date(to)} GROUP BY 1`,
    db.tournament.groupBy({ by: ['gameId'], where: { status: { not: 'DRAFT' } }, _count: { _all: true } }),
    concludedMatches(db, Math.min(from, weekAgo)),
    db.match.findMany({ where: { scheduledAt: { gte: new Date(weekAgo), lte: now }, stage: { confirmedAt: { not: null } } }, select: { id: true } }),
  ]);
  const games = new Map((await db.game.findMany({ where: { id: { in: byGame.map((g) => g.gameId) } }, select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const gameCounts = new Map<string, number>();
  for (const g of byGame) {
    const name = games.get(g.gameId) ?? 'Jogo';
    gameCounts.set(name, (gameCounts.get(name) ?? 0) + g._count._all);
  }
  const validated = played.filter((m) => !m.walkover);
  const inRange = played.filter((m) => m.at >= from && m.at <= to);
  const signups = new Map(signupRows.map((r) => [r.day, r.n]));
  // Partidas da semana: as que tinham horário nos últimos 7 dias ou foram concluídas nesse período.
  const weekMatches = new Set([...scheduled.map((m) => m.id), ...played.filter((m) => m.at >= weekAgo).map((m) => m.id)]);
  return {
    activeUsers,
    totalUsers,
    activeTournaments,
    finishedTournaments,
    matchesThisWeek: weekMatches.size,
    validatedMatchesThisWeek: validated.filter((m) => m.at >= weekAgo && m.at <= nowMs).length,
    openDisputes,
    openReports,
    pendingOrganizerRequests,
    signups: dailySeries([], from, to).map((d) => ({ date: d.date, count: signups.get(d.date) ?? 0 })),
    validatedMatches: dailySeries(
      validated.map((m) => m.at),
      from,
      to,
    ),
    tournamentsByGame: [...gameCounts.entries()].map(([gameName, count]) => ({ gameName, count })).sort((a, b) => b.count - a.count || a.gameName.localeCompare(b.gameName, 'pt-BR')),
    // Frações entre 0 e 1, sobre as partidas concluídas no período.
    walkoverRate: inRange.length > 0 ? inRange.filter((m) => m.walkover).length / inRange.length : 0,
    disputeRate: inRange.length > 0 ? Math.min(1, disputesInRange / inRange.length) : 0,
  };
}

adminStats.get('/admin/stats', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now: clock } = c.get('deps');
  const db = getDb();
  const now = clock();
  await expireSuspensions(db, now);
  const range = rangeOf(c.req.query('from'), c.req.query('to'), now);
  const stats = await cached(c, `admin:stats:v1:${dayKey(range.from)}:${dayKey(range.to)}`, () => buildStats(db, now, range));
  return respond(c, AdminStats, stats);
});

// ── Métricas de produto (#101) ───────────────────────────────────────
function metric(m: Omit<ProductMetric, 'status'>): ProductMetric {
  const status = m.value === null ? 'no_data' : m.target === null ? 'ok' : (m.direction === 'max' ? m.value <= m.target : m.value >= m.target) ? 'ok' : 'attention';
  return { ...m, status };
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length);

/** NPS: % de promotores (9–10) menos % de detratores (0–6), de -100 a 100. */
export function nps(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

/** Segunda-feira (UTC) da semana de `time`. */
function weekStart(time: number): string {
  const d = new Date(time);
  const day = (d.getUTCDay() + 6) % 7;
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS);
}

export async function buildMetrics(db: PrismaClient, now: Date, range: { from: number; to: number }): Promise<ProductMetrics> {
  const { from, to } = range;
  const fromD = new Date(from);
  const toD = new Date(to);
  const nowMs = now.getTime();
  const eightWeeksAgo = Date.parse(`${weekStart(nowMs - 7 * 7 * DAY_MS)}T00:00:00Z`);
  const played = await concludedMatches(db, Math.min(from, eightWeeksAgo));
  const validated = played.filter((m) => !m.walkover);
  const inRange = played.filter((m) => m.at >= from && m.at <= to);

  // North Star: semana corrente (7 dias), a anterior e as últimas 8 semanas (segunda a domingo, UTC).
  const weekly = new Map<string, number>();
  for (let w = 0; w < 8; w += 1) weekly.set(weekStart(eightWeeksAgo + w * 7 * DAY_MS), 0);
  for (const m of validated) {
    const key = weekStart(m.at);
    if (weekly.has(key)) weekly.set(key, (weekly.get(key) ?? 0) + 1);
  }

  // O1 · tempo para criar e publicar (do rascunho à publicação).
  const published = await db.$queryRaw<{ minutes: number }[]>`
    SELECT EXTRACT(EPOCH FROM (p.first_at - t."createdAt")) / 60 AS minutes
    FROM (SELECT "entityId", min("createdAt") AS first_at FROM audit_logs WHERE action = 'TOURNAMENT_PUBLISHED' AND "entityType" = 'Tournament' GROUP BY "entityId") p
    JOIN tournaments t ON t.id::text = p."entityId"
    WHERE p.first_at BETWEEN ${fromD} AND ${toD}`;
  const publishMinutes = mean(published.map((p) => Number(p.minutes)));

  // O1 · campeonatos encerrados sem ajuste manual de pontuação (resultado corrigido ou pontuação da fase alterada).
  const finished = await db.$queryRaw<{ id: string; adjusted: boolean }[]>`
    SELECT t.id::text AS id,
      EXISTS (SELECT 1 FROM audit_logs a WHERE a."tournamentId" = t.id AND a.action IN ('RESULT_CORRECTED', 'STAGE_SCORING_CHANGED')) AS adjusted
    FROM tournaments t
    LEFT JOIN LATERAL (
      SELECT min(a."createdAt") AS at FROM audit_logs a
      WHERE a."entityType" = 'Tournament' AND a."entityId" = t.id::text AND a.action = 'TOURNAMENT_STATUS_CHANGED' AND a.after->>'status' = 'FINISHED'
    ) f ON true
    WHERE t.status IN ('FINISHED', 'ARCHIVED') AND COALESCE(f.at, t."updatedAt") BETWEEN ${fromD} AND ${toD}`;
  const noAdjust = finished.length === 0 ? null : finished.filter((f) => !f.adjusted).length / finished.length;

  // O2 · disputas por partida.
  const disputes = await db.dispute.count({ where: { createdAt: { gte: fromD, lte: toD } } });
  const disputeRate = inRange.length === 0 ? null : Math.min(1, disputes / inRange.length);

  // O3 · reinscrição em até 30 dias: quem fez a 1ª inscrição na janela (deslocada 30 dias para trás, para todos
  // terem tido os 30 dias) e se inscreveu em outro campeonato até 30 dias depois.
  const cohortFrom = new Date(from - 30 * DAY_MS);
  const cohortTo = new Date(to - 30 * DAY_MS);
  const [retention] = await db.$queryRaw<{ cohort: number; returned: number }[]>`
    WITH regs AS (
      SELECT r."userId" AS u, r."tournamentId" AS t, r."createdAt" AS at FROM registrations r WHERE r."userId" IS NOT NULL AND r.status NOT IN ('REJECTED', 'CANCELLED')
      UNION ALL
      SELECT m."userId", m."tournamentId", m."createdAt" FROM registration_members m JOIN registrations r ON r.id = m."registrationId" WHERE r.status NOT IN ('REJECTED', 'CANCELLED')
    ), firsts AS (SELECT u, min(at) AS first_at FROM regs GROUP BY u)
    SELECT count(*)::int AS cohort,
      count(*) FILTER (WHERE (SELECT count(DISTINCT r2.t) FROM regs r2 WHERE r2.u = f.u AND r2.at <= f.first_at + interval '30 days') >= 2)::int AS returned
    FROM firsts f WHERE f.first_at BETWEEN ${cohortFrom} AND ${cohortTo}`;
  const returnRate = retention && retention.cohort > 0 ? retention.returned / retention.cohort : null;

  // O3 · W.O.
  const walkoverRate = inRange.length === 0 ? null : inRange.filter((m) => m.walkover).length / inRange.length;

  // O4 · ações administrativas com auditoria: cada alteração feita em `/admin/*` (evento `admin_mutation`) precisa ter
  // pelo menos um registro de auditoria do mesmo autor durante a requisição.
  const [coverage] = await db.$queryRaw<{ total: number; audited: number }[]>`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM audit_logs a WHERE a."actorId" = e."userId"
          AND a."createdAt" BETWEEN (e.props->>'startedAt')::timestamptz - interval '2 seconds' AND (e.props->>'finishedAt')::timestamptz + interval '2 seconds'
      ))::int AS audited
    FROM product_events e WHERE e.name = 'admin_mutation' AND e."createdAt" BETWEEN ${fromD} AND ${toD}`;
  const auditCoverage = coverage && coverage.total > 0 ? coverage.audited / coverage.total : null;

  // HEART · NPS por papel.
  const answers = await db.productEvent.findMany({ where: { name: 'nps', createdAt: { gte: fromD, lte: toD } }, select: { props: true } });
  const scoresOf = (as: string) => answers.map((a) => a.props as { score?: unknown; as?: unknown }).filter((p) => p.as === as && typeof p.score === 'number').map((p) => p.score as number);
  const participantScores = scoresOf('PARTICIPANT');
  const organizerScores = scoresOf('ORGANIZER');

  // HEART · engajamento: dias com acesso (sessão aberta ou renovada) por participante de campeonato com partida no período.
  const [engagement] = await db.$queryRaw<{ people: number; days: number }[]>`
    WITH players AS (
      SELECT DISTINCT COALESCE(m."userId", r."userId") AS u
      FROM matches mt JOIN stages s ON s.id = mt."stageId"
      JOIN registrations r ON r."tournamentId" = s."tournamentId" AND r.status = 'CONFIRMED'
      LEFT JOIN registration_members m ON m."registrationId" = r.id
      WHERE mt."scheduledAt" BETWEEN ${fromD} AND ${toD}
    )
    SELECT count(*)::int AS people,
      COALESCE(sum((SELECT count(DISTINCT (se."createdAt" AT TIME ZONE 'UTC')::date) FROM sessions se WHERE se."userId" = p.u AND se."createdAt" BETWEEN ${fromD} AND ${toD})), 0)::int AS days
    FROM players p WHERE p.u IS NOT NULL`;
  const engagementValue = engagement && engagement.people > 0 ? engagement.days / engagement.people : null;

  // HEART · adoção: organizadores aprovados (janela deslocada 7 dias) que publicaram o 1º campeonato em até 7 dias.
  const [adoption] = await db.$queryRaw<{ cohort: number; adopted: number }[]>`
    SELECT count(*)::int AS cohort,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM tournaments t JOIN audit_logs a ON a."entityType" = 'Tournament' AND a."entityId" = t.id::text AND a.action = 'TOURNAMENT_PUBLISHED'
        WHERE t."ownerId" = ur."userId" AND a."createdAt" <= ur."grantedAt" + interval '7 days'
      ))::int AS adopted
    FROM user_roles ur WHERE ur.role = 'ORGANIZER' AND ur."grantedAt" BETWEEN ${new Date(from - 7 * DAY_MS)} AND ${new Date(to - 7 * DAY_MS)}`;
  const adoptionRate = adoption && adoption.cohort > 0 ? adoption.adopted / adoption.cohort : null;

  // HEART · sucesso na tarefa: tempo para lançar uma queda de Battle Royale (evento do navegador).
  const entries = await db.productEvent.findMany({ where: { name: 'result_entry_time', createdAt: { gte: fromD, lte: toD } }, select: { props: true } });
  const brSeconds = entries
    .map((e) => e.props as { durationMs?: unknown; kind?: unknown })
    .filter((p) => p.kind === 'LOBBY' && typeof p.durationMs === 'number' && p.durationMs > 0 && p.durationMs < 3600_000)
    .map((p) => (p.durationMs as number) / 1000);

  const pct = (v: number | null) => (v === null ? null : round(v, 4));
  const metrics: ProductMetric[] = [
    metric({ key: 'publishTime', group: 'OKR', label: 'Tempo médio para criar e publicar um campeonato', value: publishMinutes === null ? null : round(publishMinutes, 1), unit: 'minutes', target: 10, direction: 'max', targetLabel: '≤ 10 min', sample: published.length, detail: 'Do rascunho criado à publicação, nos campeonatos publicados no período.' }),
    metric({ key: 'noManualAdjustment', group: 'OKR', label: 'Campeonatos encerrados sem ajuste manual de pontuação', value: pct(noAdjust), unit: 'percent', target: 0.9, direction: 'min', targetLabel: '≥ 90%', sample: finished.length, detail: 'Sem resultado corrigido nem pontuação da fase alterada, nos campeonatos encerrados no período.' }),
    metric({ key: 'disputeRate', group: 'OKR', label: 'Disputas de resultado por partida', value: pct(disputeRate), unit: 'percent', target: 0.03, direction: 'max', targetLabel: '≤ 3%', sample: inRange.length, detail: 'Disputas abertas no período sobre as partidas concluídas no período.' }),
    metric({ key: 'returnRate30d', group: 'OKR', label: 'Participantes que se inscrevem em um 2º campeonato em até 30 dias', value: pct(returnRate), unit: 'percent', target: 0.4, direction: 'min', targetLabel: '≥ 40%', sample: retention?.cohort ?? 0, detail: 'Quem fez a 1ª inscrição 30 dias antes do período e voltou a se inscrever em outro campeonato em até 30 dias.' }),
    metric({ key: 'walkoverRate', group: 'OKR', label: 'Taxa de W.O. (não comparecimento)', value: pct(walkoverRate), unit: 'percent', target: 0.08, direction: 'max', targetLabel: '≤ 8%', sample: inRange.length, detail: 'Partidas decididas por W.O. sobre as concluídas no período.' }),
    metric({ key: 'auditCoverage', group: 'OKR', label: 'Ações administrativas com registro de auditoria', value: pct(auditCoverage), unit: 'percent', target: 1, direction: 'min', targetLabel: '100%', sample: coverage?.total ?? 0, detail: 'Alterações feitas na área de administração que gravaram auditoria (salvar sem mudar nada não conta).' }),
    metric({ key: 'npsParticipants', group: 'HEART', label: 'NPS dos participantes', value: nps(participantScores), unit: 'score', target: 40, direction: 'min', targetLabel: '≥ 40', sample: participantScores.length, detail: 'Pesquisa depois do campeonato: promotores (9–10) menos detratores (0–6).' }),
    metric({ key: 'npsOrganizers', group: 'HEART', label: 'NPS dos organizadores', value: nps(organizerScores), unit: 'score', target: 50, direction: 'min', targetLabel: '≥ 50', sample: organizerScores.length, detail: 'Pesquisa depois do campeonato: promotores (9–10) menos detratores (0–6).' }),
    metric({ key: 'engagement', group: 'HEART', label: 'Dias com acesso por participante durante o campeonato', value: engagementValue === null ? null : round(engagementValue, 1), unit: 'count', target: 4, direction: 'min', targetLabel: '≥ 4', sample: engagement?.people ?? 0, detail: 'Média de dias com sessão aberta ou renovada, entre quem tinha partida marcada no período.' }),
    metric({ key: 'organizerAdoption', group: 'HEART', label: 'Organizadores que publicam o 1º campeonato em até 7 dias', value: pct(adoptionRate), unit: 'percent', target: 0.6, direction: 'min', targetLabel: '≥ 60%', sample: adoption?.cohort ?? 0, detail: 'Entre quem virou organizador 7 dias antes do período.' }),
    metric({ key: 'retention30d', group: 'HEART', label: 'Inscrição em novo campeonato em até 30 dias', value: pct(returnRate), unit: 'percent', target: 0.4, direction: 'min', targetLabel: '≥ 40%', sample: retention?.cohort ?? 0, detail: 'Mesma conta do OKR de reinscrição.' }),
    metric({ key: 'brEntryTime', group: 'HEART', label: 'Tempo médio para lançar uma queda de Battle Royale', value: brSeconds.length === 0 ? null : round(mean(brSeconds) ?? 0, 1), unit: 'seconds', target: 60, direction: 'max', targetLabel: '≤ 60 s', sample: brSeconds.length, detail: 'Medido na tela de resultados, do início do lançamento ao envio.' }),
  ];

  return {
    from: dayKey(from),
    to: dayKey(to),
    generatedAt: now.toISOString(),
    northStar: {
      thisWeek: validated.filter((m) => m.at > nowMs - 7 * DAY_MS && m.at <= nowMs).length,
      lastWeek: validated.filter((m) => m.at > nowMs - 14 * DAY_MS && m.at <= nowMs - 7 * DAY_MS).length,
      weekly: [...weekly.entries()].map(([ws, count]) => ({ weekStart: ws, count })),
    },
    metrics,
  };
}

adminStats.get('/admin/metrics', async (c) => {
  await requireAdmin(c);
  const { db: getDb, now: clock } = c.get('deps');
  const now = clock();
  const range = rangeOf(c.req.query('from'), c.req.query('to'), now);
  const metrics = await cached(c, `admin:metrics:v1:${dayKey(range.from)}:${dayKey(range.to)}`, () => buildMetrics(getDb(), now, range));
  return respond(c, ProductMetrics, metrics);
});
